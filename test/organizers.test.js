const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
const request = require('supertest');
const fs = require('node:fs/promises');
const os = require('node:os');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { connectDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/lib/passwords');
const { chicagoInput } = require('../src/lib/chicago-time');
const { grantDevelopmentAdmin, migrateOrganizations } = require('../src/services/development');
const { sampleFoods } = require('../src/data/sample-foods');
const { createInvitationService, auditAccountTypes, migrateAccountTypes } = require('../src/services/accounts');
const { createReservationService } = require('../src/services/reservations');

let replicaSet, database, app, passwordHash, uploadDirectory;
// Keep the random database name within Atlas's 38-byte limit.
const databaseName = 'community_table_test_' + randomBytes(8).toString('hex');
const password = 'Organizer-test-password-934!';
const sessionSecret = randomBytes(32).toString('hex');
const minute = offset => new Date(Math.floor((Date.now() + offset * 3600000) / 60000) * 60000);
function field(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `Expected form field ${name}`); return match[1];
}
before(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    replicaSet = await MongoMemoryReplSet.create({ binary: { version: '7.0.24', downloadDir: path.join(process.cwd(), '.cache/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    uri = replicaSet.getUri();
  }
  database = await connectDatabase(uri, { dbName: databaseName });
  assert.equal(database.connection.name, databaseName);
  uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-table-upload-test-'));
  app = createApp({ ...database, sessionSecret, loginLimit: 200, signupLimit: 200, uploadDirectory });
  passwordHash = await hashPassword(password);
  console.log(`Organizer integration tests use isolated real database ${databaseName}.`);
}, { timeout: 180000 });
beforeEach(async () => {
  if (!database) return;
  assert.equal(database.connection.name, databaseName);
  await Promise.all(Object.values(database.models).map(Model => Model.deleteMany({})));
  await database.connection.db.collection('sessions').deleteMany({});
  await database.connection.db.collection('rate_limits').deleteMany({});
});
after(async () => {
  if (database?.connection.readyState === 1) {
    assert.equal(database.connection.name, databaseName);
    await database.connection.dropDatabase(); await database.connection.close();
  }
  if (replicaSet) await replicaSet.stop();
  if (uploadDirectory) await fs.rm(uploadDirectory, { recursive: true, force: true });
});
async function account(name, role = 'recipient') {
  const user = await database.models.User.create({ name, email: `${name.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}@example.test`, passwordHash, role });
  const agent = request.agent(app);
  const _csrf = field((await agent.get('/login').expect(200)).text, '_csrf');
  await agent.post('/login').type('form').send({ email: user.email, password, _csrf }).expect(303);
  const csrf = field((await agent.get('/profile').expect(200)).text, '_csrf');
  return { user, agent, csrf };
}
async function organization(name) { return database.models.Organization.create({ name, slug: `org-${randomUUID()}`, isDemo: true }); }
async function member(actor, org, role) { await database.models.Membership.create({ organization: org._id, user: actor.user._id, role }); return actor; }
async function setup() {
  const orgA = await organization('Fictional Kitchen A'), orgB = await organization('Fictional Kitchen B');
  const admin = await member(await account('Admin A', 'organizer'), orgA, 'admin');
  const volunteer = await member(await account('Volunteer A', 'organizer'), orgA, 'volunteer');
  const recipient = await account('Recipient A');
  const base = `/organizer/${orgA._id}`, foreign = `/organizer/${orgB._id}`;
  return { orgA, orgB, admin, volunteer, recipient, base, foreign };
}
async function event(org, extra = {}) {
  return database.models.Event.create({ organization: org._id, title: 'Fictional neighborhood pickup', description: 'Demo event', pickupStartsAt: minute(-3), pickupEndsAt: minute(24), pickupLocation: 'Fictional entrance', pickupInstructions: 'Do not travel here.', status: 'open', ...extra });
}
async function food(org, evt, extra = {}) {
  return database.models.Listing.create({ ...sampleFoods[0], organization: org.name, organizationId: org._id, eventId: evt._id, slug: `food-${randomUUID()}`, pickupStartsAt: minute(-1), pickupEndsAt: minute(2), totalPortions: 8, availablePortions: 8, perAccountLimit: 3, ...extra });
}
function eventBody(evt, extra = {}) { return { title: evt.title, description: evt.description, pickupStartsAt: chicagoInput(evt.pickupStartsAt), pickupEndsAt: chicagoInput(evt.pickupEndsAt), pickupLocation: evt.pickupLocation, pickupInstructions: evt.pickupInstructions, status: evt.status, revision: String(evt.revision), ...extra }; }
function foodBody(listing, extra = {}) {
  return { name: listing.name, description: listing.description, portionSize: listing.portionSize, ingredients: listing.ingredients?.join('\n') || '', allergenStatus: listing.allergens ? 'reported' : 'unknown', allergens: listing.allergens || '', totalPortions: String(listing.totalPortions), perAccountLimit: String(listing.perAccountLimit), eventId: String(listing.eventId), pickupStartsAt: chicagoInput(listing.pickupStartsAt), pickupEndsAt: chicagoInput(listing.pickupEndsAt), pickupLocation: listing.pickupLocation, pickupInstructions: listing.pickupInstructions, status: listing.status, revision: String(listing.revision), ...extra };
}
const post = (actor, url, data = {}) => actor.agent.post(url).type('form').send({ _csrf: actor.csrf, ...data });
async function reserve(actor, listing, quantity = 1) {
  const page = await actor.agent.get(`/foods/${listing.slug}`).expect(200);
  const response = await post(actor, `/foods/${listing.slug}/reserve`, { requestKey: field(page.text, 'requestKey'), quantity: String(quantity) }).expect(303);
  return database.models.Reservation.findById(response.headers.location.split('/').pop());
}
async function latest(listing) { return database.models.Listing.findById(listing._id); }

test('recipients cannot access organizer actions; public signup never creates organization access', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  for (const url of [world.base, `${world.base}/pickups`, `${world.base}/volunteers`, `${world.base}/events/new`, `${world.base}/listings/${listing._id}/edit`]) await world.recipient.agent.get(url).expect(403);
  for (const url of [`${world.base}/events`, `${world.base}/listings`, `${world.base}/volunteers/lookup`, `${world.base}/listings/${listing._id}/pause`, `${world.base}/pickups/lookup`]) await post(world.recipient, url, { role: 'admin', organizationId: String(world.orgA._id) }).expect(403);
  const anonymous = request.agent(app), email = 'ungranted@example.test';
  const _csrf = field((await anonymous.get('/signup').expect(200)).text, '_csrf');
  await anonymous.post('/signup').type('form').send({ _csrf, name: 'New Recipient', email, password, role: 'admin', organizationId: String(world.orgA._id) }).expect(303);
  const user = await database.models.User.findOne({ email });
  assert.equal(user.role, 'recipient'); assert.equal(await database.models.Membership.countDocuments({ user: user._id }), 0);
  await anonymous.get(world.base).expect(403);
});

test('organization scope rejects foreign routes, record IDs, events and pickup codes', async () => {
  const world = await setup(), ownEvent = await event(world.orgA), foreignEvent = await event(world.orgB);
  const foreignFood = await food(world.orgB, foreignEvent);
  const reservation = await reserve(world.recipient, foreignFood);
  await world.admin.agent.get(world.foreign).expect(403);
  await world.volunteer.agent.get(`${world.foreign}/pickups`).expect(403);
  for (const url of [`${world.base}/events/${foreignEvent._id}/edit`, `${world.base}/listings/${foreignFood._id}/edit`, `${world.base}/pickups/${reservation._id}`]) await world.admin.agent.get(url).expect(404);
  await post(world.admin, `${world.base}/events/${foreignEvent._id}`, eventBody(foreignEvent)).expect(404);
  await post(world.admin, `${world.base}/listings/${foreignFood._id}`, foodBody(foreignFood, { eventId: String(ownEvent._id) })).expect(404);
  await post(world.admin, `${world.base}/listings`, foodBody(foreignFood)).expect(404);
  await post(world.volunteer, `${world.base}/pickups/lookup`, { pickupCode: reservation.pickupCode }).expect(404);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(404);
  assert.equal((await latest(foreignFood)).availablePortions, 7);
  assert.equal((await database.models.Reservation.findById(reservation._id)).status, 'active');
});

test('volunteers can review pickups but cannot edit events, listings, inventory, pauses or memberships', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const reservation = await reserve(world.recipient, listing);
  await world.volunteer.agent.get(world.base).expect(200);
  await world.volunteer.agent.get(`${world.base}/pickups`).expect(200);
  await world.volunteer.agent.get(`${world.base}/pickups/${reservation._id}`).expect(200);
  for (const url of [`${world.base}/volunteers`, `${world.base}/events/new`, `${world.base}/listings/new`, `${world.base}/listings/${listing._id}/edit`]) await world.volunteer.agent.get(url).expect(403);
  for (const url of [`${world.base}/events`, `${world.base}/events/${evt._id}`, `${world.base}/listings/${listing._id}`, `${world.base}/listings/${listing._id}/pause`, `${world.base}/events/${evt._id}/pause`, `${world.base}/volunteers/lookup`, `${world.base}/volunteers/confirm`]) await post(world.volunteer, url, { role: 'admin' }).expect(403);
});

