const { Partitioners } = require('kafkajs');
const logger = require('../utils/logger');
const kafka = require('./config');

const TOPIC = kafka.KAFKA_TOPIC;
const MAX_RETRY_DELAY_MS = 60000;
const INITIAL_RETRY_DELAY_MS = 2000;

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});

let producerConnected = false;
let retryTimer = null;
let isShuttingDown = false;
let isConnecting = false;

producer.on(producer.events.CONNECT, () => {
  producerConnected = true;
});

producer.on(producer.events.DISCONNECT, () => {
  const wasConnected = producerConnected;
  producerConnected = false;
  if (wasConnected && !isShuttingDown && !isConnecting && !retryTimer) {
    logger.warn('Kafka Producer disconnected unexpectedly; scheduling reconnect');
    scheduleReconnect(INITIAL_RETRY_DELAY_MS);
  }
});

const ensureTopicExists = async () => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(TOPIC)) {
      logger.info(`Topic ${TOPIC} does not exist, creating...`);
      await admin.createTopics({
        topics: [{ topic: TOPIC, numPartitions: 1 }],
      });
      logger.info(`Topic ${TOPIC} created successfully.`);
    } else {
      logger.info(`Topic ${TOPIC} already exists.`);
    }
  } finally {
    await admin.disconnect().catch(() => {});
  }
};

const formatKafkaError = (err) => ({
  name: err?.name,
  type: err?.type,
  code: err?.code,
  retriable: err?.retriable,
  message: err?.message,
  cause: err?.cause?.message,
  stack: err?.stack,
});

const connectProducer = async () => {
  if (producerConnected || isConnecting || isShuttingDown) {
    return;
  }
  isConnecting = true;
  try {
    await producer.connect();
    producerConnected = true;
    logger.info('Kafka Producer connected');

    try {
      await ensureTopicExists();
    } catch (topicErr) {
      logger.warn('Kafka topic check failed after producer connect', formatKafkaError(topicErr));
    }
  } catch (err) {
    producerConnected = false;
    logger.error('Kafka Producer connect error at startup', formatKafkaError(err));
    throw err;
  } finally {
    isConnecting = false;
  }
};

const scheduleReconnect = (delayMs) => {
  if (isShuttingDown || producerConnected || retryTimer) {
    return;
  }
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    await connectProducerWithRetry(delayMs);
  }, delayMs);
};

const connectProducerWithRetry = async (delayMs = INITIAL_RETRY_DELAY_MS) => {
  if (isShuttingDown || producerConnected) {
    return;
  }
  try {
    await connectProducer();
  } catch (err) {
    producerConnected = false;
    const nextDelay = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
    logger.error(`Kafka Producer connection failed; retrying in ${delayMs / 1000}s`, formatKafkaError(err));
    scheduleReconnect(nextDelay);
  }
};

const disconnectProducer = async () => {
  isShuttingDown = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    await producer.disconnect();
  } catch (err) {
    logger.warn('Error disconnecting Kafka Producer', { error: err.message });
  } finally {
    producerConnected = false;
  }
};

const isProducerConnected = () => producerConnected;

const produceEvent = async (event) => {
  if (!producerConnected) {
    const err = new Error('Kafka producer is not connected');
    err.code = 'KAFKA_PRODUCER_DISCONNECTED';
    throw err;
  }
  try {
    await producer.send({
      topic: TOPIC,
      messages: [{ value: JSON.stringify(event) }],
    });
    logger.info('Successfully produced event to Kafka', { event });
  } catch (err) {
    logger.error('Error producing event', { error: err.message });
    throw err;
  }
};

module.exports = {
  connectProducer,
  connectProducerWithRetry,
  disconnectProducer,
  isProducerConnected,
  produceEvent,
};
