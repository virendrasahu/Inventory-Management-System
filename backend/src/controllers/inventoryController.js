const inventoryRepository = require('../repositories/inventoryRepository');
const kafkaProducer = require('../kafka/producer');
const logger = require('../utils/logger');
const { validateInventoryEvent } = require('../validators/eventValidator');

const isKafkaUnavailableError = (err) =>
  err?.code === 'KAFKA_PRODUCER_DISCONNECTED' ||
  err?.name === 'KafkaJSError' ||
  /producer is (not connected|disconnected)/i.test(err?.message || '');

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

const buildDefaultSimulationEvents = () => {
  const now = Date.now();
  return [
    { product_id: 'PRD001', event_type: 'purchase', quantity: 100, unit_price: 10.0, timestamp: new Date(now - 10000).toISOString() },
    { product_id: 'PRD001', event_type: 'purchase', quantity: 50, unit_price: 12.0, timestamp: new Date(now - 8000).toISOString() },
    { product_id: 'PRD001', event_type: 'sale', quantity: 120, timestamp: new Date(now - 5000).toISOString() },
    { product_id: 'PRD002', event_type: 'purchase', quantity: 200, unit_price: 5.0, timestamp: new Date(now - 4000).toISOString() },
    { product_id: 'PRD002', event_type: 'sale', quantity: 50, timestamp: new Date(now - 1000).toISOString() },
  ];
};

const simulateEvents = async (req, res, next) => {
  try {
    let rawEvents;
    const body = req.body;

    if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0) {
      if (body.events !== undefined) {
        if (!Array.isArray(body.events) || body.events.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: [{ field: 'events', message: 'events must be a non-empty array' }],
          });
        }
        rawEvents = body.events;
      } else {
        rawEvents = [body];
      }
    } else if (Array.isArray(body)) {
      if (body.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: [{ field: 'events', message: 'events must be a non-empty array' }],
        });
      }
      rawEvents = body;
    } else {
      rawEvents = buildDefaultSimulationEvents();
    }

    const validatedEvents = [];
    const errors = [];

    rawEvents.forEach((rawEvent, index) => {
      const result = validateInventoryEvent(rawEvent);
      if (!result.valid) {
        for (const err of result.errors) {
          errors.push({
            field: rawEvents.length > 1 ? `events[${index}].${err.field}` : err.field,
            message: err.message,
          });
        }
      } else {
        validatedEvents.push(result.value);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    if (!kafkaProducer.isProducerConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Kafka producer is disconnected. Service is temporarily unavailable.',
      });
    }

    for (const ev of validatedEvents) {
      await kafkaProducer.produceEvent(ev);
    }

    res.json({ success: true, message: 'Simulated events sent to Kafka' });
  } catch (err) {
    logger.error('Simulation error', { error: err.message });
    if (isKafkaUnavailableError(err)) {
      return res.status(503).json({
        success: false,
        message: 'Kafka producer is disconnected. Service is temporarily unavailable.',
      });
    }
    next(err);
  }
};

const pushEvent = async (req, res, next) => {
  try {
    const validation = validateInventoryEvent(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        errors: validation.errors,
      });
    }

    const event = validation.value;

    if (event.event_type === 'sale') {
      const { productExists, availableQuantity } = await inventoryRepository.getAvailableStock(
        event.product_id
      );
      if (!productExists || availableQuantity < event.quantity) {
        return res.status(409).json({
          success: false,
          message: 'Insufficient stock',
          available_quantity: availableQuantity,
        });
      }
    }

    if (!kafkaProducer.isProducerConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Kafka producer is disconnected. Service is temporarily unavailable.',
      });
    }

    await kafkaProducer.produceEvent(event);
    res.json({ success: true, message: 'Event pushed to Kafka' });
  } catch (err) {
    logger.error('Error pushing event', { error: err.message });
    if (isKafkaUnavailableError(err)) {
      return res.status(503).json({
        success: false,
        message: 'Kafka producer is disconnected. Service is temporarily unavailable.',
      });
    }
    next(err);
  }
};

module.exports = {
  getStock,
  getLedger,
  simulateEvents,
  pushEvent,
};
