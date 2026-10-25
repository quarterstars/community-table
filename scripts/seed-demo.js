const { loadEnvironment } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { sampleFoods } = require('../src/data/sample-foods');
const { slugFor } = require('../src/services/development');

async function seedDemo(models, now = new Date()) {
  let inserted = 0;
  for (const [index, sample] of sampleFoods.entries()) {
    // Existing legacy records are linked only by the explicit migration. Skip
    // them completely so seeding cannot create unused events or alter metadata.
    if (await models.Listing.exists({ slug: sample.id })) continue;
    const { id, availablePortions, ...fields } = sample;
    const startsAt = new Date(Math.ceil(now.getTime() / 60000) * 60000 + 24 * 60 * 60 * 1000 + index * 60 * 60 * 1000);
    const organization = await models.Organization.findOneAndUpdate({ slug: slugFor(sample.organization) }, { $setOnInsert: { slug: slugFor(sample.organization), name: sample.organization, isDemo: true, createdAt: now, updatedAt: now } }, { upsert: true, new: true, timestamps: false });
    if (!organization.isDemo || organization.name !== sample.organization) throw new Error('A seed organization slug is already in use. No existing listing was reset.');
    const event = await models.Event.findOneAndUpdate({ organization: organization._id, seedKey: id }, { $setOnInsert: { organization: organization._id, seedKey: id, title: `${sample.name} pickup`, pickupStartsAt: startsAt, pickupEndsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000), pickupLocation: sample.pickupLocation, pickupInstructions: sample.pickupInstructions, status: 'open', createdAt: now, updatedAt: now } }, { upsert: true, new: true, timestamps: false });
    if (event.pickupEndsAt <= now) throw new Error('An existing seed event has expired. Use a fresh development database or create a new event; no existing window was reset.');
    const record = {
      ...fields, slug: id, totalPortions: availablePortions, availablePortions, perAccountLimit: 3,
      organizationId: organization._id, eventId: event._id,
      pickupStartsAt: event.pickupStartsAt, pickupEndsAt: event.pickupEndsAt,
      status: 'open', isDemo: true, createdAt: now, updatedAt: now
    };
    await new models.Listing(record).validate();
    const result = await models.Listing.updateOne({ slug: id }, { $setOnInsert: record }, { upsert: true, timestamps: false });
    inserted += result.upsertedCount;
  }
  return inserted;
}
async function main() {
  loadEnvironment();
  if (process.env.NODE_ENV === 'production') throw new Error('Development seeding is disabled in production.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing. Configure .env before seeding.');
  const database = await connectDatabase(process.env.MONGODB_URI);
  try {
    const inserted = await seedDemo(database.models);
    console.log(`Inserted ${inserted} fictional demo listings with future pickup windows. Existing listings and inventory were left intact.`);
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch((error) => {
  console.error(error.message === 'MONGODB_URI is missing. Configure .env before seeding.' || error.message === 'Development seeding is disabled in production.' ? error.message : 'Demo seeding failed. Check the MongoDB replica-set connection and permissions. No reset was performed.');
  process.exitCode = 1;
});
module.exports = { seedDemo };
