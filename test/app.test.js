const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
const ejs = require('ejs');
const request = require('supertest');
const fs = require('node:fs/promises');
const os = require('node:os');
const sharp = require('sharp');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { connectDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { sampleFoods } = require('../src/data/sample-foods');
const { seedDemo } = require('../scripts/seed-demo');
const { pickupPresentation } = require('../src/lib/presentation');

let replicaSet, database, app, uri, uploadDirectory;
// Atlas limits database names to 38 bytes; retain 64 random bits for isolation.
const databaseName = `community_table_test_${randomBytes(8).toString('hex')}`;
const sessionSecret = randomBytes(32).toString('hex');
const password = 'Community-table-test-934!';
function newApp(extra = {}) { return createApp({ ...database, sessionSecret, loginLimit: 100, signupLimit: 100, uploadDirectory, ...extra }); }
function field(html, name) {
  const found = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(found, `Form should contain ${name}`);
  return found[1];
}
async function token(agent, route = '/login') { return field((await agent.get(route).expect(200)).text, '_csrf'); }
async function signup(agent, email = `${randomUUID()}@example.test`, extra = {}) {
  const _csrf = await token(agent, '/signup');
  const response = await agent.post('/signup').type('form').send({ name: 'Demo Recipient', email, password, _csrf, ...extra }).expect(303);
  const user = await database.models.User.findOne({ email: email.trim().toLowerCase() }).lean();
  return { user, cookie: response.headers['set-cookie'][0].split(';')[0], csrf: await token(agent, '/profile') };
}
async function listing(extra = {}) {
  return database.models.Listing.create({
    ...sampleFoods[0], slug: `food-${randomUUID()}`, totalPortions: 8, availablePortions: 8, perAccountLimit: 3,
    pickupStartsAt: new Date(Date.now() + 60 * 60 * 1000), pickupEndsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    status: 'open', ...extra
  });
}
async function reservationForm(agent, food) {
  const response = await agent.get(`/foods/${food.slug}`).expect(200);
  return { _csrf: field(response.text, '_csrf'), requestKey: field(response.text, 'requestKey'), quantity: '1', confirm: 'reserve' };
}
const reserve = (agent, food, form) => agent.post(`/foods/${food.slug}/reserve`).type('form').send({ confirm: 'reserve', ...form });
async function remaining(food) { return (await database.models.Listing.findById(food._id)).availablePortions; }

before(async () => {
  if (process.env.TEST_MONGODB_URI) {
    uri = process.env.TEST_MONGODB_URI;
  } else {
    replicaSet = await MongoMemoryReplSet.create({
      binary: { version: '7.0.24', downloadDir: path.join(process.cwd(), '.cache/mongodb-binaries') },
      replSet: { count: 1, storageEngine: 'wiredTiger' }
    });
    uri = replicaSet.getUri();
  }
  database = await connectDatabase(uri, { dbName: databaseName });
  assert.equal(database.connection.name, databaseName);
  uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-table-personal-test-'));
  app = newApp();
  console.log(`Real MongoDB replica-set tests use isolated database ${databaseName}.`);
}, { timeout: 180000 });

beforeEach(async () => {
  if (!database) return;
  // These deletions are confined to this run's randomly named test database.
  assert.equal(database.connection.name, databaseName);
  await database.models.Reservation.deleteMany({});
  await database.models.Listing.deleteMany({});
  await database.models.User.deleteMany({});
  await database.models.Membership.deleteMany({});
  await database.models.Event.deleteMany({});
  await database.models.Organization.deleteMany({});
  await database.connection.db.collection('sessions').deleteMany({});
  await database.connection.db.collection('rate_limits').deleteMany({});
});

after(async () => {
  if (database?.connection.readyState === 1) {
    assert.equal(database.connection.name, databaseName);
    await database.connection.dropDatabase();
    await database.connection.close();
  }
  if (replicaSet) await replicaSet.stop();
  if (uploadDirectory) await fs.rm(uploadDirectory, { recursive: true, force: true });
});

test('signup hashes passwords, normalizes email, ignores role escalation, rotates sessions, and logs out', async () => {
  const agent = request.agent(app);
  const initial = await agent.get('/signup').expect(200);
  const anonymousCookie = initial.headers['set-cookie'][0].split(';')[0];
  const oldToken = field(initial.text, '_csrf');
  const response = await agent.post('/signup').type('form').send({ name: 'Demo Recipient', email: '  DEMO@example.test  ', password, role: 'admin', _csrf: oldToken }).expect(303);
  assert.notEqual(response.headers['set-cookie'][0].split(';')[0], anonymousCookie);
  const user = await database.models.User.findOne({ email: 'demo@example.test' }).select('+passwordHash');
  assert.equal(user.role, 'member');
  assert.match(user.passwordHash, /^scrypt:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(!user.passwordHash.includes(password));
  const profile = await agent.get('/profile').expect(200);
  assert.match(profile.text, /Demo Recipient/);
  assert.match(profile.text, /demo@example.test/);
  assert.doesNotMatch(profile.text, /scrypt:/);
  await agent.post('/logout').type('form').send({ _csrf: oldToken }).expect(403);
  await agent.post('/logout').type('form').send({ _csrf: field(profile.text, '_csrf') }).expect(303);
  assert.match((await agent.get('/profile').expect(200)).text, /browsing as a guest/);
  const persisted = await database.connection.db.collection('sessions').find({}).toArray();
  assert.ok(!persisted.some(row => JSON.stringify(row.session).includes(user._id.toString())));
});

test('login rejects wrong passwords, accepts the correct password, and refuses open redirects', async () => {
  const agent = request.agent(app);
  await signup(agent, 'login@example.test');
  const logoutToken = await token(agent, '/profile');
  await agent.post('/logout').type('form').send({ _csrf: logoutToken }).expect(303);
  const _csrf = await token(agent);
  await agent.post('/login').type('form').send({ email: 'login@example.test', password: 'wrong-password', _csrf }).expect(401);
  const result = await agent.post('/login').type('form').send({ email: 'LOGIN@example.test', password, _csrf, next: '//example.org/steal' }).expect(303);
  assert.equal(result.headers.location, '/');
  assert.match((await agent.get('/profile').expect(200)).text, /login@example.test/);
});

test('CSRF is required for signup, login, reservation, cancellation, and logout', async () => {
  const agent = request.agent(app);
  await agent.post('/signup').type('form').send({ name: 'Bad form', email: 'bad@example.test', password }).expect(403);
  await agent.post('/login').type('form').send({ email: 'bad@example.test', password }).expect(403);
  assert.equal(await database.models.User.countDocuments(), 0);
  await signup(agent);
  const food = await listing();
  const form = await reservationForm(agent, food);
  await reserve(agent, food, { ...form, _csrf: 'f'.repeat(64) }).expect(403);
  assert.equal(await remaining(food), 8);
  const result = await reserve(agent, food, form).expect(303);
  await agent.post(`${result.headers.location}/cancel`).type('form').send({}).expect(403);
  await agent.post('/logout').type('form').send({}).expect(403);
  assert.equal(await database.models.Reservation.countDocuments({ status: 'active' }), 1);
});

test('browse is public and database-backed; unauthenticated reservations require login', async () => {
  const food = await listing();
  const guest = request.agent(app);
  const browse = await guest.get('/').expect(200);
  assert.doesNotMatch(browse.text, /Demo food listings/);
  assert.match(browse.text, /href="\/about"/);
  assert.doesNotMatch(browse.text, /reservations unavailable/);
  assert.ok(browse.text.includes(`/foods/${food.slug}`));
  const form = await reservationForm(guest, food);
  const response = await reserve(guest, food, form).expect(303);
  assert.ok(response.headers.location.startsWith('/login?next='));
  assert.equal(await database.models.Reservation.countDocuments(), 0);
  assert.equal(await remaining(food), 8);
});

test('reservation persists inventory, pickup code, instructions, session and account across app/connection restart', async () => {
  const food = await listing();
  const agent = request.agent(app);
  const account = await signup(agent, 'persist@example.test');
  const response = await reserve(agent, food, { ...await reservationForm(agent, food), quantity: '2' }).expect(303);
  const saved = await database.models.Reservation.findOne({ user: account.user._id }).lean();
  assert.match(saved.pickupCode, /^[A-F0-9]{32}$/);
  assert.equal(saved.quantity, 2);
  assert.equal(await remaining(food), 6);
  const page = await agent.get('/my-pickups').expect(200);
  assert.ok(!page.text.includes(saved.pickupCode));
  assert.match(page.text, /2 portions/);
  assert.match(page.text, /America\/Chicago/);
  assert.ok(page.text.includes(saved.pickupStartsAt.toISOString()));
  assert.ok(!page.text.includes(saved.food.pickupInstructions));
  const details = await agent.get(response.headers.location).expect(200);
  assert.ok(details.text.includes(saved.pickupCode));
  assert.ok(details.text.includes(saved.food.pickupInstructions));
  await database.connection.close();
  database = await connectDatabase(uri, { dbName: databaseName });
  app = newApp();
  const restarted = request.agent(app);
  const profile = await restarted.get('/profile').set('Cookie', account.cookie).expect(200);
  assert.match(profile.text, /persist@example.test/);
  const pickups = await restarted.get('/my-pickups').set('Cookie', account.cookie).expect(200);
  assert.ok(!pickups.text.includes(saved.pickupCode));
  const restartedDetails = await restarted.get(response.headers.location).set('Cookie', account.cookie).expect(200);
  assert.ok(restartedDetails.text.includes(saved.pickupCode));
  assert.equal(await remaining(food), 6);
  assert.equal(await database.models.Reservation.countDocuments(), 1);
});

test('six concurrent accounts competing for the last portion cannot overbook', async () => {
  const food = await listing({ totalPortions: 1, availablePortions: 1, perAccountLimit: 1 });
  const agents = [];
  for (let index = 0; index < 6; index++) {
    const agent = request.agent(app);
    await signup(agent);
    agents.push(agent);
  }
  const forms = await Promise.all(agents.map(agent => reservationForm(agent, food)));
  const responses = await Promise.all(agents.map((agent, index) => reserve(agent, food, forms[index])));
  assert.equal(responses.filter(response => response.status === 303).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 5);
  assert.equal(await remaining(food), 0);
  assert.equal(await database.models.Reservation.countDocuments({ status: 'active' }), 1);
});

test('concurrent multi-portion requests reserve the whole quantity or nothing', async () => {
  const food = await listing({ totalPortions: 3, availablePortions: 3, perAccountLimit: 2 });
  const agents = [request.agent(app), request.agent(app)];
  for (const agent of agents) await signup(agent);
  const forms = await Promise.all(agents.map(agent => reservationForm(agent, food)));
  const responses = await Promise.all(agents.map((agent, index) => reserve(agent, food, { ...forms[index], quantity: '2' })));
  assert.deepEqual(responses.map(response => response.status).sort(), [303, 409]);
  assert.equal(await remaining(food), 1);
  const saved = await database.models.Reservation.find().lean();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].quantity, 2);
});

