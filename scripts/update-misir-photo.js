const { loadEnvironment } = require('../src/config');
const { connectDatabase } = require('../src/db');
const photo = require('../src/data/food-photos.json').find(photo => photo.listingId === 'sample-misir-wot-injera');

async function updateMisirPhoto({ connection, models }) {
  return connection.transaction(async session => {
    const result = await models.Listing.updateOne({ slug: photo.listingId, isDemo: true, image: '/images/foods/misir-wot.webp', imageType: 'photo' }, {
      $set: { image: photo.image, imageAlt: photo.imageAlt, 'translations.am.imageAlt': photo.amImageAlt },
      $inc: { revision: 1 }
    }, { session, timestamps: false });
    return result.modifiedCount;
  });
}
async function main() {
  loadEnvironment();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing.');
  const database = await connectDatabase(process.env.MONGODB_URI);
  try {
    const changed = await updateMisirPhoto(database);
    console.log(`Corrected photo metadata on ${changed} misir wot listing. IDs, inventory, reservations and other listings were preserved.`);
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(() => { console.error('Misir photo correction failed. Check the configured MongoDB connection. No reset was performed.'); process.exitCode = 1; });
module.exports = { updateMisirPhoto };
