const express = require('express');
const { randomUUID } = require('node:crypto');
const { requireAccountType, csrfProtection } = require('../middleware/security');
const { parseFoodPhoto, saveFoodPhoto } = require('../lib/food-uploads');
const { createInvitationService } = require('../services/accounts');
const { HttpError } = require('../lib/errors');
const { createOrganizerService, validId } = require('../services/organizers');
const { chicagoInput } = require('../lib/chicago-time');
const { presentListing, presentReservation, pickupPresentation } = require('../lib/presentation');

function createOrganizerRoutes(database) {
  const router = express.Router();
  const { Membership, Organization, Event, Listing, Reservation, User } = database.models;
  const service = createOrganizerService(database);
  const invitations = createInvitationService(database);
  router.use('/organizer', requireAccountType('organizer'));
  router.get('/organizer', async (req, res) => {
    const memberships = await Membership.find({ user: req.user._id }).populate('organization').lean();
    if (memberships.length === 1 && memberships[0].organization) return res.redirect(303, `/organizer/${memberships[0].organization._id}`);
    res.render('organizer/select', { title: 'Organizations', activePage: 'dashboard', memberships });
  });
  router.use('/organizer/:organizationId', async (req, res, next) => {
    if (!validId(req.params.organizationId)) throw new HttpError(404, 'Organization not found.');
    const membership = await Membership.findOne({ organization: req.params.organizationId, user: req.user._id, role: { $in: ['admin', 'volunteer'] } }).lean();
    if (!membership) throw new HttpError(403, 'You do not have access to this organization.');
    const organization = await Organization.findById(req.params.organizationId).lean();
    if (!organization) throw new HttpError(404, 'Organization not found.');
    req.session.organizationId = String(organization._id);
    req.organizer = { organizationId: organization._id, userId: req.user._id };
    Object.assign(res.locals, { organization, membership, organizerBase: `/organizer/${organization._id}`, activePage: 'dashboard', chicagoInput });
    next();
  });
  const admin = (req, res, next) => res.locals.membership.role === 'admin' ? next() : next(new HttpError(403, 'This action requires an organization administrator.'));
  const photoCsrf = (req, res, next) => { req.photoFormParsed = true; csrfProtection(req, res, next); };
  const saveListing = async (req, res) => {
    const photo = await saveFoodPhoto(req.file, database.uploadDirectory);
    try { await service.saveListing(req.organizer, req.body, req.params.id, photo?.fields); }
    catch (error) { if (photo) await photo.discard(); throw error; }
    res.redirect(303, res.locals.organizerBase);
  };
  const checkedId = (req, res, next) => validId(req.params.id) ? next() : next(new HttpError(404, 'Record not found.'));
  const renderEvent = (res, event = null) => res.render('organizer/event-form', { title: event ? 'Edit event' : 'Create event', event });
  const renderListing = async (req, res, listing = null) => {
    const events = await Event.find({ organization: req.organizer.organizationId }).sort({ pickupStartsAt: 1 }).lean();
    res.render('organizer/listing-form', { title: listing ? 'Edit food listing' : 'Create food listing', activePage: 'listings', listing, events });
  };
  router.get('/organizer/:organizationId', async (req, res) => {
    const organizationId = req.organizer.organizationId;
    const listings = await Listing.find({ organizationId }).sort({ createdAt: -1 }).lean();
    const events = await Event.find({ organization: organizationId }).sort({ pickupStartsAt: 1 }).lean();
    const rows = await Reservation.aggregate([{ $match: { organizationId } }, { $group: { _id: { status: '$status', missed: { $lte: ['$pickupEndsAt', new Date()] } }, quantity: { $sum: '$quantity' } } }]);
    const totals = { available: listings.reduce((sum, food) => sum + food.availablePortions, 0), reserved: 0, collected: 0, missed: 0 };
    for (const row of rows) {
      if (row._id.status === 'collected') totals.collected += row.quantity;
      else if (row._id.status === 'missed' || row._id.status === 'active' && row._id.missed) totals.missed += row.quantity;
      else if (row._id.status === 'active') totals.reserved += row.quantity;
    }
    res.render('organizer/dashboard', { title: 'Organizer dashboard', totals, listings: listings.map(food => presentListing(food, req.language)), events: events.map(event => ({ ...event, ...pickupPresentation(event.pickupStartsAt, event.pickupEndsAt, req.language) })) });
  });
  router.get('/organizer/:organizationId/listings', async (req, res) => {
    const listings = await Listing.find({ organizationId: req.organizer.organizationId }).sort({ createdAt: -1 }).lean();
    res.render('organizer/listings', { title: 'Listings', activePage: 'listings', listings: listings.map(food => presentListing(food, req.language)) });
  });
  router.post('/organizer/:organizationId/invitations', admin, async (req, res) => {
    if (req.body.confirm !== 'invite') throw new HttpError(422, 'Confirm the email before creating a volunteer invitation.');
    const token = await invitations.invite(req.organizer, req.body.email);
    res.render('organizer/invitation-created', { title: 'Volunteer invitation', invitationPath: `/invitations/${token}`, email: req.body.email.trim().toLowerCase() });
  });
  router.get('/organizer/:organizationId/events/new', admin, (req, res) => renderEvent(res));
  router.post('/organizer/:organizationId/events', admin, async (req, res) => {
    await service.saveEvent(req.organizer, req.body);
    res.redirect(303, res.locals.organizerBase);
  });
  router.get('/organizer/:organizationId/events/:id/edit', admin, checkedId, async (req, res) => {
    const event = await Event.findOne({ _id: req.params.id, organization: req.organizer.organizationId }).lean();
    if (!event) throw new HttpError(404, 'Event not found.');
    renderEvent(res, event);
  });
  router.post('/organizer/:organizationId/events/:id', admin, checkedId, async (req, res) => {
    await service.saveEvent(req.organizer, req.body, req.params.id);
    res.redirect(303, res.locals.organizerBase);
  });
  router.get('/organizer/:organizationId/listings/new', admin, (req, res) => renderListing(req, res));
  router.post('/organizer/:organizationId/listings', admin, parseFoodPhoto, photoCsrf, saveListing);
  router.get('/organizer/:organizationId/listings/:id/edit', admin, checkedId, async (req, res) => {
    const listing = await Listing.findOne({ _id: req.params.id, organizationId: req.organizer.organizationId }).lean();
    if (!listing) throw new HttpError(404, 'Listing not found.');
    await renderListing(req, res, listing);
  });
  router.post('/organizer/:organizationId/listings/:id', admin, checkedId, parseFoodPhoto, photoCsrf, saveListing);
  for (const kind of ['event', 'listing']) router.post(`/organizer/:organizationId/${kind}s/:id/pause`, admin, checkedId, async (req, res) => {
    if (!['pause', 'resume'].includes(req.body.action)) throw new HttpError(422, 'Choose pause or resume.');
    await service.setPaused(req.organizer, req.params.id, kind, req.body.action === 'pause');
    res.redirect(303, res.locals.organizerBase);
  });
  router.get('/organizer/:organizationId/volunteers', admin, async (req, res) => {
    const volunteers = await Membership.find({ organization: req.organizer.organizationId, role: 'volunteer' }).populate('user', 'name email').lean();
    res.render('organizer/volunteers', { title: 'Manage volunteers', volunteers, selected: null, notice: req.query.done === '1' ? 'Volunteer access updated.' : '' });
  });
  router.post('/organizer/:organizationId/volunteers/lookup', admin, async (req, res) => {
    if (typeof req.body.email !== 'string' || req.body.email.length > 254 || !['add', 'remove'].includes(req.body.operation)) throw new HttpError(422, 'Enter an exact registered email and choose add or remove.');
    const user = await User.findOne({ email: req.body.email.trim().toLowerCase() }).select('name email role').lean();
    if (!user) throw new HttpError(404, 'No registered account matches that exact email.');
    if (user.role !== 'organizer') throw new HttpError(409, 'This is a recipient account. Invite a different email for a separate organizer account.');
    const selected = { userId: user._id.toString(), email: user.email, name: user.name, operation: req.body.operation, token: randomUUID(), expiresAt: Date.now() + 10 * 60 * 1000 };
    req.session.volunteerSelection = { ...selected, organizationId: req.organizer.organizationId.toString() };
    res.render('organizer/volunteers', { title: 'Confirm selected account', volunteers: [], selected, notice: '' });
  });
  router.post('/organizer/:organizationId/volunteers/confirm', admin, async (req, res) => {
    const selected = req.session.volunteerSelection;
    if (!selected || selected.organizationId !== String(req.organizer.organizationId) || selected.expiresAt <= Date.now() || req.body.selectionToken !== selected.token || req.body.userId !== selected.userId || req.body.confirm !== 'yes') throw new HttpError(403, 'Look up the exact account again and explicitly confirm the selection.');
    await service.changeVolunteer(req.organizer, selected, selected.operation);
    delete req.session.volunteerSelection;
    res.redirect(303, `${res.locals.organizerBase}/volunteers?done=1`);
  });
  router.get('/organizer/:organizationId/pickups', async (req, res) => {
    const rows = await Reservation.find({ organizationId: req.organizer.organizationId }).populate('user', 'name email').sort({ pickupStartsAt: 1 }).lean();
    res.render('organizer/pickups', { title: 'Organization pickups', activePage: 'pickups', reservations: rows.map(row => presentReservation(row, req.language)) });
  });
  router.post('/organizer/:organizationId/pickups/lookup', async (req, res) => {
    const code = typeof req.body.pickupCode === 'string' ? req.body.pickupCode.replaceAll(/\s/g, '').toUpperCase() : '';
    if (!/^[A-F0-9]{32}$/.test(code)) throw new HttpError(422, 'Enter the complete 32-character pickup code.');
    const reservation = await Reservation.findOne({ pickupCode: code, organizationId: req.organizer.organizationId }).select('_id').lean();
    if (!reservation) throw new HttpError(404, 'Pickup code not found in this organization.');
    res.redirect(303, `${res.locals.organizerBase}/pickups/${reservation._id}`);
  });
  router.get('/organizer/:organizationId/pickups/:id', checkedId, async (req, res) => {
    const row = await Reservation.findOne({ _id: req.params.id, organizationId: req.organizer.organizationId }).populate('user', 'name email').lean();
    if (!row) throw new HttpError(404, 'Reservation not found in this organization.');
    const reservation = presentReservation(row, req.language);
    res.render('organizer/pickup-detail', { title: 'Confirm pickup', activePage: 'pickups', reservation, canCollect: row.status === 'active' && row.pickupStartsAt <= new Date() && row.pickupEndsAt > new Date() });
  });
  router.post('/organizer/:organizationId/pickups/:id/confirm', checkedId, async (req, res) => {
    if (req.body.confirm !== 'collected') throw new HttpError(422, 'Explicitly confirm that the recipient has collected this food.');
    await service.confirmPickup(req.organizer, req.params.id);
    res.redirect(303, `${res.locals.organizerBase}/pickups/${req.params.id}`);
  });
  return router;
}
module.exports = { createOrganizerRoutes };
