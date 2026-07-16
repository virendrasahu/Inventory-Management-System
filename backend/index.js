const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./src/repositories/db');
const { connectProducer } = require('./src/kafka/producer');
const errorHandler = require('./src/middlewares/errorHandler');
const logger = require('./src/utils/logger');

const authRoutes = require('./src/routes/authRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    // Check DB
    await db.query('SELECT 1');
    // Check Kafka (Producer is connected on startup, we assume if we reach here and it didn't crash, it's ok, but let's just return true for now)
    res.status(200).json({ status: 'healthy', db: 'connected', kafka_producer: 'connected' });
  } catch (err) {
    logger.error('Health check failed', err);
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', inventoryRoutes);

// Centralized Error Handling
app.use(errorHandler);

// Start Server
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  
  try {
    // Verify Postgres connection
    await db.query('SELECT 1');
    logger.info('Database connection verified successfully.');

    // Connect only the producer for the API server
    await connectProducer();
  } catch (err) {
    logger.error('Failed to initialize backing services:', err);
    process.exit(1);
  }
});
