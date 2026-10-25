const { randomBytes } = require('node:crypto');
const { HttpError } = require('../lib/errors');
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
const validKey = (key) => typeof key === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key);

function parseQuantity(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new HttpError(422, 'Choose a positive whole number of portions.');
  }
  return Number(value);
}
function replay(existing, listingSlug, quantity) {
  if (existing.listingSlug !== listingSlug || existing.quantity !== quantity) {
    throw new HttpError(409, 'This request was already used for a different reservation. Reload the food details.');
  }
  // Cancelled records remain idempotent: an old form never recreates a cancellation.
  return existing;
}

function createReservationService({ connection, models }) {
  const { Listing, Reservation, Event, User } = models;
  async function requireUser(userId, session) {
    const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { accessVersion: 1 } }, { session, new: true }).lean();
    if (!user) throw new HttpError(403, 'Log in to reserve.');
    return user;
  }
  async function reserve({ userId, listingSlug, quantity, requestKey }) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new HttpError(422, 'Choose a positive whole number of portions.');
    if (!validKey(requestKey)) throw new HttpError(422, 'Reload the food details before reserving.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const pickupCode = randomBytes(16).toString('hex').toUpperCase();
      try {
        return await connection.transaction(async (session) => {
          await requireUser(userId, session);
          const existing = await Reservation.findOne({ user: userId, requestKey }).session(session).lean();
          if (existing) return replay(existing, listingSlug, quantity);
          const listing = await Listing.findOne({ slug: listingSlug }).session(session).lean();
          if (!listing) throw new HttpError(404, 'That food listing could not be found.');
          if (String(listing.owner) === String(userId)) throw new HttpError(403, 'You cannot reserve your own listing.');
          const now = new Date();
          if (listing.status !== 'open' || listing.pickupEndsAt <= now) throw new HttpError(410, 'This listing is paused, closed, or its pickup window has ended.');
          // Detect an active duplicate before the lifetime portion limit. Previously
          // 2 existing + 2 requested exceeded limit 3 and incorrectly returned 422.
          if (await Reservation.exists({ user: userId, listing: listing._id, status: 'active' }).session(session)) throw new HttpError(409, 'You already have a reservation for this listing. Check My Pickups.');
          const commitments = await Reservation.find({ user: userId, listing: listing._id, status: { $in: ['active', 'collected', 'missed'] } }).select('quantity').session(session).lean();
          const committedQuantity = commitments.reduce((sum, row) => sum + row.quantity, 0);
          if (quantity + committedQuantity > listing.perAccountLimit) throw new HttpError(422, `The limit for this listing is ${listing.perAccountLimit} portions per account.`);
          if (listing.eventId) {
            // Writing the event makes a concurrent pause conflict and retry.
            const event = await Event.findOneAndUpdate({ _id: listing.eventId, organization: listing.organizationId, status: 'open', pickupEndsAt: { $gt: now } }, { $inc: { revision: 1 } }, { session, new: true }).lean();
            if (!event) throw new HttpError(410, 'This event is paused, closed, or its pickup window has ended.');
          }
          // MongoDB checks inventory at the write in the same transaction as the
          // reservation. Its transaction retry handles concurrent write conflicts.
          const updated = await Listing.findOneAndUpdate({
            _id: listing._id, status: 'open', pickupEndsAt: { $gt: now },
            availablePortions: { $gte: quantity }, perAccountLimit: { $gte: quantity }
          }, { $inc: { availablePortions: -quantity, revision: 1 } }, { session, new: true }).lean();
          if (!updated) throw new HttpError(409, 'That quantity is no longer available. Reload the listing and choose again.');
          const [saved] = await Reservation.create([{
            user: userId, listing: listing._id, organizationId: listing.organizationId, listingSlug, requestKey, quantity, pickupCode,
            pickupStartsAt: listing.pickupStartsAt, pickupEndsAt: listing.pickupEndsAt,
            food: {
              name: listing.name, organization: listing.organization,
              image: listing.image, imageAlt: listing.imageAlt, imageType: listing.imageType,
              translations: listing.translations,
              portionSize: listing.portionSize,
              pickupLocation: listing.pickupLocation, pickupInstructions: listing.pickupInstructions
            }
          }], { session });
          return saved.toObject();
        }, transactionOptions);
      } catch (error) {
        if (error.code !== 11000) throw error;
        // Unique-key races abort the entire transaction, including inventory.
        const existing = await Reservation.findOne({ user: userId, requestKey }).lean();
        if (existing) return replay(existing, listingSlug, quantity);
        if (error.keyPattern?.pickupCode) continue;
        throw new HttpError(409, 'You already have a reservation for this listing. Check My Pickups.');
      }
    }
    throw new HttpError(503, 'Could not generate a pickup code. Please try again.');
  }

  async function cancel({ userId, reservationId }) {
    if (!/^[a-f0-9]{24}$/i.test(reservationId)) throw new HttpError(404, 'Reservation not found.');
    return connection.transaction(async (session) => {
      await requireUser(userId, session);
      const reservation = await Reservation.findOne({ _id: reservationId, user: userId }).session(session).lean();
      if (!reservation) throw new HttpError(404, 'Reservation not found.');
      if (reservation.status === 'cancelled') return reservation;
      if (reservation.status === 'collected') throw new HttpError(409, 'Collected reservations cannot be cancelled.');
      if (reservation.status === 'missed') throw new HttpError(410, 'Missed reservations cannot be cancelled.');
      const now = new Date();
      if (reservation.pickupEndsAt <= now) throw new HttpError(410, 'The pickup deadline has passed; this reservation can no longer be cancelled.');
      const cancelled = await Reservation.findOneAndUpdate({
        _id: reservationId, user: userId, status: 'active', pickupEndsAt: { $gt: now }
      }, { $set: { status: 'cancelled', cancelledAt: now } }, { session, new: true }).lean();
      if (!cancelled) throw new HttpError(409, 'The reservation changed. Reload My Pickups.');
      const restored = await Listing.updateOne({
        _id: reservation.listing,
        $expr: { $lte: [{ $add: ['$availablePortions', reservation.quantity] }, '$totalPortions'] }
      }, { $inc: { availablePortions: reservation.quantity, revision: 1 } }, { session });
      if (restored.matchedCount !== 1) throw new HttpError(409, 'Inventory could not be restored. The cancellation was not saved.');
      return cancelled;
    }, transactionOptions);
  }
  return { reserve, cancel };
}
module.exports = { createReservationService, parseQuantity };