test('duplicate concurrent submissions/retries yield one reservation, one code and one inventory decrement', async () => {
  const food = await listing();
  const agent = request.agent(app);
  await signup(agent);
  const form = { ...await reservationForm(agent, food), quantity: '2' };
  const responses = await Promise.all(Array.from({ length: 6 }, () => reserve(agent, food, form)));
  assert.ok(responses.every(response => response.status === 303));
  assert.equal(new Set(responses.map(response => response.headers.location)).size, 1);
  assert.equal(await remaining(food), 6);
  assert.equal(await database.models.Reservation.countDocuments(), 1);
  const original = responses[0].headers.location;
  assert.equal((await reserve(agent, food, form).expect(303)).headers.location, original);
  await reserve(agent, food, { ...form, quantity: '3' }).expect(409);
  await reserve(agent, food, { ...form, requestKey: randomUUID() }).expect(409);
  assert.equal(await remaining(food), 6);
});

test('repeated/concurrent cancellation restores inventory once; replaying an old form stays cancelled', async () => {
  const food = await listing();
  const agent = request.agent(app);
  await signup(agent);
  const form = { ...await reservationForm(agent, food), quantity: '3' };
  const response = await reserve(agent, food, form).expect(303);
  assert.equal(await remaining(food), 5);
  const cancellations = await Promise.all(Array.from({ length: 5 }, () => agent.post(`${response.headers.location}/cancel`).type('form').send({ _csrf: form._csrf })));
  assert.ok(cancellations.every(result => result.status === 303));
  assert.equal(await remaining(food), 8);
  assert.equal(await database.models.Reservation.countDocuments({ status: 'cancelled' }), 1);
  await reserve(agent, food, form).expect(303);
  assert.equal(await remaining(food), 8);
  assert.equal(await database.models.Reservation.countDocuments(), 1);
  // A new intentional reservation after cancellation uses a new key.
  await reserve(agent, food, await reservationForm(agent, food)).expect(303);
  assert.equal(await remaining(food), 7);
});

