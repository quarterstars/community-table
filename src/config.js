const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const projectEnvPath = path.join(__dirname, '..', '.env');
class ConfigurationError extends Error {}

function loadEnvironment({ env = process.env, envPath = projectEnvPath } = {}) {
  const overriddenCredentials = [];
  if (!fs.existsSync(envPath)) return { fileLoaded: false, overriddenCredentials };
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    // Project credentials take precedence over stale shell exports. Other shell
    // settings (for example PORT and NODE_ENV) remain explicit runtime overrides.
    if (['MONGODB_URI', 'SESSION_SECRET'].includes(key)) {
      if (Object.hasOwn(env, key) && env[key] !== value) overriddenCredentials.push(key);
      env[key] = value;
    } else if (!Object.hasOwn(env, key)) env[key] = value;
  }
  return { fileLoaded: true, overriddenCredentials };
}

function readConfig(env = process.env) {
  const missing = ['MONGODB_URI', 'SESSION_SECRET'].filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new ConfigurationError(`Missing ${missing.join(' and ')}. Copy .env.example to .env and configure MongoDB and a random session secret. See README.md.`);
  }
  if (Buffer.byteLength(env.SESSION_SECRET) < 32) {
    throw new ConfigurationError('SESSION_SECRET must contain at least 32 bytes. Generate a random secret using the command in .env.example.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI)) {
    throw new ConfigurationError('MONGODB_URI must be a MongoDB connection string.');
  }
  if (env.TRUST_PROXY && !['0', '1'].includes(env.TRUST_PROXY)) {
    throw new ConfigurationError('TRUST_PROXY must be 0 or 1; use 1 only behind one trusted reverse proxy.');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('PORT must be an integer from 1 to 65535.');
  }
  return {
    mongoUri: env.MONGODB_URI,
    sessionSecret: env.SESSION_SECRET,
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    host: env.HOST || '127.0.0.1',
    port
  };
}

module.exports = { readConfig, ConfigurationError, loadEnvironment, projectEnvPath };
