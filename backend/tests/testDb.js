const fs = require('fs');
const path = require('path');
const { newDb, DataType } = require('pg-mem');
const db = require('../src/repositories/db');

const normalizeForPgMem = (sql, { stripViews = false } = {}) => {
  let out = sql
    .replace(/DECIMAL\(\s*\d+\s*,\s*\d+\s*\)/gi, 'DECIMAL')
    .replace(/NUMERIC\(\s*\d+\s*,\s*\d+\s*\)/gi, 'NUMERIC')
    .replace(/DROP\s+VIEW\s+IF\s+EXISTS\s+transaction_ledger\s*;/gi, '');

  if (stripViews) {
    // pg-mem throws "View.drop: Method not implemented" on CREATE OR REPLACE VIEW for an existing view
    out = out.replace(/CREATE\s+OR\s+REPLACE\s+VIEW\s+transaction_ledger\s+AS[\s\S]*?FROM\s+sales\s*;/gi, '');
  }
  return out;
};

const setupInMemoryDb = () => {
  const mem = newDb();

  // Support PostgreSQL ROUND(numeric, integer) used in transaction_ledger view and migration 003
  mem.public.registerFunction({
    name: 'round',
    args: [DataType.float, DataType.integer],
    returns: DataType.float,
    implementation: (val, decimals) => {
      if (val === null || val === undefined) return null;
      const factor = 10 ** decimals;
      return Math.round(val * factor) / factor;
    },
  });

  // Support PostgreSQL NULLIF(integer, integer) used in migration 003
  mem.public.registerFunction({
    name: 'nullif',
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: (a, b) => (a === b ? null : a),
  });

  const setupSql = fs.readFileSync(path.join(__dirname, '../setup.sql'), 'utf8');
  mem.public.none(normalizeForPgMem(setupSql));

  const migrationsDir = path.join(__dirname, '../migrations');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Note: pg-mem's AST coverage check throws when CREATE TABLE IF NOT EXISTS runs on an existing table,
  // so we execute each migration once per fresh in-memory database instance.
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    mem.public.none(normalizeForPgMem(sql, { stripViews: true }));
  }

  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  db.setPool(pool);

  return { mem, pool };
};

module.exports = {
  setupInMemoryDb,
};
