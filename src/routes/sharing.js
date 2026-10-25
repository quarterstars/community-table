const express = require('express');
const { requireLogin, csrfProtection } = require('../middleware/security');
const { parseFoodPhoto, saveFoodPhoto } = require('../lib/food-uploads');
const { createSharingService, personalScope } = require('../services/sharing');
const { validId } = require('../services/organizers');
const { chicagoInput } = require('../lib/chicago-time');
const { presentListing, presentReservation } = require('../lib/presentation');
const { HttpError } = require('../lib/errors');

function createSharingRoutes(database) {
  const router = express.Router();
  const { Listing, Reservation } = database.models;
  const service = createSharingService(database);
  const checkedId = (req, res, next) => validId(req.params.id) ? next() : next(new HttpError(404, 'Record not found.'));
  router.get('/share-food', async (req, res) => {
    const listings = req.user ? await Listing.find(personalScope(req.user._id)).sort({ createdAt: -1 }).lean() : [];
    const rows = await Reservation.find({ listing: { $in: listings.map(row => row._id) } }).populate('user', 'name').sort({ createdAt: -1 }).lean();
    res.render('share-food', { title: 'Share Food', activePage: 'share', listings: listings.map(row => presentListing(row, req.language)), reservations: rows.map(row => presentReservation(row, req.language)) });
  });
  router.use('/share-food', requireLogin);
  const render = (res, listing = null) => res.render('organizer/listing-form', { title: listing ? 'Edit food listing' : 'Post food', activePage: 'share', personal: true, listing, events: [], chicagoInput });
  router.get('/share-food/listings/new', (req, res) => render(res));
  const ownListing = async (req, res, next) => {
    req.listing = await Listing.findOne({ _id: req.params.id, ...personalScope(req.user._id) }).lean();
    if (!req.listing) throw new HttpError(404, 'Listing not found.');
    next();
  };
  router.get('/share-food/listings/:id/edit', checkedId, ownListing, (req, res) => render(res, req.listing));
  const photoCsrf = (req, res, next) => { req.photoFormParsed = true; csrfProtection(req, res, next); };
  const save = async (req, res) => {
    const photo = await saveFoodPhoto(req.file, database.uploadDirectory);
    try { await service.save(req.user._id, req.body, req.params.id, photo?.fields); }
    catch (error) { if (photo) await photo.discard(); throw error; }
    res.redirect(303, '/share-food');
  };
  router.post('/share-food/listings', parseFoodPhoto, photoCsrf, save);
  router.post('/share-food/listings/:id', checkedId, ownListing, parseFoodPhoto, photoCsrf, save);
  router.post('/share-food/listings/:id/pause', checkedId, async (req, res) => {
    if (!['pause', 'resume'].includes(req.body.action)) throw new HttpError(422, 'Choose pause or resume.');
    await service.pause(req.user._id, req.params.id, req.body.action === 'pause');
    res.redirect(303, '/share-food');
  });
  router.get('/share-food/pickups/:id', checkedId, async (req, res) => {
    const listings = await Listing.find(personalScope(req.user._id)).select('_id').lean();
    const row = await Reservation.findOne({ _id: req.params.id, listing: { $in: listings.map(row => row._id) } }).populate('user', 'name').lean();
    if (!row) throw new HttpError(404, 'Reservation not found.');
    res.render('organizer/pickup-detail', { title: 'Confirm pickup', activePage: 'share', personal: true, organizerBase: '/share-food', reservation: presentReservation(row, req.language), canCollect: row.status === 'active' && row.pickupStartsAt <= new Date() && row.pickupEndsAt > new Date() });
  });
  router.post('/share-food/pickups/:id/confirm', checkedId, async (req, res) => {
    if (req.body.confirm !== 'collected') throw new HttpError(422, 'Explicitly confirm that the recipient has collected this food.');
    await service.confirm(req.user._id, req.params.id);
    res.redirect(303, `/share-food/pickups/${req.params.id}`);
  });
  return router;
}
module.exports = { createSharingRoutes };
