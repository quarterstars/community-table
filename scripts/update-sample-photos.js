const { loadEnvironment } = require('../src/config');
const { connectDatabase } = require('../src/db');
const photos = require('../src/data/food-photos.json');

async function updateSamplePhotos({ connection, models }) {
  return connection.transaction(async session => {
    let changed = 0;
    for (const photo of photos) {
      // Only replace the known neutral placeholder on these exact fictional
      // samples. Preserve customized images and every reservation snapshot.
      const result = await models.Listing.updateOne({ slug: photo.listingId, isDemo: true, image: '/images/food-placeholder.svg', imageType: 'placeholder' }, {
        $set: { image: photo.image, imageType: 'photo', imageAlt: photo.imageAlt, 'translations.am.imageAlt': photo.amImageAlt },
        $inc: { revision: 1 }
      }, { session, timestamps: false });
      changed += result.modifiedCount;
    }
    return changed;
  });
}
async function main() {
  loadEnvironment();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing.');
  const database = await connectDatabase(process.env.MONGODB_URI);
  try {
    const changed = await updateSamplePhotos(database);
    console.log(`Updated photos on ${changed} fictional sample listings. IDs, quantities, pickup windows, accounts and reservation snapshots were preserved.`);
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(() => { console.error('Sample photo update failed. Check the configured MongoDB connection; no reset was performed.'); process.exitCode = 1; });
module.exports = { updateSamplePhotos };
