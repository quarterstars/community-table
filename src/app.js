const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const path = require('node:path');
const { createPageRoutes } = require('./routes/pages');
const { createAuthRoutes } = require('./routes/auth');
const { createOrganizerRoutes } = require('./routes/organizers');
const { createInvitationRoutes } = require('./routes/invitations');
const { createSharingRoutes } = require('./routes/sharing');
const { membershipAccess } = require('./services/accounts');
const { csrfProtection, accountHome } = require('./middleware/security');
const { HttpError } = require('./lib/errors');
const { localeMiddleware, safeReturn } = require('./lib/i18n');
const { defaultUploadDirectory } = require('./lib/food-uploads');

function createApp({ connection, models, sessionSecret, production = false, trustProxy = false, loginLimit = 10, signupLimit = 30, uploadDirectory = defaultUploadDirectory }) {
  if (connection?.readyState !== 1 || !models || !sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('A verified MongoDB connection and session secret are required.');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(localeMiddleware);
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    Object.assign(res.locals, { currentUser: null, memberships: [], organizerBase: '/organizer', csrfToken: '', reservationsReady: connection.readyState === 1, activePage: 'browse', accountHome });
    next();
  });
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/uploads/food-photos', express.static(uploadDirectory, { dotfiles: 'deny', index: false, maxAge: '1d' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 40 }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (connection.readyState !== 1) return next(new HttpError(503, 'The database is unavailable. Accounts and reservations are temporarily unavailable.'));
    next();
  });
  const cookieOptions = { path: '/', httpOnly: true, secure: production, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };
  const store = MongoStore.create({ client: connection.getClient(), dbName: connection.name, collectionName: 'sessions', autoRemove: 'disabled' });
  store.on('error', () => console.error('Session storage is unavailable.'));
  app.use(session({ name: 'community.sid', secret: sessionSecret, store, resave: false, saveUninitialized: false, cookie: cookieOptions }));
  app.use(csrfProtection);
  app.post('/language', (req, res, next) => {
    if (!['en', 'am'].includes(req.body.language)) return next(new HttpError(422, 'Choose English or Amharic.'));
    res.cookie('community.lang', req.body.language, { path: '/', httpOnly: true, sameSite: 'lax', secure: production, maxAge: 365 * 86400000 });
    res.redirect(303, safeReturn(req.body.returnTo));
  });
  app.use(async (req, res, next) => {
    if (req.session.userId) {
      req.user = await models.User.findById(req.session.userId).select('name email role createdAt').lean();
      res.locals.currentUser = req.user;
      if (req.user) {
        res.locals.memberships = await models.Membership.find({ user: req.user._id, ...membershipAccess(req.user) }).populate('organization', 'name').lean();
        const selected = res.locals.memberships.find(member => String(member.organization?._id) === req.session.organizationId) || res.locals.memberships.find(member => member.organization);
        if (selected) res.locals.organizerBase = `/organizer/${selected.organization._id}`;
      }
    }
    next();
  });
  app.use(createAuthRoutes({ connection, models, cookieOptions, loginLimit, signupLimit }));
  app.use(createInvitationRoutes({ connection, models }));
  app.use(createOrganizerRoutes({ connection, models, uploadDirectory }));
  app.use(createSharingRoutes({ connection, models, uploadDirectory }));
  app.use(createPageRoutes({ connection, models }));
  app.use((req, res) => res.status(404).render('not-found', { title: 'Page not found', activePage: 'browse' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof HttpError ? error.status : error.type === 'entity.too.large' ? 413 : 503;
    if (status === 503) res.locals.reservationsReady = false;
    const message = error instanceof HttpError ? error.message : status === 413 ? 'This request is too large.' : 'We couldn’t finish this request. Check My Pickups before trying again.';
    if (!(error instanceof HttpError)) console.error(`Request failed (${error.name || 'Error'}).`);
    res.status(status).render('error', { title: status === 404 ? 'Reservation not found' : 'Could not finish request', message, status });
  });
  return app;
}
module.exports = { createApp };
