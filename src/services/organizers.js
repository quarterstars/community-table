const { authorizeOrganizer } = require('./accounts');
const { randomUUID } = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { parseChicagoTime } = require('../lib/chicago-time');
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
function text(body, key, maximum, required = true) {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if ((required && !value) || value.length > maximum) throw new HttpError(422, `Enter a valid ${key.replaceAll(/([A-Z])/g, ' $1').toLowerCase()} (${maximum} characters maximum).`);
  return value;
}
function number(body, key, min = 1) {
  if (typeof body[key] !== 'string' || !/^\d+$/.test(body[key]) || !Number.isSafeInteger(Number(body[key])) || Number(body[key]) < min || Number(body[key]) > 1000000) throw new HttpError(422, `Enter a whole ${key} between ${min} and 1000000.`);
  return Number(body[key]);
}
function eventFields(body) {
  const pickupStartsAt = parseChicagoTime(body.pickupStartsAt), pickupEndsAt = parseChicagoTime(body.pickupEndsAt);
  if (pickupEndsAt <= pickupStartsAt || pickupEndsAt <= new Date()) throw new HttpError(422, 'Pickup must end after it starts and in the future.');
  if (!['open', 'paused', 'closed'].includes(body.status)) throw new HttpError(422, 'Choose an open, paused, or closed status.');
  return { title: text(body, 'title', 150), description: text(body, 'description', 2000, false), pickupStartsAt, pickupEndsAt, pickupLocation: text(body, 'pickupLocation', 300), pickupInstructions: text(body, 'pickupInstructions', 3000), status: body.status };
}
function listingFields(body) {
  const fields = eventFields({ ...body, title: body.name });
  delete fields.title;
  if (!validId(body.eventId)) throw new HttpError(422, 'Choose an event belonging to this organization.');
  if (!['unknown', 'reported'].includes(body.allergenStatus)) throw new HttpError(422, 'Specify whether allergen information is unknown or reported.');
  const ingredients = text(body, 'ingredients', 2000, false).split(String(body.ingredients || '').includes('\n') ? /\n/ : /[,፣]/).map(value => value.trim()).filter(Boolean);
  return { ...fields, eventId: body.eventId.toLowerCase(), name: text(body, 'name', 150), description: text(body, 'description', 2000), portionSize: text(body, 'portionSize', 300), ingredients, allergens: body.allergenStatus === 'reported' ? text(body, 'allergens', 2000) : null, totalPortions: number(body, 'totalPortions'), perAccountLimit: number(body, 'perAccountLimit') };
}

