const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { auditAccountTypes, migrateAccountTypes } = require('../src/services/accounts');
(async () => {
  loadEnvironment(); const config = readConfig(); const database = await connectDatabase(config.mongoUri);
  try {
    const apply = process.argv.includes('--apply');
    const result = apply ? await migrateAccountTypes(database) : await auditAccountTypes(database);
    console.log(JSON.stringify({ legacyInactiveWithHistory: result.conflicts.length, legacyInactiveWithoutHistory: result.candidates.length, migrated: 0 }));
    console.log('Account-type conversion is retired. All accounts can share and receive. Legacy organization access is unchanged; grant individual memberships explicitly.');
  } finally { await database.connection.close(); }
})().catch(() => { console.error('Account type migration failed; check configuration and database connection.'); process.exitCode = 1; });
