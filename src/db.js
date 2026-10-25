const mongoose = require('mongoose');
const { createModels } = require('./models');

async function connectDatabase(uri, options = {}) {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
    ...options
  });
  try {
    await connection.asPromise();
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
      throw new Error('TRANSACTIONS_REQUIRED');
    }
    const models = createModels(connection);
    // Never remove existing indexes or data. Unique indexes must exist before serving writes.
    await Promise.all(Object.values(models).map((model) => model.init()));
    await connection.db.collection('sessions').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    await connection.db.collection('rate_limits').createIndex({ resetTime: 1 }, { expireAfterSeconds: 0 });
    // Actually start a transaction; a connection alone does not prove transaction support.
    await connection.transaction(async (session) => {
      await models.Listing.findOne().session(session).lean();
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return { connection, models };
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
}

module.exports = { connectDatabase };