test('admin creates events/listings with Chicago dates and explicitly unknown ingredients/allergens, and can clear reports', async () => {
  const world = await setup();
  const template = { title: 'Demo supper pickup', description: 'Fictional event', pickupStartsAt: minute(1), pickupEndsAt: minute(5), pickupLocation: 'Demo location', pickupInstructions: 'Fictional instructions', status: 'open', revision: 0 };
  await world.admin.agent.get(`${world.base}/events/new`).expect(200);
  await post(world.admin, `${world.base}/events`, eventBody(template)).expect(303);
  const evt = await database.models.Event.findOne({ organization: world.orgA._id });
  const payload = foodBody({ ...sampleFoods[0], eventId: evt._id, pickupStartsAt: minute(2), pickupEndsAt: minute(4), totalPortions: 10, perAccountLimit: 2, status: 'open', revision: 0 }, { ingredients: '', allergenStatus: 'unknown', allergens: 'Do not use this unconfirmed text', organizationId: String(world.orgB._id), organization: 'Forged name' });
  await world.admin.agent.get(`${world.base}/listings/new`).expect(200);
  await post(world.admin, `${world.base}/listings`, payload).expect(303);
  let listing = await database.models.Listing.findOne({ organizationId: world.orgA._id });
  assert.equal(listing.organization, world.orgA.name); assert.equal(listing.availablePortions, 10);
  assert.equal(listing.pickupStartsAt.getTime(), minute(2).getTime());
  assert.equal(listing.allergens, null); assert.deepEqual(listing.ingredients, []);
  const page = await request(app).get(`/foods/${listing.slug}`).expect(200);
  assert.equal((page.text.match(/Unknown — not provided by the organizer\./g) || []).length, 2);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing, { allergenStatus: 'reported', allergens: 'Contains wheat', ingredients: 'Wheat flour\nWater' })).expect(303);
  listing = await latest(listing); assert.equal(listing.allergens, 'Contains wheat');
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing, { allergenStatus: 'unknown', ingredients: '' })).expect(303);
  listing = await latest(listing); assert.equal(listing.allergens, null); assert.deepEqual(listing.ingredients, []);
});

test('dashboard totals distinguish available, reserved, collected and missed portions', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt), other = await account('Other Recipient');
  const reservation = await reserve(world.recipient, listing, 2);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(303);
  await reserve(other, listing, 1);
  const html = (await world.admin.agent.get(world.base).expect(200)).text;
  for (const [quantity, label] of [[5, 'Available'], [1, 'Reserved'], [2, 'Collected']]) assert.match(html, new RegExp(`<strong>${quantity}</strong><span>${label}</span>`));
  assert.match((await world.admin.agent.get('/profile').expect(200)).text, /<dt>Account type<\/dt><dd>Organizer<\/dd>/);
  assert.doesNotMatch((await world.admin.agent.get('/profile')).text, /Switch to|My Pickups|>Browse</);
  await world.admin.agent.get('/organizer').expect(303).expect('Location', world.base);
});

test('pausing a listing or event rejects new reservations while existing pickups can be collected or cancelled', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt), other = await account('Other Recipient');
  const newcomer = await account('New Recipient');
  const reservation = await reserve(world.recipient, listing);
  await post(world.admin, `${world.base}/listings/${listing._id}/pause`, { action: 'pause' }).expect(303);
  await post(other, `/foods/${listing.slug}/reserve`, { quantity: '1', requestKey: randomUUID() }).expect(410);
  await post(world.admin, `${world.base}/listings/${listing._id}/pause`, { action: 'resume' }).expect(303);
  const cancellable = await reserve(other, listing);
  await post(world.admin, `${world.base}/events/${evt._id}/pause`, { action: 'pause' }).expect(303);
  assert.ok(!(await request(app).get('/').expect(200)).text.includes(`/foods/${listing.slug}`));
  await post(newcomer, `/foods/${listing.slug}/reserve`, { quantity: '1', requestKey: randomUUID() }).expect(410);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(303);
  await post(other, `/reservations/${cancellable._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 7);
});

test('quantity edits cannot undercut reserved/collected portions and cancellation restores the edited inventory exactly', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt), other = await account('Other Recipient');
  const collected = await reserve(world.recipient, listing, 2);
  await post(world.volunteer, `${world.base}/pickups/${collected._id}/confirm`, { confirm: 'collected' }).expect(303);
  const active = await reserve(other, listing, 2);
  let current = await latest(listing);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(current, { totalPortions: '3' })).expect(422);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(current, { perAccountLimit: '1' })).expect(422);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(current, { totalPortions: '6' })).expect(303);
  current = await latest(listing); assert.equal(current.totalPortions, 6); assert.equal(current.availablePortions, 2);
  await post(other, `/reservations/${active._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 4);
  await post(world.recipient, `/reservations/${collected._id}/cancel`).expect(409);
});

