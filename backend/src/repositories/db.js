const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const initDB = async () => {
  try {
    const setupSql = fs.readFileSync(path.join(__dirname, '../../setup.sql'), 'utf8');
    await pool.query(setupSql);
    logger.info('Database initialized successfully.');
  } catch (err) {
    logger.error('Error initializing database:', err);
    throw err;
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initDB
};
