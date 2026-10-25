const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { parseChicagoTime } = require('../src/lib/chicago-time');
const { authorizeOrganizer, emailValue, membershipAccess } = require('../src/services/accounts');
const { HttpError } = require('../src/lib/errors');

async function prepareRehearsal(database, { email, date, organizationSlug, production = false }) {
  if (production) throw new HttpError(403, 'Rehearsal setup is disabled in production.');
  const pickupStartsAt = parseChicagoTime(`${date}T00:00`);
  const pickupEndsAt = parseChicagoTime(`${date}T23:59`);
  if (pickupEndsAt <= new Date()) throw new HttpError(422, 'Choose a rehearsal date whose pickup window has not ended.');
  const { User, Membership, Organization, Event } = database.models;
  const user = await User.findOne({ email: emailValue(email) }).lean();
  if (!user) throw new HttpError(404, 'An existing account with explicit fictional admin access is required.');
  const organizations = await Organization.find({ isDemo: true, ...(organizationSlug ? { slug: organizationSlug } : {}) }).select('_id').lean();
  const memberships = await Membership.find({ user: user._id, role: 'admin', ...membershipAccess(user), organization: { $in: organizations.map(org => org._id) } }).lean();
  if (memberships.length !== 1) throw new HttpError(409, 'Choose one fictional organization where this organizer is an administrator using --organization its-slug.');
  const actor = { userId: user._id, organizationId: memberships[0].organization };
  return database.connection.transaction(async session => {
    await authorizeOrganizer(database, actor, ['admin'], session);
    return Event.findOneAndUpdate({ organization: actor.organizationId, seedKey: `submission-rehearsal-${date}` }, {
      $setOnInsert: {
        title: `Submission rehearsal · ${date}`, description: 'Fictional demonstration only. No real food pickups are offered.',
        pickupStartsAt, pickupEndsAt, pickupLocation: 'Fictional rehearsal table — do not travel',
        pickupInstructions: 'For the app demonstration only: show the pickup code to the organizer in this rehearsal. No real food is distributed.',
        status: 'open', revision: 0
      }
    }, { session, upsert: true, new: true, timestamps: false }).lean();
  });
}
async function main() {
  loadEnvironment();
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    if (!['--email', '--date', '--organization'].includes(key) || !process.argv[index + 1]) throw new HttpError(422, 'Usage: npm run demo:rehearsal -- --email organizer@example.test --date YYYY-MM-DD [--organization fictional-slug]');
    args[key === '--organization' ? 'organizationSlug' : key.slice(2)] = process.argv[index + 1];
  }
  if (!args.email || !args.date) throw new HttpError(422, 'Supply --email for your existing organizer and --date YYYY-MM-DD for the Chicago rehearsal day.');
  const config = readConfig();
  const database = await connectDatabase(config.mongoUri);
  try {
    const event = await prepareRehearsal(database, { ...args, production: config.production });
    console.log(`Ready: ${event.title}. Pickup: 00:00–23:59 America/Chicago. Existing events, listings and reservations were not reset.`);
    console.log(`Manage it at http://${config.host}:${config.port}/organizer/${event.organization}`);
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof HttpError ? error.message : 'Rehearsal setup failed. Check configuration and MongoDB. No reset was performed.'); process.exitCode = 1; });
module.exports = { prepareRehearsal };
