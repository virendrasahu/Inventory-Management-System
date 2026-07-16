const db = require('./db');

const getStockOverview = async () => {
  const result = await db.query(`
    SELECT 
      p.product_id,
      COALESCE(SUM(ib.remaining_quantity), 0) as current_quantity,
      COALESCE(SUM(ib.remaining_quantity * ib.unit_price), 0) as total_inventory_cost
    FROM products p
    LEFT JOIN inventory_batches ib ON p.product_id = ib.product_id
    GROUP BY p.product_id
  `);
  
  return result.rows.map(row => ({
    product_id: row.product_id,
    current_quantity: parseInt(row.current_quantity),
    total_inventory_cost: parseFloat(row.total_inventory_cost),
    average_cost_per_unit: parseInt(row.current_quantity) > 0 
      ? (parseFloat(row.total_inventory_cost) / parseInt(row.current_quantity)).toFixed(2) 
      : 0
  }));
};

const getTransactionLedger = async () => {
  const result = await db.query('SELECT * FROM transaction_ledger ORDER BY timestamp DESC');
  return result.rows;
};

module.exports = {
  getStockOverview,
  getTransactionLedger
};
