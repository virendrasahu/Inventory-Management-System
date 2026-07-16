const { startConsumer } = require('./src/kafka/consumer');
const db = require('./src/repositories/db');
const logger = require('./src/utils/logger');

const runWorker = async () => {
  logger.info('Starting Kafka Consumer Worker...');
  try {
    // We don't init DB schema here, we just connect
    await db.query('SELECT 1');
    logger.info('Worker connected to Database');
    
    await startConsumer();
  } catch (err) {
    logger.error('Failed to start worker:', err);
    process.exit(1);
  }
};

runWorker();
