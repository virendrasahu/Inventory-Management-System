const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');
require('dotenv').config();

const kafka = require('./config');

const producer = kafka.producer();
const TOPIC = 'inventory-events';

const connectProducer = async () => {
  try {
    const admin = kafka.admin();
    await admin.connect();
    
    const topics = await admin.listTopics();
    if (!topics.includes(TOPIC)) {
      logger.info(`Topic ${TOPIC} does not exist, creating...`);
      await admin.createTopics({
        topics: [{ topic: TOPIC, numPartitions: 1 }]
      });
      logger.info(`Topic ${TOPIC} created successfully.`);
    } else {
      logger.info(`Topic ${TOPIC} already exists.`);
    }
    await admin.disconnect();

    await producer.connect();
    logger.info('Kafka Producer connected');
  } catch (err) {
    logger.error('Error connecting Kafka Producer', { error: err.message });
    throw err;
  }
};

const produceEvent = async (event) => {
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
  produceEvent,
};
