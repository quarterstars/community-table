const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { migrateOrganizations } = require('../src/services/development');
async function main() {
  loadEnvironment();
  const config = readConfig();
  const database = await connectDatabase(config.mongoUri);
  try {
    const result = await migrateOrganizations(database);
    console.log(`Organization migration complete: ${result.linkedListings} listing relationships and ${result.linkedReservations} reservation relationships added. Inventory, codes, pickup dates, snapshots and account roles were preserved.`);
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(() => { console.error('Organization migration failed. Check configuration, authentication, and existing relationships. No reset or deletion was performed.'); process.exitCode = 1; });
