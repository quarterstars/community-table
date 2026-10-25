const express = require('express');
const { createInvitationService } = require('../services/accounts');
const { requireLogin } = require('../middleware/security');
const { HttpError } = require('../lib/errors');
function createInvitationRoutes(database) {
  const router = express.Router();
  const service = createInvitationService(database);
  router.get('/invitations/:token', async (req, res) => {
    const invitation = await service.get(req.params.token);
    res.render('invitation', { title: 'Volunteer invitation', activePage: 'share', invitation, token: req.params.token });
  });
  router.post('/invitations/:token', requireLogin, async (req, res) => {
    if (req.body.confirm !== 'accept') throw new HttpError(422, 'Confirm organization access before accepting.');
    await service.accept(req.params.token, req.user._id);
    res.redirect(303, '/share-food');
  });
  return router;
}
module.exports = { createInvitationRoutes };