test('concurrent inventory edits and reservations preserve total minus committed inventory without overbooking', async () => {
  const world = await setup(), evt = await event(world.orgA);
  for (let round = 0; round < 6; round++) {
    const listing = await food(world.orgA, evt);
    const key = randomUUID();
    const responses = await Promise.all([
      post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing, { totalPortions: '2' })),
      post(world.recipient, `/foods/${listing.slug}/reserve`, { quantity: '3', requestKey: key })
    ]);
    assert.ok(responses.every(response => [303, 409].includes(response.status)), responses.map(response => response.status).join(','));
    assert.equal(responses.filter(response => response.status === 303).length, 1);
    const current = await latest(listing);
    const saved = await database.models.Reservation.find({ listing: listing._id });
    assert.equal(current.availablePortions, current.totalPortions - saved.reduce((sum, row) => sum + row.quantity, 0));
    assert.ok(current.availablePortions >= 0);
  }
});

test('simultaneous admin edits reject a stale revision rather than silently replacing inventory', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const responses = await Promise.all(['10', '11'].map(totalPortions => post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing, { totalPortions }))));
  assert.deepEqual(responses.map(response => response.status).sort(), [303, 409]);
  const current = await latest(listing); assert.equal(current.totalPortions, current.availablePortions); assert.ok([10, 11].includes(current.totalPortions));
});

test('concurrent/repeated pickup confirmation succeeds once, never deducts inventory again, and collected portions count toward limits', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const reservation = await reserve(world.recipient, listing, 2);
  const lookup = await post(world.volunteer, `${world.base}/pickups/lookup`, { pickupCode: reservation.pickupCode.toLowerCase() }).expect(303);
  assert.ok(lookup.headers.location.endsWith(String(reservation._id)));
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`).expect(422);
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' })));
  assert.equal(responses.filter(response => response.status === 303).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 7);
  assert.equal((await latest(listing)).availablePortions, 6);
  const saved = await database.models.Reservation.findById(reservation._id);
  assert.equal(saved.status, 'collected'); assert.equal(String(saved.collectedBy), String(world.volunteer.user._id)); assert.ok(saved.collectedAt);
  assert.match((await world.recipient.agent.get('/my-pickups').expect(200)).text, /Collected/);
  const limited = await world.recipient.agent.get(`/foods/${listing.slug}`).expect(200);
  assert.match(limited.text, /id="quantity"[^>]*max="1"/);
  await post(world.recipient, `/foods/${listing.slug}/reserve`, { quantity: '2', requestKey: randomUUID() }).expect(422);
  const final = await reserve(world.recipient, listing, 1);
  assert.equal((await latest(listing)).availablePortions, 5);
  await post(world.volunteer, `${world.base}/pickups/${final._id}/confirm`, { confirm: 'collected' }).expect(303);
  const full = await world.recipient.agent.get(`/foods/${listing.slug}`).expect(200);
  assert.match(full.text, /Account limit reached/);
  assert.doesNotMatch(full.text, /id="quantity"/);
});

test('pickup confirmation rejects cancelled, expired/missed, and not-yet-started reservations without inventory changes', async () => {
  const world = await setup(), evt = await event(world.orgA);
  for (const state of ['cancelled', 'expired', 'missed', 'future']) {
    const listing = await food(world.orgA, evt, state === 'future' ? { pickupStartsAt: minute(1) } : {});
    const reservation = await reserve(world.recipient, listing);
    if (state === 'cancelled') await post(world.recipient, `/reservations/${reservation._id}/cancel`).expect(303);
    else if (state === 'expired') await database.models.Reservation.updateOne({ _id: reservation._id }, { $set: { pickupEndsAt: minute(-0.01) } });
    else if (state === 'missed') await database.models.Reservation.updateOne({ _id: reservation._id }, { $set: { status: 'missed' } });
    const quantity = (await latest(listing)).availablePortions;
    await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(state === 'future' ? 409 : 410);
    assert.equal((await latest(listing)).availablePortions, quantity);
  }
});

test('volunteer add/remove requires an exact registered email and confirmation of the selected account; removal revokes access', async () => {
  const world = await setup(), target = await account('Target Organizer', 'organizer');
  await post(world.admin, `${world.base}/volunteers/lookup`, { email: target.user.email.slice(1), operation: 'add' }).expect(404);
  const selected = await post(world.admin, `${world.base}/volunteers/lookup`, { email: target.user.email.toUpperCase(), operation: 'add' }).expect(200);
  assert.match(selected.text, /Target Organizer/);
  const data = { selectionToken: field(selected.text, 'selectionToken'), userId: field(selected.text, 'userId'), confirm: 'yes' };
  await post(world.admin, `${world.base}/volunteers/confirm`, { ...data, userId: String(world.recipient.user._id) }).expect(403);
  await post(world.admin, `${world.base}/volunteers/confirm`, { ...data, confirm: '' }).expect(403);
  assert.equal(await database.models.Membership.countDocuments({ user: target.user._id }), 0);
  await post(world.admin, `${world.base}/volunteers/confirm`, data).expect(303);
  assert.equal((await database.models.Membership.findOne({ user: target.user._id })).role, 'volunteer');
  await target.agent.get(`${world.base}/pickups`).expect(200);
  const removal = await post(world.admin, `${world.base}/volunteers/lookup`, { email: target.user.email, operation: 'remove' }).expect(200);
  await post(world.admin, `${world.base}/volunteers/confirm`, { selectionToken: field(removal.text, 'selectionToken'), userId: field(removal.text, 'userId'), confirm: 'yes' }).expect(303);
  await target.agent.get(`${world.base}/pickups`).expect(403);
  const adminSelection = await post(world.admin, `${world.base}/volunteers/lookup`, { email: world.admin.user.email, operation: 'remove' }).expect(200);
  await post(world.admin, `${world.base}/volunteers/confirm`, { selectionToken: field(adminSelection.text, 'selectionToken'), userId: field(adminSelection.text, 'userId'), confirm: 'yes' }).expect(409);
});

test('explicit organization migration preserves historical listings, inventory, codes, dates, snapshots and recipient cancellation', async () => {
  const recipient = await account('Legacy Recipient');
  const listing = await database.models.Listing.create({ ...sampleFoods[0], slug: 'legacy-food', totalPortions: 8, availablePortions: 8, perAccountLimit: 3, pickupStartsAt: minute(-1), pickupEndsAt: minute(2) });
  const reservation = await reserve(recipient, listing, 2);
  const previous = await latest(listing);
  const snapshot = reservation.food.toObject();
  const first = await migrateOrganizations(database); assert.equal(first.linkedListings, 1); assert.equal(first.linkedReservations, 1);
  const current = await latest(listing), saved = await database.models.Reservation.findById(reservation._id);
  assert.equal(current.availablePortions, 6); assert.equal(current.pickupStartsAt.getTime(), previous.pickupStartsAt.getTime());
  assert.equal(saved.pickupCode, reservation.pickupCode); assert.equal(saved.quantity, 2); assert.equal(saved.pickupEndsAt.getTime(), reservation.pickupEndsAt.getTime()); assert.deepEqual(saved.food.toObject(), snapshot);
  assert.equal(String(saved.organizationId), String(current.organizationId));
  assert.deepEqual(await migrateOrganizations(database), { linkedListings: 0, linkedReservations: 0 });
  await post(recipient, `/reservations/${saved._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 8);
});

