const { randomUUID } = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { listingFields, number, validId } = require('./organizers');
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
const personalScope = userId => ({ owner: userId, organizationId: null, eventId: null });

function createSharingService({ connection, models }) {
  const { User, Listing, Reservation } = models;
  async function authorize(userId, session) {
    const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { accessVersion: 1 } }, { session, new: true }).lean();
    if (!user) throw new HttpError(403, 'Log in to share.');
    return user;
  }
  async function save(userId, body, id, photo) {
    if (id && !validId(id)) throw new HttpError(404, 'Listing not found.');
    if (!id && body.confirm !== 'post') throw new HttpError(422, 'Confirm your food listing before posting.');
    const fields = listingFields(body, true);
    return connection.transaction(async session => {
      const user = await authorize(userId, session);
      if (!id) {
        if (!photo) throw new HttpError(422, 'Add a photo before posting food.');
        return (await Listing.create([{ ...fields, ...photo, owner: user._id, organization: user.name, slug: `food-${randomUUID()}`, availablePortions: fields.totalPortions, isDemo: false }], { session }))[0].toObject();
      }
      const listing = await Listing.findOne({ _id: id, ...personalScope(userId) }).session(session).lean();
      if (!listing) throw new HttpError(404, 'Listing not found.');
      if (number(body, 'revision', 0) !== listing.revision) throw new HttpError(409, 'Inventory or listing details changed. Reload before editing.');
      const committed = listing.totalPortions - listing.availablePortions;
      if (fields.totalPortions < committed) throw new HttpError(422, `Quantity cannot be below ${committed} reserved, collected, or missed portions.`);
      const excessive = await Reservation.aggregate([{ $match: { listing: listing._id, status: { $in: ['active', 'collected', 'missed'] } } }, { $group: { _id: '$user', portions: { $sum: '$quantity' } } }, { $match: { portions: { $gt: fields.perAccountLimit } } }]).session(session);
      if (excessive.length) throw new HttpError(422, 'The per-account limit cannot be below an existing account’s committed portions.');
      const textChanged = ['name', 'description', 'portionSize', 'ingredients', 'allergens', 'pickupLocation', 'pickupInstructions'].some(key => JSON.stringify(fields[key]) !== JSON.stringify(listing[key]));
      return Listing.findOneAndUpdate({ _id: id, ...personalScope(userId), revision: listing.revision }, { $set: { ...fields, ...(photo || {}), availablePortions: fields.totalPortions - committed }, ...(textChanged ? { $unset: { translations: 1 } } : {}), $inc: { revision: 1 } }, { session, new: true }).lean();
    }, transactionOptions);
  }
  async function pause(userId, id, paused) {
    if (!validId(id)) throw new HttpError(404, 'Listing not found.');
    return connection.transaction(async session => {
      await authorize(userId, session);
      const listing = await Listing.findOneAndUpdate({ _id: id, ...personalScope(userId) }, { $set: { status: paused ? 'paused' : 'open' }, $inc: { revision: 1 } }, { session, new: true }).lean();
      if (!listing) throw new HttpError(404, 'Listing not found.');
      return listing;
    }, transactionOptions);
  }
  async function confirm(userId, id) {
    if (!validId(id)) throw new HttpError(404, 'Reservation not found.');
    return connection.transaction(async session => {
      await authorize(userId, session);
      const row = await Reservation.findById(id).session(session).lean();
      const listing = row && await Listing.findOneAndUpdate({ _id: row.listing, ...personalScope(userId) }, { $inc: { revision: 1 } }, { session, new: true }).lean();
      if (!listing) throw new HttpError(404, 'Reservation not found.');
      const now = new Date();
      if (row.status === 'collected') throw new HttpError(409, 'This reservation has already been collected.');
      if (row.status !== 'active' || row.pickupEndsAt <= now) throw new HttpError(410, 'The pickup window was missed or the reservation is no longer active.');
      if (row.pickupStartsAt > now) throw new HttpError(409, 'The pickup window has not started.');
      const saved = await Reservation.findOneAndUpdate({ _id: id, status: 'active', listing: listing._id, pickupStartsAt: { $lte: now }, pickupEndsAt: { $gt: now } }, { $set: { status: 'collected', collectedAt: now, collectedBy: userId } }, { session, new: true }).lean();
      if (!saved) throw new HttpError(409, 'The reservation changed. Reload before confirming.');
      return saved;
    }, transactionOptions);
  }
  return { save, pause, confirm };
}
module.exports = { createSharingService, personalScope };
