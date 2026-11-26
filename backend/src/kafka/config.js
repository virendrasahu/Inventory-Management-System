const { Kafka, logLevel } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
require('dotenv').config();

const BACKEND_ROOT = path.resolve(__dirname, '../..');

const resolveExistingFile = (rawPath) => {
  if (!rawPath) return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;
  if (fs.existsSync(trimmed)) return trimmed;
  const backendRelative = path.resolve(BACKEND_ROOT, trimmed);
  if (fs.existsSync(backendRelative)) return backendRelative;
  return null;
};

const getKafkaConstants = (env = process.env) => ({
  KAFKA_CLIENT_ID: env.KAFKA_CLIENT_ID || 'inventory-app',
  KAFKA_GROUP_ID: env.KAFKA_GROUP_ID || 'inventory-consumer-group',
  KAFKA_TOPIC: env.KAFKA_TOPIC || 'inventory-events',
});

const buildKafkaConfig = (overrides = {}, env = process.env) => {
  const { KAFKA_CLIENT_ID } = getKafkaConstants(env);
  const brokers = env.KAFKA_BROKERS
    ? env.KAFKA_BROKERS.split(',').map((b) => b.trim()).filter(Boolean)
    : [];

  const kafkaConfig = {
    clientId: KAFKA_CLIENT_ID,
    brokers,
    connectionTimeout: 10000,
    authenticationTimeout: 10000,
    logLevel: logLevel.WARN,
    ...overrides,
  };

  if (env.KAFKA_SSL === 'true') {
    const sslOptions = { rejectUnauthorized: true };

    // Use CA certificate from KAFKA_SSL_CA_PATH (no client cert/key read)
    const caPath = env.KAFKA_SSL_CA_PATH ? env.KAFKA_SSL_CA_PATH.trim() : '';
    const rawCa = env.KAFKA_SSL_CA ? env.KAFKA_SSL_CA.trim() : '';

    if (caPath) {
      const resolvedCa = resolveExistingFile(caPath);
      if (resolvedCa) {
        sslOptions.ca = [fs.readFileSync(resolvedCa, 'utf-8')];
      } else {
        logger.warn('KAFKA_SSL_CA_PATH file not found; using default Node trust store', { caPath });
      }
    } else if (rawCa) {
      sslOptions.ca = [rawCa.replace(/\\n/g, '\n')];
    } else {
      logger.warn('KAFKA_SSL=true without KAFKA_SSL_CA_PATH; using default Node trust store');
    }

    kafkaConfig.ssl = sslOptions;
  }

  if (env.KAFKA_USERNAME && env.KAFKA_PASSWORD) {
    kafkaConfig.sasl = {
      mechanism: (env.KAFKA_SASL_MECHANISM || 'scram-sha-256').trim().toLowerCase(),
      username: env.KAFKA_USERNAME,
      password: env.KAFKA_PASSWORD,
    };
  } else if (env.KAFKA_USERNAME || env.KAFKA_PASSWORD) {
    logger.warn('Incomplete SASL configuration: both KAFKA_USERNAME and KAFKA_PASSWORD are required');
  }

  return kafkaConfig;
};

const createKafkaInstance = (overrides = {}, env = process.env) => {
  const constants = getKafkaConstants(env);
  const instance = new Kafka(buildKafkaConfig(overrides, env));
  instance.KAFKA_CLIENT_ID = constants.KAFKA_CLIENT_ID;
  instance.KAFKA_GROUP_ID = constants.KAFKA_GROUP_ID;
  instance.KAFKA_TOPIC = constants.KAFKA_TOPIC;
  instance.createKafkaInstance = createKafkaInstance;
  instance.buildKafkaConfig = buildKafkaConfig;
  return instance;
};

const kafka = createKafkaInstance();

module.exports = kafka;
