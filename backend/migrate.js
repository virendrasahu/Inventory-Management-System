const db = require('./src/repositories/db');
const logger = require('./src/utils/logger');

const runMigration = async () => {
  try {
    await db.initDB();
    logger.info('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    logger.error('Migration failed:', err);
    process.exit(1);
  }
};

runMigration();
