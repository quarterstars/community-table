const { createApp } = require('./src/app');
const { connectDatabase } = require('./src/db');
const { readConfig, ConfigurationError, loadEnvironment } = require('./src/config');

async function main() {
  let database;
  try {
    loadEnvironment();
    const config = readConfig();
    database = await connectDatabase(config.mongoUri);
    const app = createApp({ ...database, ...config });
    const server = app.listen(config.port, config.host, (error) => {
      if (!error) {
        console.log(`Community Table is running at http://${config.host}:${config.port}`);
        console.log('MongoDB and transactions verified. Demo food listings; reservations are persistent.');
      }
    });
    server.on('error', async (error) => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is in use. Try PORT=3001 npm start.` : 'The local server could not start.');
      await database.connection.close();
      process.exitCode = 1;
    });
    const shutdown = () => server.close(async () => { await database.connection.close(); });
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    if (database) await database.connection.close().catch(() => {});
    console.error(error instanceof ConfigurationError ? error.message : error.message === 'TRANSACTIONS_REQUIRED' ? 'MongoDB must be a replica set or Atlas cluster: reservations require transactions. See README.md.' : 'MongoDB initialization failed. Check MONGODB_URI, network access, and database permissions. No server was started. See README.md.');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { main };
