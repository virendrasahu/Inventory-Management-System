const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./src/repositories/db');
const {
  connectProducerWithRetry,
  disconnectProducer,
  isProducerConnected,
} = require('./src/kafka/producer');
const {
  startConsumerWithRetry,
  disconnectConsumer,
  isConsumerRunning,
} = require('./src/kafka/consumer');
const errorHandler = require('./src/middlewares/errorHandler');
const logger = require('./src/utils/logger');

const authRoutes = require('./src/routes/authRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');

const app = express();

const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:5173,http://127.0.0.1:5173,https://inventory-management-system-ebon-beta.vercel.app'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Root Route
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'inventory-api' });
});

// Health Check Endpoint
app.get('/health', async (req, res) => {
  const kafkaProducerStatus = isProducerConnected() ? 'connected' : 'disconnected';
  const kafkaConsumerStatus = isConsumerRunning() ? 'running' : 'stopped';

  let databaseStatus = 'connected';
  try {
    await db.query('SELECT 1');
  } catch (err) {
    logger.error('Health check database query failed', { error: err.message });
    databaseStatus = 'error';
  }

  if (databaseStatus === 'error') {
    return res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      kafka_producer: kafkaProducerStatus,
      kafka_consumer: kafkaConsumerStatus,
    });
  }

  const kafkaReady = kafkaProducerStatus === 'connected' && kafkaConsumerStatus === 'running';
  return res.status(200).json({
    status: kafkaReady ? 'healthy' : 'degraded',
    database: 'connected',
    kafka_producer: kafkaProducerStatus,
    kafka_consumer: kafkaConsumerStatus,
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', inventoryRoutes);

// Centralized Error Handling
app.use(errorHandler);

// Start HTTP Server first, then connect DB & Kafka in background
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);

  db.query('SELECT 1')
    .then(() => {
      logger.info('Database connection verified successfully.');
    })
    .catch((err) => {
      logger.error('Initial database connection check failed:', { error: err.message });
    });

  connectProducerWithRetry();
  if (process.env.DISABLE_IN_PROCESS_CONSUMER !== 'true') {
    startConsumerWithRetry();
  }
});

// Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  await Promise.allSettled([disconnectProducer(), disconnectConsumer()]);

  server.close(() => {
    db.pool
      .end()
      .catch(() => {})
      .finally(() => process.exit(0));
  });

  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