test('development command creates dedicated organizer accounts, rejects recipient email reuse, and is development-only', async () => {
  const recipient = await account('Existing Recipient');
  await assert.rejects(() => grantDevelopmentAdmin(database, { email: recipient.user.email, production: true }), /disabled in production/);
  await assert.rejects(() => grantDevelopmentAdmin(database, { email: recipient.user.email, password }), /different email/);
  await assert.rejects(() => grantDevelopmentAdmin(database, { email: 'new-organizer@example.test' }), /password/);
  assert.equal(await database.models.Organization.countDocuments(), 0);
  const email = 'new-organizer@example.test';
  const org = await grantDevelopmentAdmin(database, { email, password, accountName: 'Dedicated Admin' });
  const actor = await database.models.User.findOne({ email }).select('+passwordHash');
  assert.equal(actor.role, 'organizer'); assert.match(actor.passwordHash, /^scrypt:/);
  assert.equal((await database.models.Membership.findOne({ organization: org._id, user: actor._id })).role, 'admin');
  assert.equal((await database.models.User.findById(recipient.user._id)).role, 'recipient');
  await grantDevelopmentAdmin(database, { email }); assert.equal(await database.models.Membership.countDocuments(), 1);
  await database.models.User.deleteOne({ _id: actor._id });
  const replacement = request.agent(app);
  const _csrf = field((await replacement.get('/signup').expect(200)).text, '_csrf');
  await replacement.post('/signup').type('form').send({ _csrf, name: 'Replacement Recipient', email, password, role: 'organizer' }).expect(303);
  const newUser = await database.models.User.findOne({ email });
  assert.equal(newUser.role, 'recipient'); assert.notEqual(String(newUser._id), String(actor._id));
  assert.equal(await database.models.Membership.countDocuments({ user: newUser._id }), 0);
  await replacement.get(`/organizer/${org._id}`).expect(403);
});

test('pickup confirmation racing recipient cancellation has one outcome and correct inventory', async () => {
  const world = await setup(), evt = await event(world.orgA);
  for (let round = 0; round < 4; round++) {
    const listing = await food(world.orgA, evt), reservation = await reserve(world.recipient, listing, 2);
    const responses = await Promise.all([
      post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }),
      post(world.recipient, `/reservations/${reservation._id}/cancel`)
    ]);
    assert.equal(responses.filter(response => response.status === 303).length, 1);
    assert.ok(responses.every(response => [303, 409, 410].includes(response.status)));
    const saved = await database.models.Reservation.findById(reservation._id);
    assert.ok(['collected', 'cancelled'].includes(saved.status));
    assert.equal((await latest(listing)).availablePortions, saved.status === 'cancelled' ? 8 : 6);
  }
});

test('every organizer write rejects missing CSRF, even with valid admin/volunteer sessions', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt), reservation = await reserve(world.recipient, listing);
  for (const url of [`${world.base}/events`, `${world.base}/events/${evt._id}`, `${world.base}/events/${evt._id}/pause`, `${world.base}/listings`, `${world.base}/listings/${listing._id}`, `${world.base}/listings/${listing._id}/pause`, `${world.base}/volunteers/lookup`, `${world.base}/volunteers/confirm`, `${world.base}/pickups/lookup`, `${world.base}/pickups/${reservation._id}/confirm`]) await world.admin.agent.post(url).type('form').send({ confirm: 'collected' }).expect(403);
});

test('event edits reject stale reservation revisions and cannot exclude listing windows', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  await reserve(world.recipient, listing);
  await post(world.admin, `${world.base}/events/${evt._id}`, eventBody(evt, { title: 'Stale title' })).expect(409);
  const current = await database.models.Event.findById(evt._id);
  await post(world.admin, `${world.base}/events/${evt._id}`, eventBody(current, { pickupStartsAt: chicagoInput(minute(1)) })).expect(422);
  await post(world.admin, `${world.base}/events/${evt._id}`, eventBody(current, { title: 'Updated fictional event' })).expect(303);
});