test('another account cannot view, list or cancel the owner’s reservation', async () => {
  const owner = request.agent(app), stranger = request.agent(app);
  await signup(owner);
  await signup(stranger);
  const food = await listing();
  const response = await reserve(owner, food, await reservationForm(owner, food)).expect(303);
  const saved = await database.models.Reservation.findOne().lean();
  await stranger.get(response.headers.location).expect(404);
  const pickups = await stranger.get('/my-pickups').expect(200);
  assert.ok(!pickups.text.includes(saved.pickupCode));
  const strangerToken = await token(stranger, '/profile');
  await stranger.post(`${response.headers.location}/cancel`).type('form').send({ _csrf: strangerToken, user: saved.user.toString() }).expect(404);
  assert.equal(await remaining(food), 7);
  assert.equal((await database.models.Reservation.findById(saved._id)).status, 'active');
});

test('expired/closed listings reject reservations; cancellations after the deadline restore nothing', async () => {
  const agent = request.agent(app);
  await signup(agent);
  const _csrf = await token(agent, '/profile');
  const expired = await listing({ pickupStartsAt: new Date(Date.now() - 2 * 60 * 60 * 1000), pickupEndsAt: new Date(Date.now() - 1000) });
  const closed = await listing({ status: 'closed' });
  for (const food of [expired, closed]) {
    await reserve(agent, food, { _csrf, requestKey: randomUUID(), quantity: '1' }).expect(410);
    assert.equal(await remaining(food), 8);
  }
  const active = await listing();
  const response = await reserve(agent, active, await reservationForm(agent, active)).expect(303);
  await database.models.Reservation.updateOne({}, { $set: { pickupEndsAt: new Date(Date.now() - 1000) } });
  await agent.post(`${response.headers.location}/cancel`).type('form').send({ _csrf }).expect(410);
  assert.equal(await remaining(active), 7);
  const browse = await agent.get('/').expect(200);
  assert.ok(!browse.text.includes(`/foods/${expired.slug}`));
  assert.ok(!browse.text.includes(`/foods/${closed.slug}`));
});

test('invalid quantities, limit violations, insufficient inventory and invalid keys cause no writes', async () => {
  const food = await listing({ perAccountLimit: 2 });
  const agent = request.agent(app);
  await signup(agent);
  const form = await reservationForm(agent, food);
  for (const quantity of ['0', '-1', '1.5', '1e2', '', 'NaN', '9007199254740992', '3']) {
    await reserve(agent, food, { ...form, quantity }).expect(422);
  }
  await reserve(agent, food, { ...form, requestKey: 'invalid' }).expect(422);
  assert.equal(await remaining(food), 8);
  assert.equal(await database.models.Reservation.countDocuments(), 0);
  await database.models.Listing.updateOne({ _id: food._id }, { $set: { availablePortions: 1 } });
  await reserve(agent, food, { ...form, quantity: '2' }).expect(409);
  assert.equal(await remaining(food), 1);
});

