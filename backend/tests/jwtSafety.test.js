const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const logger = require('../src/utils/logger');
const {
  resolveJwtSecret,
  DEV_FALLBACK_SECRET,
} = require('../src/middlewares/auth');

describe('JWT Secret Safety', () => {
  it('refuses to start in production when JWT_SECRET is missing or shorter than 32 characters', () => {
    assert.throws(
      () => resolveJwtSecret({ NODE_ENV: 'production' }),
      /JWT_SECRET must be set and at least 32 characters/
    );

    assert.throws(
      () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short-secret' }),
      /JWT_SECRET must be set and at least 32 characters/
    );

    const validSecret = 'a-very-long-and-secure-secret-key-12345';
    assert.equal(
      resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: validSecret }),
      validSecret
    );
  });

  it('prevents backend/index.js process startup in production with missing or short JWT_SECRET', () => {
    const backendDir = path.resolve(__dirname, '..');
    const result = spawnSync(
      process.execPath,
      ['-e', "require('./index.js')"],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          JWT_SECRET: 'short',
          DOTENV_CONFIG_PATH: path.join(backendDir, '.env.example'),
        },
        encoding: 'utf8',
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET must be set and at least 32 characters/);
  });

  it('uses fallback-secret-for-dev and logs a warning only outside production', () => {
    const warnings = [];
    const originalWarn = logger.warn.bind(logger);
    logger.warn = (msg, meta) => {
      warnings.push({ msg, meta });
    };

    try {
      const secret = resolveJwtSecret({ NODE_ENV: 'development' });
      assert.equal(secret, DEV_FALLBACK_SECRET);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0].msg, /fallback-secret-for-dev/);
    } finally {
      logger.warn = originalWarn;
    }
  });
});