test('account experiences have separate navigation; organizers cannot reserve, cancel or access personal pickups', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const saved = await reserve(world.recipient, listing);
  for (const actor of [world.admin, world.volunteer]) {
    await actor.agent.get('/').expect(303).expect('Location', '/organizer');
    const dashboard = (await actor.agent.get(world.base).expect(200)).text;
    for (const label of ['Dashboard', 'Listings', 'Pickups', 'Profile']) assert.ok(dashboard.includes(`<span>${label}</span>`));
    assert.doesNotMatch(dashboard, /Switch to|My Pickups|>Browse</);
    const listings = (await actor.agent.get(`${world.base}/listings`).expect(200)).text;
    assert.match(listings, /aria-current="page"/);
    assert.ok(listings.includes(sampleFoods[0].name));
    await actor.agent.get('/my-pickups').expect(403);
    await actor.agent.get(`/reservations/${saved._id}`).expect(403);
    await post(actor, `/reservations/${saved._id}/cancel`).expect(403);
    await post(actor, `/foods/${listing.slug}/reserve`, { quantity: '1', requestKey: randomUUID() }).expect(403);
    const details = (await actor.agent.get(`/foods/${listing.slug}`).expect(200)).text;
    assert.match(details, /Organizer accounts manage distribution and cannot reserve/);
    assert.doesNotMatch(details, /data-reservation-form/);
    const service = createReservationService(database);
    await assert.rejects(() => service.reserve({ userId: actor.user._id, listingSlug: listing.slug, quantity: 1, requestKey: randomUUID() }), error => error.status === 403);
    await assert.rejects(() => service.cancel({ userId: actor.user._id, reservationId: String(saved._id) }), error => error.status === 403);
  }
  const recipientProfile = (await world.recipient.agent.get('/profile')).text;
  for (const label of ['Browse', 'My Pickups', 'Profile']) assert.ok(recipientProfile.includes(`<span>${label}</span>`));
  assert.doesNotMatch(recipientProfile, /Switch to|>Dashboard<|>Listings</);
  await post(world.recipient, `/reservations/${saved._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 8);
});

test('legacy mixed history is reported without migration; history-free membership migration preserves data', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const reservation = await reserve(world.recipient, listing);
  await member(world.recipient, world.orgA, 'admin'); // Legacy conflicting data only.
  const historyFree = await member(await account('Legacy Admin'), world.orgA, 'admin');
  const audit = await auditAccountTypes(database);
  assert.equal(audit.conflicts.length, 1); assert.equal(audit.conflicts[0].email, world.recipient.user.email);
  assert.equal(audit.candidates.length, 1);
  const result = await migrateAccountTypes(database); assert.equal(result.migrated, 0);
  for (const actor of [world.recipient, historyFree]) assert.equal((await database.models.User.findById(actor.user._id)).role, 'recipient');
  await world.recipient.agent.get(world.base).expect(403); // Membership cannot bypass account type.
  await assert.rejects(() => createInvitationService(database).invite({ userId: world.recipient.user._id, organizationId: world.orgA._id }, 'new@example.test'), error => error.status === 403);
  assert.equal((await database.models.Reservation.findById(reservation._id)).pickupCode, reservation.pickupCode);
  assert.equal((await latest(listing)).availablePortions, 7);
  // Resolve only this test fixture's membership; recipient history remains unchanged.
  await database.models.Membership.deleteOne({ user: world.recipient.user._id });
  assert.equal((await migrateAccountTypes(database)).migrated, 1);
  assert.equal((await database.models.User.findById(historyFree.user._id)).role, 'organizer');
  assert.equal((await database.models.User.findById(world.recipient.user._id)).role, 'recipient');
  assert.equal((await migrateAccountTypes(database)).migrated, 0);
  await post(world.recipient, `/reservations/${reservation._id}/cancel`).expect(303);
});

test('admin invitations create separate volunteer accounts; recipient emails, tampering, expiry, retries and unauthorized creation are rejected', async () => {
  const world = await setup();
  await post(world.admin, `${world.base}/invitations`, { email: world.recipient.user.email, confirm: 'invite' }).expect(409);
  await post(world.volunteer, `${world.base}/invitations`, { email: 'invited@example.test', confirm: 'invite' }).expect(403);
  await post(world.recipient, `${world.base}/invitations`, { email: 'invited@example.test', confirm: 'invite' }).expect(403);
  await post(world.admin, `${world.base}/invitations`, { email: 'invited@example.test' }).expect(422);
  await world.admin.agent.post(`${world.base}/invitations`).type('form').send({ email: 'invited@example.test', confirm: 'invite' }).expect(403);
  const response = await post(world.admin, `${world.base}/invitations`, { email: 'invited@example.test', confirm: 'invite' }).expect(200);
  const invitationPath = response.text.match(/href="(\/invitations\/[a-f0-9]{64})"/)[1];
  const token = invitationPath.split('/').pop();
  const stored = await database.models.Invitation.findOne().lean();
  assert.notEqual(stored.tokenHash, token); assert.equal(stored.role, 'volunteer');
  await world.recipient.agent.get(invitationPath).expect(409);
  const anonymous = request.agent(app);
  const page = await anonymous.get(invitationPath).expect(200);
  assert.match(page.text, /invited@example.test/);
  const payload = { _csrf: field(page.text, '_csrf'), name: 'Invited Volunteer', password, email: world.recipient.user.email, role: 'admin', organization: String(world.orgB._id) };
  await anonymous.post(invitationPath).type('form').send({ ...payload, _csrf: '' }).expect(403);
  const other = request.agent(app);
  const otherCsrf = field((await other.get(invitationPath)).text, '_csrf');
  const results = await Promise.all([anonymous.post(invitationPath).type('form').send(payload), other.post(invitationPath).type('form').send({ ...payload, _csrf: otherCsrf })]);
  assert.equal(results.filter(r => r.status === 303).length, 1);
  assert.ok(results.every(r => [303, 409, 410].includes(r.status)));
  const invited = await database.models.User.findOne({ email: 'invited@example.test' });
  assert.equal(invited.role, 'organizer'); assert.equal(await database.models.Reservation.countDocuments({ user: invited._id }), 0);
  const memberships = await database.models.Membership.find({ user: invited._id });
  assert.equal(memberships.length, 1); assert.equal(memberships[0].role, 'volunteer'); assert.equal(String(memberships[0].organization), String(world.orgA._id));
  const unused = request.agent(app); await unused.get(invitationPath).expect(410);
  const service = createInvitationService(database);
  const expiring = await service.invite({ userId: world.admin.user._id, organizationId: world.orgA._id }, 'expired@example.test');
  await database.models.Invitation.updateMany({ acceptedAt: null }, { $set: { expiresAt: new Date(0) } });
  await unused.get(`/invitations/${expiring}`).expect(410);
  await unused.get('/invitations/' + '0'.repeat(64)).expect(410);
  await assert.rejects(() => service.accept(expiring, 'Expired Organizer', password), error => error.status === 410);
  assert.equal(await database.models.User.countDocuments({ email: 'expired@example.test' }), 0);
});

test('volunteer membership management cannot convert a recipient account', async () => {
  const world = await setup();
  await post(world.admin, `${world.base}/volunteers/lookup`, { email: world.recipient.user.email, operation: 'add' }).expect(409);
  const service = require('../src/services/organizers').createOrganizerService(database);
  await assert.rejects(() => service.changeVolunteer({ userId: world.admin.user._id, organizationId: world.orgA._id }, { userId: world.recipient.user._id, email: world.recipient.user.email }, 'add'), error => error.status === 409);
  assert.equal(await database.models.Membership.countDocuments({ user: world.recipient.user._id }), 0);
  assert.equal((await database.models.User.findById(world.recipient.user._id)).role, 'recipient');
});

test('account-type migration racing a reservation cannot create an organizer with recipient history', async () => {
  for (let round = 0; round < 4; round++) {
    const org = await organization('Legacy Race Kitchen ' + round);
    const actor = await member(await account('Legacy Race User ' + round), org, 'admin');
    const evt = await event(org), listing = await food(org, evt);
    const service = createReservationService(database);
    const results = await Promise.allSettled([
      migrateAccountTypes(database),
      service.reserve({ userId: actor.user._id, listingSlug: listing.slug, quantity: 1, requestKey: randomUUID() })
    ]);
    assert.equal(results[0].status, 'fulfilled');
    if (results[1].status === 'rejected') assert.equal(results[1].reason.status, 403);
    const user = await database.models.User.findById(actor.user._id);
    const history = await database.models.Reservation.countDocuments({ user: actor.user._id });
    assert.ok(user.role === 'recipient' && history === 1 || user.role === 'organizer' && history === 0);
    assert.equal((await latest(listing)).availablePortions, 8 - history);
    // Keep later rounds independent even when this round found a legacy conflict.
    await database.models.Membership.deleteMany({ user: actor.user._id });
  }
});

test('pending invitations never convert a later public recipient signup and expire on creator revocation', async () => {
  const world = await setup(), service = createInvitationService(database);
  const actor = { userId: world.admin.user._id, organizationId: world.orgA._id };
  const email = 'recipient-before-accept@example.test';
  const token = await service.invite(actor, email);
  const recipient = request.agent(app);
  const csrf = field((await recipient.get('/signup')).text, '_csrf');
  await recipient.post('/signup').type('form').send({ _csrf: csrf, name: 'Public Recipient', email, password, role: 'organizer' }).expect(303);
  await assert.rejects(() => service.accept(token, 'Organizer Attempt', password), error => error.status === 409);
  const user = await database.models.User.findOne({ email });
  assert.equal(user.role, 'recipient'); assert.equal(await database.models.Membership.countDocuments({ user: user._id }), 0);
  assert.equal((await database.models.Invitation.findOne({ email })).acceptedAt, undefined);
  const revokedToken = await service.invite(actor, 'revoked-invite@example.test');
  await database.models.Membership.deleteOne({ user: world.admin.user._id, organization: world.orgA._id });
  await assert.rejects(() => service.accept(revokedToken, 'Revoked Organizer', password), error => error.status === 410);
  assert.equal(await database.models.User.countDocuments({ email: 'revoked-invite@example.test' }), 0);
});

test('bilingual organizer edits keep inventory-only translations and clear stale or unknown recipe translations', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing, { totalPortions: '9' })).expect(303);
  let current = await latest(listing);
  assert.equal(current.translations.am.name, sampleFoods[0].translations.am.name);
  const payload = foodBody(current, { name: 'Updated sample chicken', amName: 'የተሻሻለ ዶሮ', amDescription: 'የምሳሌ መግለጫ', amPortionSize: 'አንድ ድርሻ', amIngredients: 'ዶሮ\nሽንኩርት', amAllergens: 'እንቁላል እና ወተት', amPickupLocation: 'የምሳሌ ቦታ', amPickupInstructions: 'ኮድዎን ያሳዩ' });
  await post(world.admin, `${world.base}/listings/${listing._id}`, payload).expect(303);
  current = await latest(listing); assert.equal(current.translations.am.name, 'የተሻሻለ ዶሮ');
  const form = await world.admin.agent.get(`${world.base}/listings/${listing._id}/edit`).expect(200);
  assert.match(form.text, /name="amIngredients"/);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(current, { name: 'Changed without translation' })).expect(303);
  current = await latest(listing); assert.equal(current.translations, undefined);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(current, { ingredients: '', allergenStatus: 'unknown', amName: 'ዶሮ', amIngredients: 'አትጠቀም', amAllergens: 'አትጠቀም' })).expect(303);
  current = await latest(listing); assert.deepEqual(current.translations.am.ingredients, []); assert.equal(current.translations.am.allergens, '');
});

test('first-come reservations ignore old priority fields; controls are absent and legacy preferences cannot change', async () => {
  const world = await setup(), evt = await event(world.orgA);
  const listing = await food(world.orgA, evt, { priorityEnabled: true, priorityOpensAt: minute(0.5), generalOpensAt: minute(1) });
  const original = await database.models.User.findById(world.recipient.user._id).select('+needsFoodSupport').lean();
  for (const path of ['/profile', `/foods/${listing.slug}`]) {
    const page = await world.recipient.agent.get(path).expect(200);
    assert.doesNotMatch(page.text, /needsFoodSupport|priorityRestricted|General opening:|Review food support preference|Food support preference/);
  }
  for (const path of [`${world.base}/listings/new`, `${world.base}/listings/${listing._id}/edit`]) {
    const page = await world.admin.agent.get(path).expect(200);
    assert.doesNotMatch(page.text, /priorityEnabled|priorityOpensAt|generalOpensAt|prioritySettings/);
  }
  await post(world.recipient, '/profile/food-support', { needsFoodSupport: 'yes' }).expect(404);
  assert.equal((await database.models.User.findById(original._id).select('+needsFoodSupport')).needsFoodSupport, original.needsFoodSupport);
  const reservation = await reserve(world.recipient, listing, 2);
  assert.equal((await latest(listing)).availablePortions, 6);
  await post(world.recipient, `/reservations/${reservation._id}/cancel`).expect(303);
  await post(world.recipient, `/reservations/${reservation._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 8);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(await latest(listing), { priorityEnabled: 'yes', generalOpensAt: 'bad', priorityOpensAt: 'bad' })).expect(303);
  const unchanged = await latest(listing);
  assert.equal(unchanged.priorityEnabled, true);
  assert.equal(unchanged.generalOpensAt.getTime(), listing.generalOpensAt.getTime());
});

