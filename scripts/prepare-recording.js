const fs = require('node:fs/promises');
const path = require('node:path');
const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { chicagoInput, parseChicagoTime } = require('../src/lib/chicago-time');
const { sampleFoods } = require('../src/data/sample-foods');
const { HttpError } = require('../src/lib/errors');

function recordingWindow(now = new Date()) {
  const today = chicagoInput(now).slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { today, tomorrow, pickupStartsAt: parseChicagoTime(`${today}T00:00`), pickupEndsAt: parseChicagoTime(`${tomorrow}T23:59`) };
}
async function inspectRecording(database, now = new Date()) {
  const { Listing, Reservation } = database.models;
  const samples = await Listing.find({ slug: { $in: sampleFoods.map(food => food.id) } }).populate('eventId', 'status pickupStartsAt pickupEndsAt').lean();
  return { database: database.connection.name, chicagoNow: chicagoInput(now), window: recordingWindow(now), listingCount: await Listing.countDocuments(), reservationCount: await Reservation.countDocuments(), samples: samples.map(food => ({ id: String(food._id), slug: food.slug, isDemo: food.isDemo, status: food.status, available: food.availablePortions, total: food.totalPortions, pickupStartsAt: food.pickupStartsAt, pickupEndsAt: food.pickupEndsAt, image: food.image, event: food.eventId, visible: food.status === 'open' && food.availablePortions > 0 && food.pickupEndsAt > now && (!food.eventId || food.eventId.status === 'open' && food.eventId.pickupEndsAt > now) })) };
}
async function prepareRecording(database, { now = new Date(), production = false } = {}) {
  if (production) throw new HttpError(403, 'Recording preparation is disabled in production.');
  const window = recordingWindow(now);
  const { Listing, Event, Organization } = database.models;
  return database.connection.transaction(async session => {
    const listings = await Listing.find({ slug: { $in: sampleFoods.map(food => food.id) }, isDemo: true }).session(session).lean();
    if (listings.length !== 5) throw new HttpError(409, 'Expected all five existing fictional samples. No changes were made.');
    const ids = listings.map(food => food._id);
    const events = [...new Set(listings.filter(food => food.eventId).map(food => String(food.eventId)))];
    for (const id of events) {
      const event = await Event.findById(id).session(session).lean();
      const organization = event && await Organization.findOne({ _id: event.organization, isDemo: true }).session(session).lean();
      const unrelated = await Listing.exists({ eventId: id, _id: { $nin: ids } }).session(session);
      if (!organization || unrelated) throw new HttpError(409, 'A sample event is shared with unrelated data. No changes were made.');
      await Event.updateOne({ _id: id }, { $set: { status: 'open', pickupStartsAt: new Date(Math.min(event.pickupStartsAt, window.pickupStartsAt)), pickupEndsAt: new Date(Math.max(event.pickupEndsAt, window.pickupEndsAt)) }, $inc: { revision: 1 } }, { session });
    }
    const changes = [];
    for (const food of listings) {
      const target = sampleFoods.find(sample => sample.id === food.slug).availablePortions;
      const added = food.demoStockDate === window.today ? 0 : Math.max(0, target - food.availablePortions);
      await Listing.updateOne({ _id: food._id, isDemo: true }, { $set: { status: 'open', pickupStartsAt: window.pickupStartsAt, pickupEndsAt: window.pickupEndsAt, demoStockDate: window.today }, $inc: { totalPortions: added, availablePortions: added, revision: 1 } }, { session });
      changes.push({ slug: food.slug, addedPortions: added });
    }
    return { ...window, changes };
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
}
async function main() {
  loadEnvironment();
  const config = readConfig(), database = await connectDatabase(config.mongoUri);
  try {
    console.log(JSON.stringify(await inspectRecording(database), null, 2));
    if (!process.argv.includes('--apply')) return;
    // Local private backup only; never commit account/reservation/upload data.
    const directory = path.join(__dirname, '../.cache/recording-backups');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const backup = {};
    for (const [name, Model] of Object.entries(database.models)) backup[name] = await Model.collection.find({}).toArray();
    await fs.writeFile(path.join(directory, `${Date.now()}.json`), JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(await prepareRecording(database, { production: config.production }), null, 2));
    console.log('Fictional sample windows prepared; account data, reservation history, IDs and photos preserved.');
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof HttpError ? error.message : 'Recording preparation failed. Check MongoDB configuration.'); process.exitCode = 1; });
module.exports = { recordingWindow, inspectRecording, prepareRecording };
