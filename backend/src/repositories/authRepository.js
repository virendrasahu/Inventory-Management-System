const db = require('./db');

const getUserByUsername = async (username) => {
  const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0];
};

const getUserByUsernameOrEmail = async (identifier) => {
  const result = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [identifier]);
  return result.rows[0];
};

const createUser = async (userData) => {
  const { full_name, username, email, password_hash } = userData;
  const result = await db.query(
    `INSERT INTO users (full_name, username, email, password_hash) 
     VALUES ($1, $2, $3, $4) RETURNING id, full_name, username, email, created_at`,
    [full_name, username, email, password_hash]
  );
  return result.rows[0];
};

module.exports = {
  getUserByUsername,
  getUserByUsernameOrEmail,
  createUser
};
