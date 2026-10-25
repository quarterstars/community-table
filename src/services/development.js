const { createHash } = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { hashPassword } = require('../lib/passwords');
const { accountFields, emailValue } = require('./accounts');
const slugFor = name => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 80) || `demo-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };

async function grantDevelopmentAdmin(database, { email, password, accountName = 'Demo Organizer', slug = 'community-table-demo-kitchen', name = 'Community Table Demo Kitchen', production = false }) {
  if (production) throw new HttpError(403, 'Development organizer setup is disabled in production.');
  email = emailValue(email);
  if (!email || !/^[a-z0-9-]{1,100}$/.test(slug) || typeof name !== 'string' || !name.trim() || name.length > 150) throw new HttpError(422, 'Supply a valid account email and fictional organization name/slug.');
  const { User, Organization, Membership, Reservation } = database.models;
  const existing = await User.findOne({ email }).lean();
  let passwordHash;
  if (!existing) { accountFields(accountName, password); passwordHash = await hashPassword(password); }
  try {
    return await database.connection.transaction(async session => {
      let user = await User.findOneAndUpdate({ email }, { $inc: { accessVersion: 1 } }, { session, new: true }).lean();
      if (!user) {
        if (await User.exists({ email }).session(session)) throw new HttpError(409, 'This email was registered concurrently. Run setup again.');
        if (!passwordHash) throw new HttpError(409, 'Account changed. Run setup again.');
        [user] = await User.create([{ name: accountName.trim(), email, passwordHash, role: 'member' }], { session });
      }
      const organization = await Organization.findOneAndUpdate({ slug }, { $setOnInsert: { slug, name: name.trim(), isDemo: true } }, { upsert: true, new: true, session }).lean();
      if (!organization.isDemo) throw new HttpError(403, 'Development setup only grants access to a fictional demo organization.');
      await Membership.updateOne({ organization: organization._id, user: user._id }, { $set: { role: 'admin', accessGranted: true }, $inc: { actionVersion: 1 } }, { upsert: true, session });
      return organization;
    }, transactionOptions);
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, 'This email was registered concurrently. Run setup again.');
    throw error;
  }
}

async function migrateOrganizations(database) {
  const { Organization, Event, Listing, Reservation } = database.models;
  const ids = await Listing.find({ owner: null, $or: [{ organizationId: null }, { eventId: null }, { revision: { $exists: false } }] }).select('_id').lean();
  let linkedListings = 0, linkedReservations = 0;
  for (const row of ids) {
    const result = await database.connection.transaction(async session => {
      const listing = await Listing.findById(row._id).session(session).lean();
      if (!listing || listing.owner) return { listings: 0, reservations: 0 };
      let organization = listing.organizationId ? await Organization.findById(listing.organizationId).session(session).lean() : null;
      if (listing.organizationId && !organization) throw new Error('An existing listing organization relationship is invalid. Migration stopped without resetting data.');
      if (!organization) {
        // Stable demo slugs match development seeding; existing non-demo orgs
        // with similar names are never silently assigned historical listings.
        const slug = slugFor(listing.organization);
        organization = await Organization.findOne({ slug, name: listing.organization, isDemo: true }).session(session).lean();
        if (!organization) {
          const occupied = await Organization.exists({ slug }).session(session);
          const legacySlug = occupied ? `legacy-${createHash('sha256').update(listing.organization).digest('hex').slice(0, 24)}` : slug;
          organization = await Organization.findOneAndUpdate({ slug: legacySlug }, { $setOnInsert: { name: listing.organization, slug: legacySlug, isDemo: true } }, { upsert: true, new: true, session }).lean();
        }
      }
      let event = listing.eventId ? await Event.findOne({ _id: listing.eventId, organization: organization._id }).session(session).lean() : null;
      if (listing.eventId && !event) throw new Error('An existing listing event relationship is invalid. Migration stopped without resetting data.');
      if (!event) {
        event = await Event.findOneAndUpdate({ legacyListing: listing._id }, { $setOnInsert: {
          organization: organization._id, title: `${listing.name.slice(0, 130)} pickup`,
          // New event boundaries include the original second-precision windows.
          // Original listing and reservation dates are not changed.
          pickupStartsAt: new Date(Math.floor(listing.pickupStartsAt.getTime() / 60000) * 60000),
          pickupEndsAt: new Date(Math.ceil(listing.pickupEndsAt.getTime() / 60000) * 60000),
          pickupLocation: listing.pickupLocation, pickupInstructions: listing.pickupInstructions,
          status: listing.status, revision: 0
        } }, { upsert: true, new: true, session }).lean();
      }
      await Listing.updateOne({ _id: listing._id }, { $set: { organizationId: organization._id, eventId: event._id, revision: listing.revision || 0 } }, { session, timestamps: false });
      const reservations = await Reservation.updateMany({ listing: listing._id, organizationId: null }, { $set: { organizationId: organization._id } }, { session, timestamps: false });
      return { listings: 1, reservations: reservations.modifiedCount };
    }, transactionOptions);
    linkedListings += result.listings; linkedReservations += result.reservations;
  }
  // Also cover reservations from already-linked listings after a partial run.
  for (const row of await Reservation.find({ organizationId: null }).select('listing').lean()) {
    const listing = await Listing.findById(row.listing).select('organizationId owner').lean();
    if (listing?.owner) continue;
    if (!listing?.organizationId) throw new Error('A historical reservation has no linked listing. No reservation was deleted.');
    const result = await Reservation.updateOne({ _id: row._id, organizationId: null }, { $set: { organizationId: listing.organizationId } }, { timestamps: false });
    linkedReservations += result.modifiedCount;
  }
  return { linkedListings, linkedReservations };
}
module.exports = { grantDevelopmentAdmin, migrateOrganizations, slugFor };
