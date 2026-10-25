const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { presentReservation } = require('../src/lib/presentation');
const { translator } = require('../src/lib/i18n');

function reservation(status = 'active', extra = {}) {
  return { _id: '0123456789abcdef01234567', quantity: 2, status,
    pickupStartsAt: new Date(Date.now() - 3600000), pickupEndsAt: new Date(Date.now() + 3600000),
    pickupCode: 'PRIVATE-PICKUP-CODE', cancelledAt: status === 'cancelled' ? new Date() : undefined,
    food: { name: 'Lentil lunch', organization: 'Demo kitchen', pickupLocation: 'Saved fictional address', pickupInstructions: 'Show your code and collect this food.', translations: { am: { name: 'የምስር ምሳ', organization: 'የምሳሌ ወጥ ቤት', pickupLocation: 'የተቀመጠ የምሳሌ አድራሻ', pickupInstructions: 'ኮድዎን ያሳዩና ምግቡን ይውሰዱ።' } } }, ...extra };
}
function render(view, data, language = 'en') {
  return ejs.renderFile(path.join(__dirname, '../views', `${view}.ejs`), {
    title: 'My Pickups', activePage: 'pickups', currentUser: { name: 'Demo account' }, memberships: [],
    csrfToken: 'a'.repeat(64), reservationsReady: true, lang: language, t: translator(language),
    formattedDate: value => new Intl.DateTimeFormat(language === 'am' ? 'am-ET' : 'en-US', { calendar: 'gregory', timeZone: 'America/Chicago', dateStyle: 'medium' }).format(new Date(value)), ...data
  });
}
const main = html => html.match(/<main\b[\s\S]*?<\/main>/)[0];

test('pickup overview keeps active cards compact and all past states in a collapsed, labelled history in both languages', async () => {
  const originals = [reservation(), reservation('cancelled'), reservation('collected'), reservation('active', { pickupStartsAt: new Date(Date.now() - 7200000), pickupEndsAt: new Date(Date.now() - 1000) }), reservation('missed')];
  const before = structuredClone(originals);
  for (const language of ['en', 'am']) {
    const t = translator(language);
    const rows = originals.map(row => presentReservation(row, language));
    const html = main(await render('my-pickups', { reservations: rows }, language));
    const [upcoming, history] = html.split('<details class="pickup-history">');
    assert.ok(history, 'Uses native details/summary without an open attribute');
    assert.equal((upcoming.match(/class="pickup-card pickup-summary"/g) || []).length, 1);
    assert.equal((upcoming.match(/class="button button-secondary pickup-view"/g) || []).length, 1);
    assert.ok(upcoming.includes(t('View pickup')));
    assert.ok(upcoming.includes('2 ' + t('portions')));
    assert.ok(upcoming.includes(rows[0].food.organization));
    assert.ok(history.includes(t('History ({count})', { count: 4 })));
    for (const status of ['Cancelled', 'Collected', 'Expired', 'Missed']) assert.ok(history.includes(t(status)));
    assert.match(history, /pickup-history-row is-cancelled/);
    assert.equal((history.match(/href="\/reservations\//g) || []).length, 4);
    for (const row of rows) for (const value of [row.pickupCode, row.food.pickupLocation, row.food.pickupInstructions]) assert.ok(!html.includes(value));
    assert.doesNotMatch(html, /cancel-form|returned to the listing/);
    assert.equal((html.match(/America\/Chicago/g) || []).length, 1);
    if (language === 'en') assert.doesNotMatch(html, /[\u1200-\u137f]/);
    else { assert.ok(html.includes('የምስር ምሳ')); assert.ok(!html.includes('Lentil lunch')); }
  }
  assert.deepEqual(originals, before, 'Presentation never rewrites reservation data');
});

test('no upcoming pickups shows Browse followed by history, including an empty history', async () => {
  for (const language of ['en', 'am']) for (const rows of [[], [presentReservation(reservation('cancelled'), language)]]) {
    const html = main(await render('my-pickups', { reservations: rows }, language));
    const t = translator(language);
    assert.ok(html.includes(t('No upcoming pickups')));
    assert.ok(html.includes(t('Browse food')));
    assert.ok(html.indexOf(t('Browse food')) < html.indexOf('<details'));
    assert.ok(html.includes(t('History ({count})', { count: rows.length })));
    assert.doesNotMatch(html, /upcoming-pickups/);
  }
});

test('cancelled details lead with cancellation and retain historical facts without usable codes, collection instructions or actions', async () => {
  for (const language of ['en', 'am']) {
    const t = translator(language), row = presentReservation(reservation('cancelled'), language);
    const html = main(await render('reservation', { reservation: row }, language));
    assert.ok(html.includes(`<h1>${t('Reservation cancelled.')}</h1>`));
    assert.ok(html.includes(row.food.name)); assert.ok(html.includes(row.food.organization));
    assert.ok(html.includes(row.food.pickupLocation));
    for (const key of ['Original pickup:', 'Original location:', 'Cancelled on:', 'Your reservation was cancelled and its portions were returned to the listing. This reservation can no longer be collected.']) assert.ok(html.includes(t(key)));
    assert.ok(!html.includes(row.pickupCode)); assert.ok(!html.includes(row.food.pickupInstructions));
    assert.doesNotMatch(html, /pickup-code|cancel-form|action=".*\/cancel"/);
    assert.equal((html.match(/America\/Chicago/g) || []).length, 1);
    // A missing historical cancellation timestamp must not invent one.
    const old = main(await render('reservation', { reservation: { ...row, cancelledAt: undefined } }, language));
    assert.ok(!old.includes(t('Cancelled on:')));
  }
});

test('active details preserve the saved code, address, instructions and cancellation action', async () => {
  for (const language of ['en', 'am']) {
    const row = presentReservation(reservation(), language);
    const html = main(await render('reservation', { reservation: row }, language));
    for (const value of [row.pickupCode, row.food.pickupLocation, row.food.pickupInstructions]) assert.ok(html.includes(value));
    assert.match(html, /class="cancel-form"/);
    assert.ok(html.includes(`/reservations/${row.id}/cancel`));
  }
});

test('pickup summary dates retain both days and year boundaries, DST offsets, and accurate state precedence', () => {
  for (const language of ['en', 'am']) {
    const crossDay = presentReservation(reservation('collected', { pickupStartsAt: new Date('2026-12-31T22:00:00Z'), pickupEndsAt: new Date('2027-01-01T18:00:00Z') }), language);
    for (const text of [crossDay.pickupSummary, crossDay.pickupHistoryDate]) { assert.match(text, /2026/); assert.match(text, /2027/); assert.match(text, /31/); assert.match(text, /1/); }
    assert.ok(!crossDay.pickupSummary.includes('America/Chicago'));
    const dst = presentReservation(reservation('collected', { pickupStartsAt: new Date('2026-11-01T06:30:00Z'), pickupEndsAt: new Date('2026-11-01T08:30:00Z') }), language);
    if (language === 'en') { assert.match(dst.pickupSummary, /CDT/); assert.match(dst.pickupSummary, /CST/); }
  }
  const past = { pickupStartsAt: new Date(Date.now() - 7200000), pickupEndsAt: new Date(Date.now() - 1000) };
  for (const status of ['cancelled', 'collected', 'missed']) {
    const row = presentReservation(reservation(status, past));
    assert.equal(row.displayStatus, status); assert.equal(row.canCancel, false);
  }
  const expired = presentReservation(reservation('active', past));
  assert.equal(expired.displayStatus, 'missed'); assert.equal(expired.statusLabel, 'Expired'); assert.equal(expired.canCancel, false);
});
