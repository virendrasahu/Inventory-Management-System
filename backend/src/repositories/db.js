const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

let activePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const initDB = async () => {
  try {
    const setupSql = fs.readFileSync(path.join(__dirname, '../../setup.sql'), 'utf8');
    await activePool.query(setupSql);

    const migrationsDir = path.join(__dirname, '../../migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await activePool.query(migrationSql);
        logger.info(`Applied migration: ${file}`);
      }
    }

    logger.info('Database initialized successfully.');
  } catch (err) {
    logger.error('Error initializing database:', err);
    throw err;
  }
};

module.exports = {
  query: (text, params) => activePool.query(text, params),
  get pool() {
    return activePool;
  },
  setPool: (customPool) => {
    activePool = customPool;
  },
  initDB
};
