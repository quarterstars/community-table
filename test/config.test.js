const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readConfig, loadEnvironment, projectEnvPath } = require('../src/config');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRedactor, redactError } = require('../src/lib/redact');
const { chicagoInput, parseChicagoTime } = require('../src/lib/chicago-time');
const { createApp } = require('../src/app');

test('missing credentials and weak secrets fail clearly without a fallback database', () => {
  assert.throws(() => readConfig({}), /Missing MONGODB_URI and SESSION_SECRET/);
  assert.throws(() => readConfig({ MONGODB_URI: 'mongodb://127.0.0.1/example', SESSION_SECRET: 'short' }), /at least 32 bytes/);
  assert.throws(() => createApp({}), /verified MongoDB connection/);
});

test('root environment loading replaces stale shell credentials, preserves explicit runtime settings, and never loads examples', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'community-config-test-'));
  try {
    const envPath = path.join(folder, '.env');
    fs.writeFileSync(envPath, 'MONGODB_URI=mongodb://127.0.0.1/file_database\nSESSION_SECRET=' + 'f'.repeat(64) + '\nPORT=3000\n');
    fs.writeFileSync(envPath + '.example', 'MONGODB_URI=mongodb://127.0.0.1/wrong_database\n');
    const env = { MONGODB_URI: 'mongodb://127.0.0.1/stale_database', SESSION_SECRET: 's'.repeat(64), PORT: '3001' };
    const result = loadEnvironment({ env, envPath });
    assert.deepEqual(result.overriddenCredentials, ['MONGODB_URI', 'SESSION_SECRET']);
    assert.equal(env.MONGODB_URI, 'mongodb://127.0.0.1/file_database');
    assert.equal(env.PORT, '3001');
    assert.equal(projectEnvPath, path.resolve(__dirname, '../.env'));
    fs.unlinkSync(envPath);
    const absent = {};
    assert.equal(loadEnvironment({ env: absent, envPath }).fileLoaded, false);
    assert.deepEqual(absent, {});
  } finally { fs.rmSync(folder, { recursive: true }); }
});

test('connection diagnostics redact complete URIs, encoded/raw credentials, and session secrets', () => {
  const env = { MONGODB_URI: 'mongodb+srv://sample-user:sample%40password@sample.example/database', SESSION_SECRET: 'sample-session-secret-00000' };
  const error = new Error(`URI ${env.MONGODB_URI}; user sample-user; password sample@password / sample%40password; secret ${env.SESSION_SECRET}`);
  const output = JSON.stringify(redactError(error, createRedactor(env)));
  for (const value of [env.MONGODB_URI, 'sample-user', 'sample@password', 'sample%40password', env.SESSION_SECRET]) assert.ok(!output.includes(value));
  assert.match(output, /REDACTED/);
});

test('Chicago form dates round-trip, reject invalid and ambiguous DST times, and do not use server timezone', () => {
  assert.equal(chicagoInput(parseChicagoTime('2026-07-10T15:30')), '2026-07-10T15:30');
  assert.equal(parseChicagoTime('2026-07-10T15:30').toISOString(), '2026-07-10T20:30:00.000Z');
  assert.equal(parseChicagoTime('2026-12-10T15:30').toISOString(), '2026-12-10T21:30:00.000Z');
  for (const value of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-02-31T12:30']) assert.throws(() => parseChicagoTime(value), /does not exist|occurs twice/);
});

test('production uses explicit settings, and unsafe proxy/port settings are rejected', () => {
  const env = { MONGODB_URI: 'mongodb://127.0.0.1/example', SESSION_SECRET: 'a'.repeat(64), NODE_ENV: 'production', TRUST_PROXY: '1' };
  assert.equal(readConfig(env).production, true);
  assert.equal(readConfig(env).trustProxy, 1);
  assert.throws(() => readConfig({ ...env, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
  assert.throws(() => readConfig({ ...env, PORT: '0' }), /PORT/);
});
