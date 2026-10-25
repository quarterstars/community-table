const fs = require('node:fs');
const dotenv = require('dotenv');
const { readConfig, loadEnvironment, projectEnvPath } = require('../src/config');
const { createRedactor, redactError } = require('../src/lib/redact');
const { connectDatabase } = require('../src/db');

async function main() {
  let env = {};
  try {
    const loading = loadEnvironment();
    env = process.argv.includes('--env-only') ? dotenv.parse(fs.readFileSync(projectEnvPath)) : process.env;
    const config = readConfig(env);
    const uri = new URL(config.mongoUri);
    const example = fs.existsSync(projectEnvPath + '.example') ? dotenv.parse(fs.readFileSync(projectEnvPath + '.example')) : {};
    console.log(JSON.stringify({ rootEnvLoaded: loading.fileLoaded, staleShellCredentialsOverridden: loading.overriddenCredentials, directEnvOnly: process.argv.includes('--env-only'), uriParsed: true, credentialsPresent: Boolean(uri.username && uri.password), explicitAuthSource: uri.searchParams.get('authSource') === 'admin' ? 'admin' : uri.searchParams.has('authSource') ? 'non-admin' : 'not specified; Atlas SRV supplies admin', exampleContainsCredentials: /@/.test(example.MONGODB_URI || '') || Boolean(example.SESSION_SECRET) }));
    const database = await connectDatabase(config.mongoUri);
    try { console.log('SUCCESS: MongoDB connection, required indexes, and a real transaction verified.'); }
    finally { await database.connection.close(); }
  } catch (error) {
    console.error('FAILED:', JSON.stringify(redactError(error, createRedactor(env)), null, 2));
    process.exitCode = 1;
  }
}
if (require.main === module) main();
