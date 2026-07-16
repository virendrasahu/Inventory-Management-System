const { Kafka } = require('kafkajs');
const fifoService = require('../services/fifoService');
const logger = require('../utils/logger');
require('dotenv').config();

const kafka = require('./config');

const consumer = kafka.consumer({ groupId: 'inventory-group' });
const TOPIC = 'inventory-events';

const startConsumer = async () => {
  try {
    await consumer.connect();
    logger.info('Kafka Consumer connected');

    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          logger.info('Received event from Kafka', { event });
          await fifoService.processEvent(event);
        } catch (err) {
          logger.error('Error processing message from Kafka', { error: err.message });
        }
      },
    });
  } catch (err) {
    logger.error('Error connecting Kafka Consumer', { error: err.message });
  }
};

module.exports = {
  startConsumer
};
