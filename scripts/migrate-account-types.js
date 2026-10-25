const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { auditAccountTypes, migrateAccountTypes } = require('../src/services/accounts');
(async () => {
  loadEnvironment(); const config = readConfig(); const database = await connectDatabase(config.mongoUri);
  try {
    const apply = process.argv.includes('--apply');
    const result = apply ? await migrateAccountTypes(database) : await auditAccountTypes(database);
    console.log(JSON.stringify(result, null, 2));
    if (result.conflicts.length) {
      console.error('CONFLICT: reservation history and organizer membership coexist. No account types were migrated. Preserve the recipient account and use a different email for a separate organizer account.');
      process.exitCode = 1;
    } else console.log(apply ? 'Account type migration complete. History and memberships preserved.' : 'Audit only; no data changed. Run with --apply to migrate history-free legacy organizer accounts.');
  } finally { await database.connection.close(); }
})().catch(() => { console.error('Account type migration failed; check configuration and database connection.'); process.exitCode = 1; });
