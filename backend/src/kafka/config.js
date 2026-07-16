const { Kafka } = require('kafkajs');
const fs = require('fs');
require('dotenv').config();

const kafkaConfig = {
  clientId: process.env.KAFKA_CLIENT_ID || 'inventory-app',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : [],
};

if (process.env.KAFKA_SSL === 'true') {
  kafkaConfig.ssl = {};
  
  if (process.env.KAFKA_SSL_CA_PATH) {
    kafkaConfig.ssl.ca = [fs.readFileSync(process.env.KAFKA_SSL_CA_PATH, 'utf-8')];
  }
  if (process.env.KAFKA_SSL_CERT_PATH) {
    kafkaConfig.ssl.cert = fs.readFileSync(process.env.KAFKA_SSL_CERT_PATH, 'utf-8');
  }
  if (process.env.KAFKA_SSL_KEY_PATH) {
    kafkaConfig.ssl.key = fs.readFileSync(process.env.KAFKA_SSL_KEY_PATH, 'utf-8');
  }
  
  // If no explicit certificates are provided, default to standard TLS without strict authorization for testing
  if (Object.keys(kafkaConfig.ssl).length === 0) {
    kafkaConfig.ssl = { rejectUnauthorized: false };
  }
}

if (process.env.KAFKA_SASL_MECHANISM) {
  kafkaConfig.sasl = {
    mechanism: process.env.KAFKA_SASL_MECHANISM,
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
  };
}

const kafka = new Kafka(kafkaConfig);

module.exports = kafka;