test('direct reservations ignore disabled, missing and malformed old priority fields while preserving limits and closed/expired checks', async () => {
  const world = await setup(), evt = await event(world.orgA), other = await account('Other Recipient');
  const listing = await food(world.orgA, evt, { priorityEnabled: true });
  const service = createReservationService(database);
  const args = actor => ({ userId: actor.user._id, listingSlug: listing.slug, quantity: 1, requestKey: randomUUID() });
  await service.reserve(args(world.recipient));
  await service.reserve(args(other));
  assert.equal((await latest(listing)).availablePortions, 6);
  await database.models.Listing.updateOne({ _id: listing._id }, { $set: { status: 'paused' } });
  await assert.rejects(service.reserve(args(world.recipient)), error => error.status === 410);
  await database.models.Listing.updateOne({ _id: listing._id }, { $set: { status: 'open', pickupEndsAt: minute(-0.1) } });
  await assert.rejects(service.reserve(args(world.recipient)), error => error.status === 410);
  const legacy = await food(world.orgA, evt, { perAccountLimit: 1 });
  await database.models.Listing.updateOne({ _id: legacy._id }, { $unset: { priorityEnabled: 1 } });
  await reserve(world.recipient, legacy);
  await assert.rejects(service.reserve({ ...args(world.admin), listingSlug: legacy.slug }), error => error.status === 403);
});

test('concurrent first-come requests and inventory edits remain consistent at the last portion', async () => {
  const world = await setup(), evt = await event(world.orgA), other = await account('Priority Competitor');
  const listing = await food(world.orgA, evt, { totalPortions: 1, availablePortions: 1, perAccountLimit: 1, priorityEnabled: true, priorityOpensAt: minute(-2), generalOpensAt: minute(1) });
  const outcomes = await Promise.all([world.recipient, other].map(actor => post(actor, `/foods/${listing.slug}/reserve`, { quantity: '1', requestKey: randomUUID() })));
  assert.deepEqual(outcomes.map(r => r.status).sort(), [303, 409]);
  assert.equal((await latest(listing)).availablePortions, 0);
  assert.equal(await database.models.Reservation.countDocuments({ listing: listing._id }), 1);
  const edited = await food(world.orgA, evt, { priorityEnabled: true, priorityOpensAt: minute(-2), generalOpensAt: minute(1) });
  const editOutcomes = await Promise.all([
    post(world.admin, `${world.base}/listings/${edited._id}`, foodBody(edited, { totalPortions: '2' })),
    post(world.recipient, `/foods/${edited.slug}/reserve`, { quantity: '3', requestKey: randomUUID() })
  ]);
  assert.equal(editOutcomes.filter(r => r.status === 303).length, 1);
  assert.ok(editOutcomes.every(r => [303, 409].includes(r.status)));
  const saved = await latest(edited), committed = await database.models.Reservation.find({ listing: edited._id });
  assert.equal(saved.availablePortions, saved.totalPortions - committed.reduce((sum, r) => sum + r.quantity, 0));
});