test('reservation insert failure rolls back the inventory change in the transaction', async () => {
  const food = await listing();
  const agent = request.agent(app);
  await signup(agent);
  const form = await reservationForm(agent, food);
  // Force a real validation failure after inventory is decremented, without mocking MongoDB.
  await database.models.Listing.collection.updateOne({ _id: food._id }, { $unset: { pickupInstructions: '' } });
  const response = await reserve(agent, food, form).expect(503);
  assert.match(response.text, /reservations unavailable/);
  assert.equal(await remaining(food), 8);
  assert.equal(await database.models.Reservation.countDocuments(), 0);
});

test('login rate limits are persisted in MongoDB and survive rebuilding the app', async () => {
  const limitedApp = newApp({ loginLimit: 2 });
  const agent = request.agent(limitedApp);
  const _csrf = await token(agent);
  const form = { email: 'unknown@example.test', password, _csrf };
  await agent.post('/login').type('form').send(form).expect(401);
  await agent.post('/login').type('form').send(form).expect(401);
  const blocked = await agent.post('/login').type('form').send(form).expect(429);
  assert.ok(blocked.headers['retry-after']);
  const rebuilt = request.agent(newApp({ loginLimit: 2 }));
  const rebuiltToken = await token(rebuilt);
  await rebuilt.post('/login').type('form').send({ ...form, _csrf: rebuiltToken }).expect(429);
  assert.equal(await database.connection.db.collection('rate_limits').countDocuments(), 1);
});

test('explicit seeding creates the five future sample listings and never resets existing inventory or windows', async () => {
  assert.equal(await database.models.Listing.countDocuments(), 0);
  const beforeSeed = new Date();
  assert.equal(await seedDemo(database.models, beforeSeed), sampleFoods.length);
  const food = await database.models.Listing.findOne({ slug: sampleFoods[0].id });
  assert.ok(food.pickupStartsAt > beforeSeed);
  const originalWindow = food.pickupStartsAt.getTime();
  const agent = request.agent(app);
  await signup(agent);
  await reserve(agent, food, { ...await reservationForm(agent, food), quantity: '2' }).expect(303);
  assert.equal(await seedDemo(database.models, new Date(Date.now() + 5 * 86400000)), 0);
  const unchanged = await database.models.Listing.findById(food._id);
  assert.equal(unchanged.availablePortions, 6);
  assert.equal(unchanged.pickupStartsAt.getTime(), originalWindow);
  assert.equal(await database.models.Listing.countDocuments(), sampleFoods.length);
  assert.equal(await database.models.Event.countDocuments(), sampleFoods.length);
  assert.equal(await database.models.Organization.countDocuments(), 1);
});

test('development seeding skips existing legacy listings without creating unused organization/event rows or resetting reservations', async () => {
  const food = await listing({ slug: sampleFoods[0].id });
  const agent = request.agent(app);
  await signup(agent);
  const reservation = await reserve(agent, food, { ...await reservationForm(agent, food), quantity: '2' }).expect(303);
  assert.equal(await seedDemo(database.models), sampleFoods.length - 1);
  const unchanged = await database.models.Listing.findById(food._id);
  assert.equal(unchanged.availablePortions, 6);
  assert.equal(unchanged.organizationId, undefined); assert.equal(unchanged.eventId, undefined);
  assert.equal(await database.models.Organization.countDocuments(), 1);
  assert.equal(await database.models.Event.countDocuments(), sampleFoods.length - 1);
  assert.equal(await database.models.Reservation.countDocuments(), 1);
  await agent.get(reservation.headers.location).expect(200);
});

test('missing ingredients/allergens remain unknown and Chicago date formatting handles DST', async () => {
  const food = await listing();
  for (const missing of [{ ingredients: undefined, allergens: undefined }, { ingredients: [], allergens: '' }, { ingredients: null, allergens: ' ' }]) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/food-details.ejs'), {
      title: 'Food', activePage: 'browse', food: { ...food.toObject(), id: food.slug, pickupDate: 'Nov 1, 2026', pickupDateISO: '2026-11-01T06:30:00Z', pickupWindow: '1:30 AM CDT–2:30 AM CST', ...missing },
      currentUser: null, csrfToken: '', reservationsReady: true, existingReservation: null, canReserve: true, quantityMaximum: 3, requestKey: randomUUID()
    });
    assert.equal((html.match(/Unknown — not provided by the organizer\./g) || []).length, 2);
    assert.doesNotMatch(html, /no major allergens/);
  }
  const display = pickupPresentation('2026-11-01T06:30:00Z', '2026-11-01T08:30:00Z');
  assert.equal(display.pickupDate, 'Nov 1, 2026');
  assert.equal(display.pickupWindow, '1:30 AM CDT–2:30 AM CST');
});

