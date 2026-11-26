const db = require('./db');
const { roundMoneyToNumber, computeAverageCostNumber } = require('../utils/money');

const getStockOverview = async () => {
  const result = await db.query(`
    SELECT 
      p.product_id,
      COALESCE(SUM(ib.remaining_quantity), 0) AS current_quantity,
      COALESCE(SUM(ib.remaining_quantity * ib.unit_price), 0) AS total_inventory_cost
    FROM products p
    LEFT JOIN inventory_batches ib ON p.product_id = ib.product_id
    GROUP BY p.product_id
    ORDER BY p.product_id ASC
  `);

  return result.rows.map((row) => {
    const currentQuantity = Number(row.current_quantity) || 0;
    const totalInventoryCost = roundMoneyToNumber(row.total_inventory_cost);
    const averageCostPerUnit = computeAverageCostNumber(
      row.total_inventory_cost,
      currentQuantity
    );

    return {
      product_id: row.product_id,
      current_quantity: currentQuantity,
      total_inventory_cost: totalInventoryCost,
      average_cost_per_unit: averageCostPerUnit,
    };
  });
};

const getAvailableStock = async (productId) => {
  const productRes = await db.query(
    'SELECT product_id FROM products WHERE product_id = $1',
    [productId]
  );
  if (productRes.rows.length === 0) {
    return { productExists: false, availableQuantity: 0 };
  }

  const stockRes = await db.query(
    `SELECT COALESCE(SUM(remaining_quantity), 0) AS available_quantity
     FROM inventory_batches
     WHERE product_id = $1 AND remaining_quantity > 0`,
    [productId]
  );

  return {
    productExists: true,
    availableQuantity: Number(stockRes.rows[0].available_quantity) || 0,
  };
};

const getTransactionLedger = async () => {
  const result = await db.query('SELECT * FROM transaction_ledger ORDER BY timestamp DESC');
  return result.rows;
};

const recordFailedEvent = async ({ rawPayload, reason, topic, partition, offset }) => {
  await db.query(
    `INSERT INTO failed_events (raw_payload, reason, topic, partition, "offset")
     VALUES ($1, $2, $3, $4, $5)`,
    [rawPayload, reason, topic, partition, String(offset)]
  );
};

module.exports = {
  getStockOverview,
  getAvailableStock,
  getTransactionLedger,
  recordFailedEvent,
};