test('language switching translates recipient/organizer forms, navigation, statuses, errors and saved pickup text', async () => {
  const { translator, amharic } = require('../src/lib/i18n'), keys = require('../src/lib/ui-keys.json');
  for (const key of keys) assert.ok(Object.hasOwn(amharic, key), `Missing Amharic UI key: ${key}`);
  const t = translator('am'), world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  await world.recipient.agent.post('/language').type('form').send({ language: 'am' }).expect(403);
  await post(world.recipient, '/language', { language: 'invalid' }).expect(422);
  await post(world.recipient, '/language', { language: 'am', returnTo: '/profile' }).expect(303).expect('Location', '/profile');
  for (const [path, label] of [['/', 'Available for pickup'], ['/profile', 'Your account'], ['/my-pickups', 'No reservations yet'], ['/about', 'About Community Table'], [`/foods/${listing.slug}`, 'Food details']]) {
    const page = await world.recipient.agent.get(path).expect(200);
    assert.match(page.text, /<html lang="am">/);
    assert.ok(page.text.includes(t(label)), `${path}: ${label}`);
    for (const nav of ['Browse', 'My Pickups', 'Profile']) assert.ok(page.text.includes(t(nav)));
  }
  const anonymous = request.agent(app);
  const anonymousCsrf = field((await anonymous.get('/login')).text, '_csrf');
  await anonymous.post('/language').type('form').send({ _csrf: anonymousCsrf, language: 'am' }).expect(303);
  for (const [path,label] of [['/login','Log in'],['/signup','Create an account']]) {
    const html = (await anonymous.get(path).expect(200)).text;
    assert.ok(html.includes(t(label))); assert.match(html, /<html lang="am">/);
  }
  const failedLogin = await anonymous.post('/login').type('form').send({ _csrf: anonymousCsrf, email: 'missing@example.test', password }).expect(401);
  assert.ok(failedLogin.text.includes(t('Email or password is incorrect.')));
  const invalidSignup = await anonymous.post('/signup').type('form').send({ _csrf: anonymousCsrf, name: '', email: 'bad', password: 'short' }).expect(422);
  assert.ok(invalidSignup.text.includes(t('Enter a name, a valid email, and a password between 12 and 128 characters.')));
  const reservation = await reserve(world.recipient, listing);
  const page = (await world.recipient.agent.get(`/reservations/${reservation._id}`)).text;
  assert.ok(page.includes(t('Reserved')));
  assert.ok(page.includes(listing.translations.am.name));
  assert.ok(page.includes(listing.translations.am.pickupInstructions));
  const bad = await post(world.recipient, `/foods/${listing.slug}/reserve`, { quantity: '0', requestKey: randomUUID() }).expect(422);
  assert.ok(bad.text.includes(t('Choose a positive whole number of portions.')));
  const forbidden = await world.recipient.agent.get(world.base).expect(403);
  assert.ok(forbidden.text.includes(t('Organizer access requires a separate organizer account. Recipient accounts cannot manage organizations.')));
  const csrfError = await world.recipient.agent.post('/profile/food-support').type('form').send({ needsFoodSupport: 'yes' }).expect(403);
  assert.ok(csrfError.text.includes(t('This form expired or could not be verified. Reload the page and try again.')));
  const absent = await world.recipient.agent.get('/unknown-page').expect(404);
  assert.ok(absent.text.includes(t('Page not found')));
  await post(world.admin, '/language', { language: 'am' }).expect(303);
  for (const [path,label] of [[world.base,'Organizer dashboard'],[`${world.base}/listings`,'Listings'],[`${world.base}/listings/new`,'Create food listing'],[`${world.base}/events/new`,'Create event'],[`${world.base}/pickups`,'Organization pickups'],[`${world.base}/volunteers`,'Manage volunteers'],['/profile','Account type']]) {
    const html = (await world.admin.agent.get(path).expect(200)).text;
    assert.ok(html.includes(t(label)), `${path}: ${label}`);
    for (const nav of ['Dashboard','Listings','Pickups','Profile']) assert.ok(html.includes(t(nav)));
    if(path.endsWith('/listings/new')) assert.match(html, /option value="open"/); // Translated display must preserve machine values.
  }
  await post(world.volunteer, '/language', { language: 'am' }).expect(303);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(303);
  assert.ok((await world.recipient.agent.get(`/reservations/${reservation._id}`)).text.includes(t('Collected')));
  await post(world.recipient, '/language', { language: 'en', returnTo: '//external.example' }).expect(303).expect('Location', '/');
  assert.match((await world.recipient.agent.get('/profile')).text, /<html lang="en">/);
  await post(world.recipient, '/language', { language: 'am' }).expect(303);
  await post(world.recipient, '/logout').expect(303);
  assert.match((await world.recipient.agent.get('/login')).text, /<html lang="am">/);
});

async function upload(actor, url, data, buffer, { csrf = actor.csrf, filename = '../../not-trusted.jpg', contentType = 'image/jpeg' } = {}) {
  const form = actor.agent.post(url);
  if (buffer) form.attach('foodPhoto', buffer, { filename, contentType });
  for (const [key, value] of Object.entries({ _csrf: csrf, ...data })) form.field(key, String(value));
  return form;
}