function createOrganizerService({ connection, models }) {
  const { Organization, Membership, Event, Listing, Reservation, User } = models;
  async function authorize(actor, roles, session) {
    return authorizeOrganizer({ connection, models }, actor, roles, session);
  }
  async function saveEvent(actor, body, id) {
    const fields = eventFields(body);
    return connection.transaction(async session => {
      await authorize(actor, ['admin'], session);
      if (!id) return (await Event.create([{ ...fields, organization: actor.organizationId }], { session }))[0].toObject();
      const event = await Event.findOne({ _id: id, organization: actor.organizationId }).session(session).lean();
      if (!event) throw new HttpError(404, 'Event not found.');
      if (number(body, 'revision', 0) !== event.revision) throw new HttpError(409, 'This event changed. Reload it before editing.');
      const outside = await Listing.exists({ eventId: id, organizationId: actor.organizationId, $or: [{ pickupStartsAt: { $lt: fields.pickupStartsAt } }, { pickupEndsAt: { $gt: fields.pickupEndsAt } }] }).session(session);
      if (outside) throw new HttpError(422, 'The event window must include its existing listing windows. Edit those listings first.');
      return Event.findOneAndUpdate({ _id: id, organization: actor.organizationId, revision: event.revision }, { $set: fields, $inc: { revision: 1 } }, { session, new: true }).lean();
    }, transactionOptions);
  }
  async function saveListing(actor, body, id, photo = null) {
    const fields = listingFields(body);
    const amFields = [['name', 'amName', 150], ['description', 'amDescription', 2000], ['portionSize', 'amPortionSize', 300], ['ingredients', 'amIngredients', 2000], ['allergens', 'amAllergens', 2000], ['pickupLocation', 'amPickupLocation', 300], ['pickupInstructions', 'amPickupInstructions', 3000]];
    const suppliedAmharic = amFields.some(([, key]) => Object.hasOwn(body, key));
    function translatedFields(listing = null) {
      if (suppliedAmharic) {
        const am = { ...listing?.translations?.am };
        for (const [field, key, max] of amFields) am[field] = text(body, key, max, false);
        am.ingredients = fields.ingredients.length ? am.ingredients.split(am.ingredients.includes('\n') ? /\n/ : /[,፣]/).map(value => value.trim()).filter(Boolean) : [];
        if (!fields.allergens) am.allergens = '';
        if (photo) am.imageAlt = '';
        return { translations: { am } };
      }
      if (listing && amFields.some(([field]) => JSON.stringify(listing[field]) !== JSON.stringify(fields[field]))) return null;
      return photo && listing?.translations ? { translations: { am: { ...listing.translations.am, imageAlt: '' } } } : {};
    }
    return connection.transaction(async session => {
      await authorize(actor, ['admin'], session);
      const event = await Event.findOneAndUpdate({ _id: fields.eventId, organization: actor.organizationId }, { $inc: { revision: 1 } }, { session, new: true }).lean();
      if (!event) throw new HttpError(404, 'Event not found in this organization.');
      if (fields.pickupStartsAt < event.pickupStartsAt || fields.pickupEndsAt > event.pickupEndsAt) throw new HttpError(422, 'The listing pickup window must fit inside its event window.');
      const organization = await Organization.findById(actor.organizationId).session(session).lean();
      if (!organization) throw new HttpError(404, 'Organization not found.');
      if (!id) {
        return (await Listing.create([{ ...fields, ...translatedFields(), organization: organization.name, organizationId: organization._id, availablePortions: fields.totalPortions, slug: `food-${randomUUID()}`, image: '/images/food-placeholder.svg', imageAlt: 'Neutral food placeholder; no photograph is available', imageType: 'placeholder', ...(photo || {}), isDemo: organization.isDemo }], { session }))[0].toObject();
      }
      const listing = await Listing.findOne({ _id: id, organizationId: actor.organizationId }).session(session).lean();
      if (!listing) throw new HttpError(404, 'Listing not found.');
      if (number(body, 'revision', 0) !== (listing.revision || 0)) throw new HttpError(409, 'Inventory or listing details changed. Reload before editing.');
      const committed = listing.totalPortions - listing.availablePortions;
      if (fields.totalPortions < committed) throw new HttpError(422, `Quantity cannot be below ${committed} reserved, collected, or missed portions.`);
      if (committed && String(listing.eventId) !== fields.eventId) throw new HttpError(422, 'A listing with committed portions cannot move to another event.');
      const perAccount = await Reservation.aggregate([{ $match: { listing: listing._id, status: { $in: ['active', 'collected', 'missed'] } } }, { $group: { _id: '$user', portions: { $sum: '$quantity' } } }, { $match: { portions: { $gt: fields.perAccountLimit } } }]).session(session);
      if (perAccount.length) throw new HttpError(422, 'The per-account limit cannot be below an existing account’s committed portions.');
      const translation = translatedFields(listing);
      return Listing.findOneAndUpdate({ _id: id, organizationId: actor.organizationId, revision: listing.revision || 0 }, { ...(translation === null ? { $unset: { translations: 1 } } : {}), $set: { ...fields, ...(translation || {}), ...(photo || {}), availablePortions: fields.totalPortions - committed }, $inc: { revision: 1 } }, { session, new: true }).lean();
    }, transactionOptions);
  }
  async function setPaused(actor, id, kind, paused) {
    return connection.transaction(async session => {
      await authorize(actor, ['admin'], session);
      const Model = kind === 'event' ? Event : Listing;
      const scope = kind === 'event' ? { organization: actor.organizationId } : { organizationId: actor.organizationId };
      const updated = await Model.findOneAndUpdate({ _id: id, ...scope }, { $set: { status: paused ? 'paused' : 'open' }, $inc: { revision: 1 } }, { session, new: true }).lean();
      if (!updated) throw new HttpError(404, 'Event or listing not found.');
      return updated;
    }, transactionOptions);
  }
  async function changeVolunteer(actor, selected, operation) {
    return connection.transaction(async session => {
      await authorize(actor, ['admin'], session);
      const user = await User.findOne({ _id: selected.userId, email: selected.email }).session(session).lean();
      if (!user) throw new HttpError(404, 'The selected registered account no longer exists.');
      if (user.role !== 'organizer') throw new HttpError(409, 'Only organizer accounts can become volunteers. Use a separate organizer account with a different email.');
      await User.updateOne({ _id: user._id, role: 'organizer' }, { $inc: { accessVersion: 1 } }, { session });
      const member = await Membership.findOne({ organization: actor.organizationId, user: user._id }).session(session).lean();
      if (member?.role === 'admin') throw new HttpError(409, 'Volunteer management cannot change an administrator’s access.');
      if (operation === 'remove') {
        if (!member) throw new HttpError(404, 'That account is not a volunteer for this organization.');
        await Membership.deleteOne({ _id: member._id, role: 'volunteer' }, { session });
      } else if (operation === 'add') {
        if (!member) await Membership.create([{ organization: actor.organizationId, user: user._id, role: 'volunteer' }], { session });
      } else throw new HttpError(422, 'Choose add or remove.');
    }, transactionOptions);
  }
  async function confirmPickup(actor, id) {
    return connection.transaction(async session => {
      await authorize(actor, ['admin', 'volunteer'], session);
      const reservation = await Reservation.findOne({ _id: id, organizationId: actor.organizationId }).session(session).lean();
      if (!reservation) throw new HttpError(404, 'Reservation not found in this organization.');
      const now = new Date();
      if (reservation.status === 'collected') throw new HttpError(409, 'This reservation has already been collected.');
      if (reservation.status === 'cancelled') throw new HttpError(410, 'Cancelled reservations cannot be collected.');
      if (reservation.status === 'missed' || reservation.pickupEndsAt <= now) throw new HttpError(410, 'The pickup window was missed. Collection cannot be confirmed.');
      if (reservation.pickupStartsAt > now) throw new HttpError(409, 'The pickup window has not started.');
      // Lock the listing for inventory editors; collection never decrements inventory.
      const listing = await Listing.updateOne({ _id: reservation.listing, organizationId: actor.organizationId }, { $inc: { revision: 1 } }, { session });
      if (listing.matchedCount !== 1) throw new HttpError(409, 'The reservation’s listing is unavailable. Collection was not saved.');
      const saved = await Reservation.findOneAndUpdate({ _id: id, organizationId: actor.organizationId, status: 'active', pickupStartsAt: { $lte: now }, pickupEndsAt: { $gt: now } }, { $set: { status: 'collected', collectedAt: now, collectedBy: actor.userId } }, { session, new: true }).lean();
      if (!saved) throw new HttpError(409, 'The reservation changed. Reload before confirming.');
      return saved;
    }, transactionOptions);
  }
  return { saveEvent, saveListing, setPaused, changeVolunteer, confirmPickup };
}
module.exports = { createOrganizerService, validId };