test('public assets and missing pages still work with the existing navigation', async () => {
  for (const asset of ['/css/styles.css', '/js/app.js', '/images/favicon.svg', ...sampleFoods.map(food => food.image)]) {
    await request(app).get(asset).expect(200);
  }
  await request(app).get('/missing-page').expect(404);
  const browse = await request(app).get('/').expect(200);
  assert.match(browse.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(browse.headers['cache-control'], 'no-store');
});

test('five sample foods render only the selected language, with local photos and About credits', async () => {
  const photos = require('../src/data/food-photos.json');
  assert.equal(sampleFoods.length, 5);
  await seedDemo(database.models);
  const content = html => html.match(/<main\b[\s\S]*?<\/main>/)[0];
  for (const language of ['en','am']) {
    const cookie = `community.lang=${language}`;
    const browse = await request(app).get('/').set('Cookie',cookie).expect(200);
    assert.doesNotMatch(browse.text, /Demo food listings/);
    if(language === 'en') assert.doesNotMatch(content(browse.text), /[\u1200-\u137f]/);
    for (const sample of sampleFoods) {
      assert.equal(sample.imageType, 'photo');
      const selected = language === 'am' ? sample.translations.am : sample;
      const other = language === 'am' ? sample : sample.translations.am;
      const photo = photos.find(photo => photo.listingId === sample.id);
      assert.ok(content(browse.text).includes(selected.name));
      assert.ok(content(browse.text).includes(selected.organization));
      assert.ok(!content(browse.text).includes(other.name));
      assert.ok(!content(browse.text).includes(other.organization));
      assert.ok(browse.text.includes(photo.thumbnail));
      const page = await request(app).get(`/foods/${sample.id}`).set('Cookie',cookie).expect(200);
      assert.ok(page.text.includes(sample.image));
      assert.doesNotMatch(content(page.text), /Placeholder|amharic-text/);
      for (const field of ['name','organization','description','portionSize','allergens','pickupLocation','pickupInstructions']) {
        assert.ok(content(page.text).includes(selected[field]), `${language}: ${field}`);
        assert.ok(!content(page.text).includes(other[field]), `${language}: no duplicate ${field}`);
      }
      for(const ingredient of selected.ingredients) assert.ok(content(page.text).includes(ingredient));
      if(language === 'en') assert.doesNotMatch(content(page.text), /[\u1200-\u137f]/);
      for(const asset of [sample.image,photo.thumbnail]) {
        const response = await request(app).get(asset).expect(200);
        assert.match(response.headers['content-type'], /image\/webp/);
        assert.ok(response.body.length < 120000);
      }
    }
    const about = await request(app).get('/about').set('Cookie',cookie).expect(200);
    for(const photo of photos) {
      assert.ok(about.text.includes(photo.creator));
      assert.ok(about.text.includes(photo.source.replaceAll('&','&amp;')));
      assert.ok(about.text.includes(photo.licenseUrl));
    }
    assert.ok(about.text.includes(language === 'am' ? 'የፎቶ ምንጮችና ምስጋና' : 'Photo credits'));
  }
  const doro = sampleFoods[0]; assert.match(doro.allergens, /egg and milk/);
  for (const dish of sampleFoods.slice(1, 3)) { assert.match(dish.allergens, /Contains wheat/); assert.match(dish.allergens, /not gluten-free/); }
  assert.notDeepEqual(sampleFoods[1].ingredients, sampleFoods[2].ingredients);
  const agent = request.agent(app); await signup(agent);
  const listing = await database.models.Listing.findOne({ slug: doro.id });
  const saved = await reserve(agent, listing, await reservationForm(agent, listing)).expect(303);
  const record = await database.models.Reservation.findOne().lean();
  assert.deepEqual(record.food.translations.am, listing.toObject().translations.am);
  assert.ok((await agent.get(saved.headers.location).set('Cookie','community.lang=am').expect(200)).text.includes(doro.translations.am.pickupInstructions));
});

test('listing fields fall back individually to the other language only when selected text is missing', () => {
  const { presentListing } = require('../src/lib/presentation');
  const original = { ...sampleFoods[0], slug: 'fallback-food', pickupStartsAt: new Date(), pickupEndsAt: new Date(Date.now()+3600000) };
  const incompleteAm = { ...original, translations: { am: { ...original.translations.am, description: '', ingredients: [] } } };
  const am = presentListing(incompleteAm, 'am');
  assert.equal(am.name, original.translations.am.name);
  assert.equal(am.description, original.description);
  assert.deepEqual(am.ingredients, original.ingredients);
  const incompleteEn = { ...original, name: '', organization: ' ', ingredients: [] };
  const en = presentListing(incompleteEn, 'en');
  assert.equal(en.name, original.translations.am.name);
  assert.equal(en.organization, original.translations.am.organization);
  assert.deepEqual(en.ingredients, original.translations.am.ingredients);
  assert.equal(en.description, original.description);
  assert.equal(incompleteEn.name, ''); // Rendering never rewrites stored content.
});

test('sample photo update preserves IDs, quantities, dates, accounts, reservations and customized photos, and is idempotent', async () => {
  const { updateSamplePhotos } = require('../scripts/update-sample-photos');
  await seedDemo(database.models);
  await database.models.Listing.updateMany({}, { $set: { image: '/images/food-placeholder.svg', imageType: 'placeholder' } }, { timestamps: false });
  const protectedFood = await database.models.Listing.findOne({ slug: sampleFoods[4].id });
  await database.models.Listing.updateOne({ _id: protectedFood._id }, { $set: { image: '/images/custom-photo.jpg', imageType: 'photo' } }, { timestamps: false });
  const agent = request.agent(app); await signup(agent);
  const food = await database.models.Listing.findOne({ slug: sampleFoods[0].id });
  await reserve(agent, food, await reservationForm(agent, food)).expect(303);
  const reservations = await database.models.Reservation.find().lean();
  const accounts = await database.models.User.find().select('+passwordHash +needsFoodSupport').lean();
  const before = await database.models.Listing.find().sort({ slug: 1 }).lean();
  const events = await database.models.Event.find().lean();
  assert.equal(await updateSamplePhotos(database), 4);
  assert.equal(await updateSamplePhotos(database), 0);
  assert.deepEqual(await database.models.Reservation.find().lean(), reservations);
  assert.deepEqual(await database.models.User.find().select('+passwordHash +needsFoodSupport').lean(), accounts);
  assert.deepEqual(await database.models.Event.find().lean(), events);
  const after = await database.models.Listing.find().sort({ slug: 1 }).lean();
  for(const [index,old] of before.entries()) {
    const updated = after[index];
    for(const key of ['_id','slug','availablePortions','totalPortions','pickupStartsAt','pickupEndsAt','createdAt','updatedAt','perAccountLimit','status','name','description','ingredients','allergens']) assert.deepEqual(updated[key],old[key],key);
    const oldAm = { ...old.translations.am }, newAm = { ...updated.translations.am };
    delete oldAm.imageAlt; delete newAm.imageAlt; assert.deepEqual(newAm,oldAm);
  }
  assert.equal((await database.models.Listing.findById(protectedFood._id)).image, '/images/custom-photo.jpg');
});

test('adding new samples leaves every legacy listing and reservation unchanged', async () => {
  const legacy = await listing({ slug: 'lentil-stew', name: 'Original legacy soup', image: '/images/lentil-stew.svg', imageType: 'illustration' });
  const agent = request.agent(app); await signup(agent);
  const saved = await reserve(agent, legacy, await reservationForm(agent, legacy)).expect(303);
  const beforeListing = await database.models.Listing.findById(legacy._id).lean();
  const beforeReservation = await database.models.Reservation.findOne().lean();
  assert.equal(await seedDemo(database.models), 5);
  assert.deepEqual(await database.models.Listing.findById(legacy._id).lean(), beforeListing);
  assert.deepEqual(await database.models.Reservation.findOne().lean(), beforeReservation);
  assert.equal(await database.models.Listing.countDocuments(), 6);
  const browse = await agent.get('/').expect(200);
  assert.doesNotMatch(browse.text, /Original legacy soup/);
  await agent.get('/foods/lentil-stew').expect(200);
  assert.equal(await seedDemo(database.models), 0);
  await agent.get(saved.headers.location).expect(200);
});

test('misir-only photo correction preserves inventory, snapshots and all other listing images', async () => {
  const { updateMisirPhoto } = require('../scripts/update-misir-photo');
  const fs = require('node:fs'), { createHash } = require('node:crypto');
  const photos = require('../src/data/food-photos.json');
  await seedDemo(database.models);
  const misir = await database.models.Listing.findOne({ slug: 'sample-misir-wot-injera' });
  await database.models.Listing.updateOne({ _id: misir._id }, { $set: { image: '/images/foods/misir-wot.webp', imageAlt: 'Misir wot red-lentil stew in a pot', 'translations.am.imageAlt': 'በድስት ውስጥ የተዘጋጀ ምስር ወጥ' } }, { timestamps: false });
  const agent = request.agent(app); await signup(agent);
  const food = await database.models.Listing.findById(misir._id);
  await reserve(agent, food, await reservationForm(agent, food)).expect(303);
  const reservations = await database.models.Reservation.find().lean();
  const accounts = await database.models.User.find().select('+passwordHash +needsFoodSupport').lean();
  const others = await database.models.Listing.find({ _id: { $ne: misir._id } }).sort({ slug: 1 }).lean();
  const original = await database.models.Listing.findById(misir._id).lean();
  assert.equal(await updateMisirPhoto(database), 1);
  assert.equal(await updateMisirPhoto(database), 0);
  assert.deepEqual(await database.models.Listing.find({ _id: { $ne: misir._id } }).sort({ slug: 1 }).lean(), others);
  assert.deepEqual(await database.models.Reservation.find().lean(), reservations);
  assert.deepEqual(await database.models.User.find().select('+passwordHash +needsFoodSupport').lean(), accounts);
  const changed = await database.models.Listing.findById(misir._id).lean();
  const current = photos.find(photo => photo.listingId === original.slug);
  assert.equal(changed.image, current.image);
  assert.equal(changed.imageAlt, 'Misir wot lentil stew served on injera');
  assert.equal(changed.translations.am.imageAlt, current.amImageAlt);
  for(const key of ['_id','slug','availablePortions','totalPortions','perAccountLimit','pickupStartsAt','pickupEndsAt','createdAt','updatedAt','name','description','ingredients','allergens']) assert.deepEqual(changed[key],original[key],key);
  for(const language of ['en','am']) {
    const page = await request(app).get('/foods/'+misir.slug).set('Cookie','community.lang='+language).expect(200);
    assert.ok(page.text.includes(current.image));
    assert.ok(page.text.includes(language === 'am' ? current.amImageAlt : current.imageAlt));
    assert.ok(!page.text.includes('stew in a pot'));
    const browse = await request(app).get('/').set('Cookie','community.lang='+language).expect(200);
    assert.ok(browse.text.includes(current.thumbnail));
    const about = await request(app).get('/about').expect(200);
    assert.ok(about.text.includes('Andy Li')); assert.ok(about.text.includes(current.source)); assert.ok(about.text.includes(current.licenseUrl));
  }
  for(const photo of photos.filter(photo => photo.listingId !== misir.slug)) for(const [file,record] of Object.entries(photo.files)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../public/images/foods',file))).digest('hex'), record.sha256);
});

function personalBody(extra = {}) {
  return { name: 'Fictional lentil lunch', description: 'A recording example.', portionSize: 'One sealed cup', ingredients: 'Lentils, onion, oil', allergenStatus: 'unknown', totalPortions: '5', perAccountLimit: '3', pickupStartsAt: require('../src/lib/chicago-time').chicagoInput(new Date(Date.now() - 3600000)), pickupEndsAt: require('../src/lib/chicago-time').chicagoInput(new Date(Date.now() + 7200000)), pickupLocation: 'Fictional demo table', pickupInstructions: 'Show your code. No real pickup.', status: 'open', confirm: 'post', ...extra };
}
async function postPersonal(agent, extra = {}, photo = true) {
  const csrf = await token(agent, '/profile');
  const buffer = photo && await sharp({ create: { width: 12, height: 12, channels: 3, background: 'green' } }).png().toBuffer();
  const form = agent.post('/share-food/listings');
  for (const [key, value] of Object.entries({ _csrf: csrf, ...personalBody(extra) })) form.field(key, value);
  if (photo) form.attach('foodPhoto', buffer, 'untrusted.png');
  return form;
}
test('one public account can post and receive; owners cannot self-reserve, forge ownership, or manage another listing/pickup', async () => {
  const a = request.agent(app), b = request.agent(app), outsider = request.agent(app);
  const accountA = await signup(a), accountB = await signup(b); await signup(outsider);
  assert.equal((await postPersonal(a, { owner: String(accountB.user._id), organizationId: String(accountB.user._id) })).status, 303);
  const first = await database.models.Listing.findOne({ owner: accountA.user._id });
  assert.ok(first); assert.equal(first.organizationId, undefined); assert.equal(first.eventId, undefined); assert.equal(first.isDemo, false);
  assert.equal(first.allergens, null); assert.equal(first.totalPortions, 5); assert.equal(first.availablePortions, 5);
  await a.get('/share-food').expect(200); await a.get(`/share-food/listings/${first._id}/edit`).expect(200);
  await a.post(`/foods/${first.slug}/reserve`).type('form').send({ _csrf: accountA.csrf, requestKey: randomUUID(), quantity: '1', confirm: 'reserve' }).expect(403);
  await b.get(`/share-food/listings/${first._id}/edit`).expect(404);
  await b.post(`/share-food/listings/${first._id}`).type('form').send({ _csrf: accountB.csrf, ...personalBody({ revision: '0' }), owner: String(accountB.user._id) }).expect(404);
  await b.post(`/share-food/listings/${first._id}/pause`).type('form').send({ _csrf: accountB.csrf, action: 'pause' }).expect(404);
  const saved = await reserve(b, first, await reservationForm(b, first)).expect(303);
  const row = await database.models.Reservation.findOne({ listing: first._id });
  await a.get(saved.headers.location).expect(404);
  await a.post(`${saved.headers.location}/cancel`).type('form').send({ _csrf: accountA.csrf }).expect(404);
  await outsider.get(`/share-food/pickups/${row._id}`).expect(404);
  const outsiderCsrf = await token(outsider, '/profile');
  await outsider.post(`/share-food/pickups/${row._id}/confirm`).type('form').send({ _csrf: outsiderCsrf, confirm: 'collected' }).expect(404);
  await b.get(`/share-food/pickups/${row._id}`).expect(404);
  await a.get(`/share-food/pickups/${row._id}`).expect(200);
  assert.equal((await postPersonal(b)).status, 303);
  const second = await database.models.Listing.findOne({ owner: accountB.user._id });
  await reserve(a, second, await reservationForm(a, second)).expect(303);
  assert.equal(await remaining(first), 4); assert.equal(await remaining(second), 4);
  const responses = await Promise.all(Array.from({ length: 5 }, () => a.post(`/share-food/pickups/${row._id}/confirm`).type('form').send({ _csrf: accountA.csrf, confirm: 'collected' })));
  assert.equal(responses.filter(result => result.status === 303).length, 1);
  assert.equal(responses.filter(result => result.status === 409).length, 4);
  assert.equal(await remaining(first), 4);
  assert.equal(String((await database.models.Reservation.findById(row._id)).collectedBy), String(accountA.user._id));
  await b.post(`${saved.headers.location}/cancel`).type('form').send({ _csrf: accountB.csrf }).expect(409);
});

test('posting/reserving requires login and explicit confirmation; signup returns to the intended page without writing food', async () => {
  const guest = request.agent(app), food = await listing();
  const _csrf = await token(guest);
  await guest.post('/share-food/listings').type('form').send({ _csrf, ...personalBody() }).expect(303).expect('Location', '/login?next=%2Fshare-food');
  const multipart = await postPersonal(guest);
  assert.equal(multipart.status, 303);
  await reserve(guest, food, { _csrf, requestKey: randomUUID(), quantity: '1' }).expect(303);
  assert.equal(await database.models.Reservation.countDocuments(), 0);
  assert.equal(await database.models.Listing.countDocuments(), 1);
  await signup(guest, 'intended@example.test', { next: '/share-food/listings/new', role: 'organizer', organizationId: '000000000000000000000001' });
  await guest.get('/share-food/listings/new').expect(200);
  assert.equal(await database.models.Membership.countDocuments(), 0);
  assert.equal((await postPersonal(guest, { confirm: '' })).status, 422);
  assert.equal((await postPersonal(guest, {}, false)).status, 422);
  const form = await reservationForm(guest, food);
  await reserve(guest, food, { ...form, confirm: '' }).expect(422);
  assert.equal(await remaining(food), 8);
  assert.equal(await database.models.Reservation.countDocuments(), 0);
  // Invalid return paths cannot become external redirects or mutation routes.
  const { safeNext } = require('../src/middleware/security');
  for (const value of ['//evil.test', '/\\evil.test', '/foods/a/reserve', '/share-food/listings', '/%2f%2fevil.test']) assert.equal(safeNext(value), '/');
  assert.equal(safeNext('/share-food/listings/new'), '/share-food/listings/new');
});

test('personal pause, inventory edits and concurrent cancellation preserve commitments and photos', async () => {
  const owner = request.agent(app), receiver = request.agent(app);
  const a = await signup(owner); await signup(receiver);
  assert.equal((await postPersonal(owner)).status, 303);
  let food = await database.models.Listing.findOne({ owner: a.user._id });
  const form = { ...await reservationForm(receiver, food), quantity: '2' };
  const saved = await reserve(receiver, food, form).expect(303);
  await owner.post(`/share-food/listings/${food._id}/pause`).type('form').send({ _csrf: a.csrf, action: 'pause' }).expect(303);
  const other = request.agent(app); await signup(other);
  await reserve(other, food, { _csrf: await token(other, '/profile'), requestKey: randomUUID(), quantity: '1' }).expect(410);
  food = await database.models.Listing.findById(food._id);
  const image = food.image;
  const url = `/share-food/listings/${food._id}`;
  await owner.post(url).type('form').send({ _csrf: a.csrf, ...personalBody({ revision: '0' }) }).expect(409);
  await owner.post(url).type('form').send({ _csrf: a.csrf, ...personalBody({ revision: String(food.revision), totalPortions: '1' }) }).expect(422);
  await owner.post(url).type('form').send({ _csrf: a.csrf, ...personalBody({ revision: String(food.revision), totalPortions: '7' }) }).expect(303);
  assert.equal(await remaining(food), 5);
  const results = await Promise.all(Array.from({ length: 5 }, () => receiver.post(`${saved.headers.location}/cancel`).type('form').send({ _csrf: form._csrf })));
  assert.ok(results.every(result => result.status === 303));
  assert.equal(await remaining(food), 7);
  assert.equal((await database.models.Listing.findById(food._id)).image, image);
  await reserve(receiver, food, form).expect(303); assert.equal(await remaining(food), 7);
  // Legacy organization linking must leave personal listings/reservations alone.
  await require('../src/services/development').migrateOrganizations(database);
  assert.equal((await database.models.Listing.findById(food._id)).organizationId, undefined);
  assert.equal((await database.models.Reservation.findOne()).organizationId, undefined);
});

test('recording preparation updates only fictional sample windows and adds stock without changing commitments/history', async () => {
  const { prepareRecording, recordingWindow } = require('../scripts/prepare-recording');
  await seedDemo(database.models);
  const agent = request.agent(app); await signup(agent);
  const food = await database.models.Listing.findOne({ slug: sampleFoods[0].id });
  await reserve(agent, food, { ...await reservationForm(agent, food), quantity: '2' }).expect(303);
  const unrelated = await listing({ isDemo: false });
  const oldUnrelated = await database.models.Listing.findById(unrelated._id).lean();
  const before = await database.models.Listing.findById(food._id).lean();
  const history = await database.models.Reservation.find().lean(), users = await database.models.User.find().select('+passwordHash').lean();
  const now = new Date('2026-10-25T18:00:00Z');
  const result = await prepareRecording(database, { now });
  assert.equal(result.changes.find(row => row.slug === food.slug).addedPortions, 2);
  const updated = await database.models.Listing.findById(food._id);
  assert.equal(updated.totalPortions, before.totalPortions + 2); assert.equal(updated.availablePortions, before.availablePortions + 2);
  assert.equal(updated.totalPortions - updated.availablePortions, 2);
  assert.equal(updated.image, before.image); assert.equal(String(updated._id), String(before._id));
  assert.equal(updated.pickupStartsAt.toISOString(), '2026-10-25T05:00:00.000Z');
  assert.equal(updated.pickupEndsAt.toISOString(), '2026-10-27T04:59:00.000Z');
  assert.ok((await prepareRecording(database, { now })).changes.every(row => row.addedPortions === 0));
  assert.deepEqual(await database.models.Reservation.find().lean(), history);
  assert.deepEqual(await database.models.User.find().select('+passwordHash').lean(), users);
  assert.deepEqual(await database.models.Listing.findById(unrelated._id).lean(), oldUnrelated);
  const dst = recordingWindow(new Date('2026-11-01T18:00:00Z'));
  assert.equal(dst.pickupStartsAt.toISOString(), '2026-11-01T05:00:00.000Z');
  assert.equal(dst.pickupEndsAt.toISOString(), '2026-11-03T05:59:00.000Z');
});