test('photo listing rehearsal: create, preview form, persist, reserve, code lookup, collect once and cancel once', async () => {
  const world = await setup();
  await post(world.admin, `${world.base}/events`, eventBody({ title: 'Fictional submission rehearsal', description: 'No real food.', pickupStartsAt: minute(-3), pickupEndsAt: minute(4), pickupLocation: 'Fictional table', pickupInstructions: 'Show the code for this rehearsal only.', status: 'open', revision: 0 })).expect(303);
  const evt = await database.models.Event.findOne({ organization: world.orgA._id });
  const data = foodBody({ ...sampleFoods[1], eventId: evt._id, pickupStartsAt: minute(-1), pickupEndsAt: minute(2), totalPortions: 5, perAccountLimit: 3, status: 'open', revision: 0 });
  const form = await world.admin.agent.get(`${world.base}/listings/new`).expect(200);
  assert.match(form.text, /enctype="multipart\/form-data"/);
  assert.match(form.text, /name="foodPhoto" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(form.text, /data-photo-preview/);
  assert.doesNotMatch(form.text, /capture=|prioritySettings/);
  // A genuine image is accepted even with an untrusted filename/MIME claim.
  const image = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#9f4b25' } }).png().toBuffer();
  assert.equal((await upload(world.admin, `${world.base}/listings`, data, image, { contentType: 'application/octet-stream' })).status, 303);
  let listing = await database.models.Listing.findOne({ organizationId: world.orgA._id });
  assert.match(listing.image, /^\/uploads\/food-photos\/[a-f0-9-]{36}\.webp$/);
  assert.equal(listing.imageType, 'photo');
  const photoPath = listing.image;
  const bytes = await fs.readFile(path.join(uploadDirectory, path.basename(photoPath)));
  assert.equal((await sharp(bytes).metadata()).format, 'webp');
  await request(app).get(photoPath).expect(200).expect('Content-Type', /image\/webp/);
  assert.ok((await world.recipient.agent.get('/')).text.includes(photoPath.replace('.webp', '-thumb.webp')));
  assert.ok((await world.recipient.agent.get(`/foods/${listing.slug}`)).text.includes(photoPath));
  const reservation = await reserve(world.recipient, listing, 2);
  assert.equal((await latest(listing)).availablePortions, 3);
  const pickups = await world.recipient.agent.get('/my-pickups').expect(200);
  assert.ok(pickups.text.includes(reservation.pickupCode));
  assert.match(pickups.text, /2 portions/);
  assert.ok(pickups.text.includes(listing.pickupLocation));
  await post(world.recipient, `/foods/${listing.slug}/reserve`, { quantity: '2', requestKey: reservation.requestKey }).expect(303);
  assert.equal((await latest(listing)).availablePortions, 3);
  // Reconstruct the app with its persistent store/directory, preserving session.
  const restarted = createApp({ ...database, sessionSecret, uploadDirectory });
  await request(restarted).get(photoPath).expect(200);
  assert.equal(await database.models.Reservation.countDocuments({ _id: reservation._id }), 1);
  assert.equal(reservation.food.image, photoPath);
  await post(world.volunteer, `${world.base}/pickups/lookup`, { pickupCode: reservation.pickupCode }).expect(303).expect('Location', `${world.base}/pickups/${reservation._id}`);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(303);
  await post(world.volunteer, `${world.base}/pickups/${reservation._id}/confirm`, { confirm: 'collected' }).expect(409);
  assert.equal((await latest(listing)).availablePortions, 3);
  assert.equal((await database.models.Reservation.findById(reservation._id)).status, 'collected');
  const other = await account('Cancellation Recipient');
  const cancelled = await reserve(other, listing);
  assert.equal((await latest(listing)).availablePortions, 2);
  await post(world.recipient, `/reservations/${cancelled._id}/cancel`).expect(404);
  await post(other, `/reservations/${cancelled._id}/cancel`).expect(303);
  await post(other, `/reservations/${cancelled._id}/cancel`).expect(303);
  assert.equal((await latest(listing)).availablePortions, 3);
  assert.equal((await database.models.Reservation.findById(cancelled._id)).status, 'cancelled');
  listing = await latest(listing);
  await post(world.admin, `${world.base}/listings/${listing._id}`, foodBody(listing)).expect(303);
  assert.equal((await latest(listing)).image, photoPath); // No replacement keeps it.
  assert.deepEqual(await fs.readFile(path.join(uploadDirectory, path.basename(photoPath))), bytes);
});

test('food uploads reject fake images, oversized/huge images, CSRF failures and unauthorized actors without files or listings', async () => {
  const world = await setup(), evt = await event(world.orgA);
  const data = foodBody({ ...sampleFoods[0], eventId: evt._id, pickupStartsAt: minute(-1), pickupEndsAt: minute(2), totalPortions: 5, perAccountLimit: 3, status: 'open', revision: 0 });
  const before = await fs.readdir(uploadDirectory);
  const genuine = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'green' } }).png().toBuffer();
  const url = `${world.base}/listings`;
  for (const fake of [Buffer.from('<script>bad()</script>'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), genuine.subarray(0, 30)]) {
    assert.equal((await upload(world.admin, url, data, fake)).status, 422);
  }
  assert.equal((await upload(world.admin, url, data, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  const huge = await sharp({ create: { width: 5001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await upload(world.admin, url, data, huge)).status, 422);
  assert.equal((await upload(world.admin, url, data, genuine, { csrf: '0'.repeat(64) })).status, 403);
  assert.equal((await upload(world.recipient, url, data, genuine)).status, 403);
  assert.equal((await upload(world.volunteer, url, data, genuine)).status, 403);
  assert.equal((await upload(world.admin, `${world.foreign}/listings`, data, genuine)).status, 403);
  assert.equal((await upload(world.admin, url, { ...data, totalPortions: '0' }, genuine)).status, 422);
  assert.equal(await database.models.Listing.countDocuments({}), 0);
  assert.deepEqual(await fs.readdir(uploadDirectory), before);
  // No file uses a neutral placeholder; forged body image paths are ignored.
  assert.equal((await upload(world.admin, url, { ...data, image: sampleFoods[0].image }, null)).status, 303);
  const listing = await database.models.Listing.findOne();
  assert.equal(listing.image, '/images/food-placeholder.svg');
  assert.equal(listing.imageType, 'placeholder');
});

test('photo replacements preserve old reservation snapshots and reject stale inventory edits without orphan files', async () => {
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const reservation = await reserve(world.recipient, listing);
  const originalSnapshot = reservation.food.toObject();
  const before = await fs.readdir(uploadDirectory);
  const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'green' } }).jpeg().toBuffer();
  const url = `${world.base}/listings/${listing._id}`;
  assert.equal((await upload(world.admin, url, foodBody(listing), image)).status, 409);
  assert.deepEqual(await fs.readdir(uploadDirectory), before);
  assert.equal((await upload(world.admin, url, foodBody(await latest(listing)), image)).status, 303);
  const updated = await latest(listing);
  assert.match(updated.image, /^\/uploads\//);
  assert.equal(updated.availablePortions, 7);
  assert.equal(updated.translations.am.imageAlt, '');
  assert.deepEqual((await database.models.Reservation.findById(reservation._id)).food.toObject(), originalSnapshot);
});

test('rehearsal setup is additive, idempotent and assigned only to the existing fictional organization admin', async () => {
  const { prepareRehearsal } = require('../scripts/prepare-rehearsal');
  const world = await setup(), evt = await event(world.orgA), listing = await food(world.orgA, evt);
  const reservation = await reserve(world.recipient, listing);
  const originalListing = (await latest(listing)).toObject(), originalReservation = (await database.models.Reservation.findById(reservation._id)).toObject();
  const date = chicagoInput(new Date()).slice(0, 10);
  const args = { email: world.admin.user.email, date };
  const first = await prepareRehearsal(database, args), second = await prepareRehearsal(database, args);
  assert.equal(String(first._id), String(second._id));
  assert.equal(String(first.organization), String(world.orgA._id));
  assert.equal(first.pickupStartsAt < new Date(), true); assert.equal(first.pickupEndsAt > new Date(), true);
  await world.admin.agent.get(`${world.base}/events/${first._id}/edit`).expect(200);
  await assert.rejects(prepareRehearsal(database, { ...args, email: world.recipient.user.email }), e => e.status === 404);
  await assert.rejects(prepareRehearsal(database, { ...args, email: world.volunteer.user.email }), e => e.status === 409);
  await assert.rejects(prepareRehearsal(database, { ...args, production: true }), e => e.status === 403);
  assert.deepEqual((await latest(listing)).toObject(), originalListing);
  assert.deepEqual((await database.models.Reservation.findById(reservation._id)).toObject(), originalReservation);
});
