const fifoService = require('../services/fifoService');
const inventoryRepository = require('../repositories/inventoryRepository');
const { validateInventoryEvent } = require('../validators/eventValidator');
const logger = require('../utils/logger');
const kafka = require('./config');

const TOPIC = kafka.KAFKA_TOPIC;
const GROUP_ID = kafka.KAFKA_GROUP_ID;
const MAX_RETRY_DELAY_MS = 60000;
const INITIAL_RETRY_DELAY_MS = 2000;

const consumer = kafka.consumer({ groupId: GROUP_ID });

let consumerRunning = false;
let isStarting = false;
let isShuttingDown = false;
let retryTimer = null;

consumer.on(consumer.events.GROUP_JOIN, () => {
  consumerRunning = true;
});

consumer.on(consumer.events.DISCONNECT, () => {
  const wasRunning = consumerRunning;
  consumerRunning = false;
  if (wasRunning && !isShuttingDown && !isStarting && !retryTimer) {
    logger.warn('Kafka Consumer disconnected unexpectedly; scheduling reconnect');
    scheduleReconnect(INITIAL_RETRY_DELAY_MS);
  }
});

consumer.on(consumer.events.CRASH, ({ payload }) => {
  const wasRunning = consumerRunning;
  consumerRunning = false;
  const errMsg = payload?.error?.message || 'Unknown consumer crash';
  logger.error('Kafka Consumer crashed', { error: errMsg });
  if (wasRunning && !isShuttingDown && !isStarting && !retryTimer) {
    scheduleReconnect(INITIAL_RETRY_DELAY_MS);
  }
});

const safeRecordFailedEvent = async ({ rawPayload, reason, topic, partition, offset }) => {
  try {
    await inventoryRepository.recordFailedEvent({
      rawPayload,
      reason,
      topic,
      partition,
      offset: String(offset),
    });
  } catch (dbErr) {
    logger.error('Failed to persist record into failed_events', {
      topic,
      partition,
      offset: String(offset),
      error: dbErr.message,
    });
  }
};

const handleKafkaMessage = async ({ topic = TOPIC, partition = 0, message }) => {
  const offsetStr = String(message?.offset ?? '');
  const rawPayload = message?.value !== undefined && message?.value !== null
    ? message.value.toString('utf8')
    : '';

  let parsed;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (err) {
    const reason = `Invalid JSON payload: ${err.message}`;
    logger.warn('Skipping invalid Kafka JSON message', {
      topic,
      partition,
      offset: offsetStr,
      reason,
    });
    await safeRecordFailedEvent({
      rawPayload,
      reason,
      topic,
      partition,
      offset: offsetStr,
    });
    return { status: 'failed', reason };
  }

  const validation = validateInventoryEvent(parsed);
  if (!validation.valid) {
    const reason = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    logger.warn('Skipping invalid Kafka event message', {
      topic,
      partition,
      offset: offsetStr,
      reason,
    });
    await safeRecordFailedEvent({
      rawPayload,
      reason,
      topic,
      partition,
      offset: offsetStr,
    });
    return { status: 'failed', reason };
  }

  try {
    const result = await fifoService.processEvent(validation.value, {
      topic,
      partition,
      offset: offsetStr,
    });
    return result;
  } catch (err) {
    if (
      err instanceof fifoService.InsufficientStockError ||
      err instanceof fifoService.EventValidationError
    ) {
      const reason =
        err instanceof fifoService.InsufficientStockError
          ? `Insufficient stock for ${err.productId}: requested ${err.requestedQuantity}, available ${err.availableQuantity}`
          : err.errors.map((e) => `${e.field}: ${e.message}`).join('; ');

      logger.warn('Skipping rejected Kafka event message', {
        topic,
        partition,
        offset: offsetStr,
        reason,
      });
      await safeRecordFailedEvent({
        rawPayload,
        reason,
        topic,
        partition,
        offset: offsetStr,
      });
      return { status: 'failed', reason };
    }

    logger.error('Error processing message from Kafka', {
      topic,
      partition,
      offset: offsetStr,
      error: err.message,
    });
    return { status: 'error', reason: err.message };
  }
};

const startConsumer = async () => {
  // Guard against starting two consumers in the same Node process
  if (consumerRunning || isStarting) {
    logger.warn('Kafka Consumer is already running or starting in this process; skipping duplicate start.');
    return;
  }
  if (isShuttingDown) {
    return;
  }

  isStarting = true;
  try {
    await consumer.connect();
    logger.info('Kafka Consumer connected', { groupId: GROUP_ID, topic: TOPIC });

    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        await handleKafkaMessage({ topic, partition, message });
      },
    });

    consumerRunning = true;
  } finally {
    isStarting = false;
  }
};

const scheduleReconnect = (delayMs) => {
  if (isShuttingDown || consumerRunning || retryTimer) {
    return;
  }
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    await startConsumerWithRetry(delayMs);
  }, delayMs);
};

const startConsumerWithRetry = async (delayMs = INITIAL_RETRY_DELAY_MS) => {
  if (isShuttingDown || consumerRunning || isStarting) {
    return;
  }
  try {
    await startConsumer();
  } catch (err) {
    consumerRunning = false;
    await consumer.disconnect().catch(() => {});
    const nextDelay = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
    logger.error(`Kafka Consumer failed to start; retrying in ${delayMs / 1000}s`, {
      error: err.message,
    });
    scheduleReconnect(nextDelay);
  }
};

const disconnectConsumer = async () => {
  isShuttingDown = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    await consumer.disconnect();
  } catch (err) {
    logger.warn('Error disconnecting Kafka Consumer', { error: err.message });
  } finally {
    consumerRunning = false;
  }
};

const isConsumerRunning = () => consumerRunning;

module.exports = {
  startConsumer,
  startConsumerWithRetry,
  disconnectConsumer,
  isConsumerRunning,
  handleKafkaMessage,
};
