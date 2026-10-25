const express = require('express');
const { createInvitationService } = require('../services/accounts');
const { establishSession } = require('../middleware/security');
const { HttpError } = require('../lib/errors');
const { rateLimit } = require('express-rate-limit');
const { MongoRateLimitStore } = require('../lib/mongo-rate-limit-store');
function createInvitationRoutes(database) {
  const router = express.Router();
  const service = createInvitationService(database);
  const guestOnly = (req, res, next) => req.user ? next(new HttpError(409, 'Log out before creating a separate organizer account. Your current account will not be converted.')) : next();
  router.get('/invitations/:token', guestOnly, async (req, res) => {
    const invitation = await service.get(req.params.token);
    res.render('invitation', { title: 'Create organizer account', activePage: 'profile', invitation, token: req.params.token });
  });
  router.post('/invitations/:token', guestOnly, rateLimit({ windowMs: 3600000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, store: new MongoRateLimitStore(database.connection.db.collection('rate_limits'), 'invitation'), handler: (req, res, next) => next(new HttpError(429, 'Too many attempts. Please wait before trying again.')) }), async (req, res) => {
    const user = await service.accept(req.params.token, req.body.name, req.body.password);
    await establishSession(req, user._id);
    res.redirect(303, '/organizer');
  });
  return router;
}
module.exports = { createInvitationRoutes };
