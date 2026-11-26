const { startConsumerWithRetry, disconnectConsumer } = require('./src/kafka/consumer');
const db = require('./src/repositories/db');
const logger = require('./src/utils/logger');

const runWorker = async () => {
  logger.info('Starting Kafka Consumer Worker...');
  try {
    await db.query('SELECT 1');
    logger.info('Worker connected to Database');
  } catch (err) {
    logger.error('Initial worker database check failed:', { error: err.message });
  }

  await startConsumerWithRetry();
};

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Worker received ${signal}, disconnecting consumer...`);
  await disconnectConsumer();
  await db.pool.end().catch(() => {});
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

runWorker();
