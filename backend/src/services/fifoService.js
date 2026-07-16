const db = require('../repositories/db');
const logger = require('../utils/logger');

const processEvent = async (event) => {
  const { product_id, event_type, quantity, unit_price, timestamp } = event;
  
  if (!product_id || !event_type || !quantity || !timestamp) {
    logger.error('Invalid event data:', event);
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure product exists
    await client.query(
      "INSERT INTO products (product_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [product_id, `Product ${product_id}`]
    );

    if (event_type === 'purchase') {
      await client.query(
        "INSERT INTO inventory_batches (product_id, quantity, remaining_quantity, unit_price, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [product_id, quantity, quantity, unit_price, timestamp]
      );
      logger.info(`Processed purchase: ${quantity} units of ${product_id}`);
    } else if (event_type === 'sale') {
      let remainingToSell = quantity;
      let totalCost = 0;
      
      // We will track batch details for audit trail
      const auditDetails = [];

      const res = await client.query(
        "SELECT * FROM inventory_batches WHERE product_id = $1 AND remaining_quantity > 0 ORDER BY timestamp ASC FOR UPDATE",
        [product_id]
      );

      const batches = res.rows;

      for (let batch of batches) {
        if (remainingToSell <= 0) break;

        const take = Math.min(batch.remaining_quantity, remainingToSell);
        const cost = take * batch.unit_price;
        totalCost += cost;
        remainingToSell -= take;

        await client.query(
          "UPDATE inventory_batches SET remaining_quantity = remaining_quantity - $1 WHERE id = $2",
          [take, batch.id]
        );

        auditDetails.push({
          batch_id: batch.id,
          quantity_taken: take,
          cost_incurred: cost
        });
      }

      if (remainingToSell > 0) {
        logger.warn(`Not enough inventory to fulfill sale of ${quantity} for ${product_id}. Fulfilled ${quantity - remainingToSell}.`);
      }

      const saleRes = await client.query(
        "INSERT INTO sales (product_id, quantity, total_cost, timestamp) VALUES ($1, $2, $3, $4) RETURNING id",
        [product_id, quantity, totalCost, timestamp]
      );
      
      const saleId = saleRes.rows[0].id;

      // Insert audit details
      for (const detail of auditDetails) {
        await client.query(
          "INSERT INTO sale_batch_details (sale_id, batch_id, quantity_taken, cost_incurred) VALUES ($1, $2, $3, $4)",
          [saleId, detail.batch_id, detail.quantity_taken, detail.cost_incurred]
        );
      }

      logger.info(`Processed sale: ${quantity} units of ${product_id} with total cost ${totalCost}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Transaction error in FIFO service:', err);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  processEvent
};
