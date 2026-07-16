const bcrypt = require('bcrypt');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const seedAdmin = async () => {
  try {
    const saltRounds = 10;
    const plainPassword = 'admin';
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

    await pool.query(`
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (username) DO NOTHING
    `, ['admin', hashedPassword]);

    console.log('Admin user seeded successfully');
  } catch (error) {
    console.error('Error seeding admin user:', error);
  } finally {
    await pool.end();
  }
};

seedAdmin();
