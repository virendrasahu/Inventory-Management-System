const jwt = require('jsonwebtoken');
require('dotenv').config();
const logger = require('../utils/logger');

const DEV_FALLBACK_SECRET = 'fallback-secret-for-dev';
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

const resolveJwtSecret = (env = process.env) => {
  const nodeEnv = env.NODE_ENV;
  const secret = env.JWT_SECRET;

  if (nodeEnv === 'production') {
    if (
      !secret ||
      typeof secret !== 'string' ||
      secret.trim().length < MIN_PRODUCTION_JWT_SECRET_LENGTH
    ) {
      throw new Error(
        `FATAL: JWT_SECRET must be set and at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters long when NODE_ENV is "production".`
      );
    }
    return secret;
  }

  if (!secret) {
    logger.warn(
      'JWT_SECRET is not set; using fallback-secret-for-dev (allowed only when NODE_ENV is not "production").'
    );
    return DEV_FALLBACK_SECRET;
  }

  return secret;
};

const JWT_SECRET = resolveJwtSecret();

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

module.exports = {
  verifyToken,
  JWT_SECRET,
  resolveJwtSecret,
  DEV_FALLBACK_SECRET,
  MIN_PRODUCTION_JWT_SECRET_LENGTH,
};
