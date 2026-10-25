const express = require('express');
const { randomUUID } = require('node:crypto');
const { requireLogin } = require('../middleware/security');
const { createReservationService, parseQuantity } = require('../services/reservations');
const { presentListing, presentReservation } = require('../lib/presentation');
const { HttpError } = require('../lib/errors');

function createPageRoutes(database) {
  const router = express.Router();
  const { Listing, Reservation, Event } = database.models;
  const reservations = createReservationService(database);
  router.get('/about', (req, res) => res.render('about', { title: 'About', activePage: '', photoCredits: require('../data/food-photos.json') }));
  router.get('/', async (req, res) => {
    const listings = await Listing.find({ status: 'open', availablePortions: { $gt: 0 }, pickupEndsAt: { $gt: new Date() } }).populate('eventId', 'status pickupEndsAt').sort({ pickupStartsAt: 1 }).lean();
    const newSamplesAdded = await Listing.exists({ slug: 'sample-doro-wat', isDemo: true });
    const supersededExamples = ['lentil-stew', 'roasted-vegetable-bowls', 'bread-and-fruit'];
    // Preserve old records and direct links, while keeping the demonstration
    // focused on the new five foods. Other organizer listings remain visible.
    const visible = listings.filter(food => !(newSamplesAdded && food.isDemo && supersededExamples.includes(food.slug)) && (!food.eventId || food.eventId.status === 'open' && food.eventId.pickupEndsAt > new Date()));
    res.render('browse', { title: 'Browse', activePage: 'browse', foods: visible.map(food => presentListing(food, req.language)) });
  });
  router.get('/foods/:id', async (req, res, next) => {
    const listing = await Listing.findOne({ slug: req.params.id }).lean();
    if (!listing) return next();
    const existing = req.user ? await Reservation.findOne({ user: req.user._id, listing: listing._id, status: 'active' }).lean() : null;
    const commitments = req.user ? await Reservation.find({ user: req.user._id, listing: listing._id, status: { $in: ['active', 'collected', 'missed'] } }).select('quantity').lean() : [];
    const remainingLimit = Math.max(0, listing.perAccountLimit - commitments.reduce((sum, reservation) => sum + reservation.quantity, 0));
    const event = listing.eventId ? await Event.findOne({ _id: listing.eventId, organization: listing.organizationId }).lean() : null;
    const available = listing.status === 'open' && listing.pickupEndsAt > new Date() && listing.availablePortions > 0 && (!listing.eventId || event?.status === 'open' && event.pickupEndsAt > new Date());
    res.render('food-details', {
      title: presentListing(listing, req.language).name, activePage: 'browse', food: presentListing(listing, req.language),
      ownListing: Boolean(req.user && String(listing.owner) === String(req.user._id)),
      existingReservation: existing && presentReservation(existing, req.language), canReserve: available && remainingLimit > 0,
      limitReached: Boolean(req.user && remainingLimit === 0),
      quantityMaximum: Math.min(listing.availablePortions, remainingLimit), requestKey: randomUUID()
    });
  });
  router.post('/foods/:id/reserve', requireLogin, async (req, res) => {
    if (req.body.confirm !== 'reserve') throw new HttpError(422, 'Confirm your reservation before submitting.');
    const reservation = await reservations.reserve({ userId: req.user._id, listingSlug: req.params.id, quantity: parseQuantity(req.body.quantity), requestKey: req.body.requestKey });
    res.redirect(303, `/reservations/${reservation._id}`);
  });
  router.get('/my-pickups', async (req, res) => {
    const saved = req.user ? await Reservation.find({ user: req.user._id }).sort({ createdAt: -1 }).lean() : [];
    res.render('my-pickups', { title: 'My Pickups', activePage: 'pickups', reservations: saved.map(row => presentReservation(row, req.language)) });
  });
  router.get('/reservations/:id', requireLogin, async (req, res) => {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) throw new HttpError(404, 'Reservation not found.');
    const reservation = await Reservation.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!reservation) throw new HttpError(404, 'Reservation not found.');
    res.render('reservation', { title: 'Your reservation', activePage: 'pickups', reservation: presentReservation(reservation, req.language) });
  });
  router.post('/reservations/:id/cancel', requireLogin, async (req, res) => {
    const reservation = await reservations.cancel({ userId: req.user._id, reservationId: req.params.id });
    res.redirect(303, `/reservations/${reservation._id}`);
  });
  router.get('/profile', (req, res) => {
    res.render('profile', { title: 'Profile', activePage: 'profile' });
  });
  return router;
}
module.exports = { createPageRoutes };
