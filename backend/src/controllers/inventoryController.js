const inventoryRepository = require('../repositories/inventoryRepository');
const kafkaProducer = require('../kafka/producer');
const logger = require('../utils/logger');

const getStock = async (req, res, next) => {
  try {
    const stock = await inventoryRepository.getStockOverview();
    res.json(stock);
  } catch (err) {
    next(err);
  }
};

const getLedger = async (req, res, next) => {
  try {
    const ledger = await inventoryRepository.getTransactionLedger();
    res.json(ledger);
  } catch (err) {
    next(err);
  }
};

const simulateEvents = async (req, res, next) => {
  try {
    const now = new Date();
    
    const events = [
      { product_id: 'PRD001', event_type: 'purchase', quantity: 100, unit_price: 10.0, timestamp: new Date(now.getTime() - 10000).toISOString() },
      { product_id: 'PRD001', event_type: 'purchase', quantity: 50, unit_price: 12.0, timestamp: new Date(now.getTime() - 8000).toISOString() },
      { product_id: 'PRD001', event_type: 'sale', quantity: 120, timestamp: new Date(now.getTime() - 5000).toISOString() },
      { product_id: 'PRD002', event_type: 'purchase', quantity: 200, unit_price: 5.0, timestamp: new Date(now.getTime() - 4000).toISOString() },
      { product_id: 'PRD002', event_type: 'sale', quantity: 50, timestamp: new Date(now.getTime() - 1000).toISOString() },
    ];

    for (let ev of events) {
      await kafkaProducer.produceEvent(ev);
    }

    res.json({ success: true, message: 'Simulated events sent to Kafka' });
  } catch (err) {
    logger.error('Simulation error', err);
    next(err);
  }
};

const pushEvent = async (req, res, next) => {
  try {
    const { product_id, event_type, quantity, unit_price } = req.body;
    
    if (!product_id || !event_type || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const event = {
      product_id,
      event_type,
      quantity: Number(quantity),
      unit_price: unit_price ? Number(unit_price) : 0,
      timestamp: new Date().toISOString()
    };

    await kafkaProducer.produceEvent(event);
    res.json({ success: true, message: 'Event pushed to Kafka' });
  } catch (err) {
    logger.error('Error pushing event', err);
    next(err);
  }
};

module.exports = {
  getStock,
  getLedger,
  simulateEvents,
  pushEvent
};
