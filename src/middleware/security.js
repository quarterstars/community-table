const { randomBytes, timingSafeEqual } = require('node:crypto');
const { HttpError } = require('../lib/errors');

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  // Multipart bodies are parsed only on authorized listing create/edit routes.
  // Those routes call this protection again after their bounded parser.
  const deferredPhotoForm = !req.photoFormParsed && req.method === 'POST' && req.is('multipart/form-data') && /^(?:\/organizer\/[a-f0-9]{24}|\/share-food)\/listings(?:\/[a-f0-9]{24})?$/.test(req.path);
  if (!deferredPhotoForm && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const submitted = req.body?._csrf;
    if (typeof submitted !== 'string' || !/^[a-f0-9]{64}$/.test(submitted) ||
        !timingSafeEqual(Buffer.from(submitted, 'hex'), Buffer.from(req.session.csrfToken, 'hex'))) {
      return next(new HttpError(403, 'This form expired or could not be verified. Reload the page and try again.'));
    }
  }
  next();
}

function safeNext(value) {
  return typeof value === 'string' && /^(?:\/|\/profile|\/my-pickups|\/foods\/[a-z0-9-]+|\/reservations\/[a-f0-9]{24}|\/share-food(?:\/listings\/new|\/listings\/[a-f0-9]{24}\/edit|\/pickups\/[a-f0-9]{24})?|\/invitations\/[a-f0-9]{64}|\/organizer(?:\/[a-f0-9]{24}(?:\/(?:listings|pickups|volunteers))?)?)$/.test(value) ? value : '/';
}

function accountHome() { return '/'; }
function accountDestination(user, value) { return safeNext(value); }

function requireLogin(req, res, next) {
  if (req.user) return next();
  const destination = req.method === 'GET' ? req.originalUrl.split('?')[0] : req.params.id && req.originalUrl.startsWith('/foods/') ? `/foods/${req.params.id}` : req.originalUrl.startsWith('/share-food') ? '/share-food' : '/my-pickups';
  res.redirect(303, `/login?next=${encodeURIComponent(safeNext(destination))}`);
}

async function establishSession(req, userId) {
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = userId.toString();
  req.session.csrfToken = randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

module.exports = { csrfProtection, safeNext, requireLogin, establishSession, accountHome, accountDestination };
