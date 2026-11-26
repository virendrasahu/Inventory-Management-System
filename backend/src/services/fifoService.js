const db = require('../repositories/db');
const logger = require('../utils/logger');
const { validateInventoryEvent } = require('../validators/eventValidator');
const { computeLineCostCents, formatCents, formatUnitPrice } = require('../utils/money');

class EventValidationError extends Error {
  constructor(errors, message = 'Validation failed') {
    super(message);
    this.name = 'EventValidationError';
    this.statusCode = 400;
    this.errors = errors;
  }
}

class InsufficientStockError extends Error {
  constructor(productId, requestedQuantity, availableQuantity) {
    super('Insufficient stock');
    this.name = 'InsufficientStockError';
    this.statusCode = 409;
    this.productId = productId;
    this.requestedQuantity = requestedQuantity;
    this.availableQuantity = availableQuantity;
  }
}

/**
 * Processes a single purchase or sale event inside ONE database transaction.
 *
 * When `metadata` ({ topic, partition, offset }) is supplied by the Kafka consumer,
 * inserts into `processed_events` in the same transaction; duplicate offsets are
 * rolled back and skipped cleanly.
 */
const processEvent = async (rawEvent, metadata = null) => {
  const validation = validateInventoryEvent(rawEvent);
  if (!validation.valid) {
    throw new EventValidationError(validation.errors, validation.message);
  }

  const { product_id, event_type, quantity, unit_price, timestamp } = validation.value;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if (
      metadata &&
      metadata.topic !== undefined &&
      metadata.partition !== undefined &&
      metadata.offset !== undefined
    ) {
      try {
        await client.query(
          'INSERT INTO processed_events (topic, partition, "offset") VALUES ($1, $2, $3)',
          [metadata.topic, metadata.partition, String(metadata.offset)]
        );
      } catch (err) {
        if (err.code === '23505') {
          await client.query('ROLLBACK');
          logger.info('duplicate skipped', {
            topic: metadata.topic,
            partition: metadata.partition,
            offset: String(metadata.offset),
          });
          return { status: 'duplicate', skipped: true };
        }
        throw err;
      }
    }

    if (event_type === 'purchase') {
      // Auto-create product row if a purchase arrives for an unknown product_id
      await client.query(
        'INSERT INTO products (product_id, name) VALUES ($1, $2) ON CONFLICT (product_id) DO NOTHING',
        [product_id, `Product ${product_id}`]
      );

      const formattedUnitPrice = formatUnitPrice(unit_price);
      const batchRes = await client.query(
        `INSERT INTO inventory_batches (product_id, quantity, remaining_quantity, unit_price, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id, quantity, remaining_quantity, unit_price, timestamp`,
        [product_id, quantity, quantity, formattedUnitPrice, timestamp]
      );

      await client.query('COMMIT');
      logger.info(`Processed purchase: ${quantity} units of ${product_id}`);
      return {
        status: 'processed',
        event_type: 'purchase',
        batch: batchRes.rows[0],
      };
    }

    // Sale event: ignore unit_price, reject unknown product_id
    const productRes = await client.query(
      'SELECT product_id FROM products WHERE product_id = $1',
      [product_id]
    );
    if (productRes.rows.length === 0) {
      throw new InsufficientStockError(product_id, quantity, 0);
    }

    const batchesRes = await client.query(
      `SELECT id, remaining_quantity, unit_price
       FROM inventory_batches
       WHERE product_id = $1 AND remaining_quantity > 0
       ORDER BY timestamp ASC, id ASC
       FOR UPDATE`,
      [product_id]
    );

    const batches = batchesRes.rows;
    const availableQuantity = batches.reduce(
      (sum, batch) => sum + Number(batch.remaining_quantity),
      0
    );

    if (availableQuantity < quantity) {
      throw new InsufficientStockError(product_id, quantity, availableQuantity);
    }

    let remainingToSell = quantity;
    let consumedQuantity = 0;
    let totalCostCents = 0n;
    const auditDetails = [];

    for (const batch of batches) {
      if (remainingToSell <= 0) break;

      const batchRemaining = Number(batch.remaining_quantity);
      const take = Math.min(batchRemaining, remainingToSell);
      const lineCostCents = computeLineCostCents(take, batch.unit_price);

      totalCostCents += lineCostCents;
      remainingToSell -= take;
      consumedQuantity += take;

      const newRemaining = batchRemaining - take;
      await client.query(
        'UPDATE inventory_batches SET remaining_quantity = $1 WHERE id = $2',
        [newRemaining, batch.id]
      );

      auditDetails.push({
        batch_id: batch.id,
        quantity_taken: take,
        unit_cost: formatUnitPrice(batch.unit_price),
        cost_incurred: formatCents(lineCostCents),
      });
    }

    const totalCostStr = formatCents(totalCostCents);
    const saleRes = await client.query(
      `INSERT INTO sales (product_id, quantity, total_cost, timestamp)
       VALUES ($1, $2, $3, $4)
       RETURNING id, product_id, quantity, total_cost, timestamp`,
      [product_id, consumedQuantity, totalCostStr, timestamp]
    );

    const saleId = saleRes.rows[0].id;

    for (const detail of auditDetails) {
      await client.query(
        `INSERT INTO sale_batch_details (sale_id, batch_id, quantity_taken, unit_cost, cost_incurred)
         VALUES ($1, $2, $3, $4, $5)`,
        [saleId, detail.batch_id, detail.quantity_taken, detail.unit_cost, detail.cost_incurred]
      );
    }

    await client.query('COMMIT');
    logger.info(`Processed sale: ${consumedQuantity} units of ${product_id} with total cost ${totalCostStr}`);
    return {
      status: 'processed',
      event_type: 'sale',
      sale: saleRes.rows[0],
      details: auditDetails,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof InsufficientStockError) {
      logger.warn('Sale rejected due to insufficient stock', {
        product_id,
        requested_quantity: err.requestedQuantity,
        available_quantity: err.availableQuantity,
      });
    } else {
      logger.error('Transaction error in FIFO service', { error: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  processEvent,
  EventValidationError,
  InsufficientStockError,
};
