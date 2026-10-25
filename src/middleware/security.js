const { randomBytes, timingSafeEqual } = require('node:crypto');
const { HttpError } = require('../lib/errors');

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  // Multipart bodies are parsed only on the two authorized listing routes.
  // Those routes call this protection again after their bounded parser.
  const deferredPhotoForm = !req.photoFormParsed && req.method === 'POST' && req.is('multipart/form-data') && /^\/organizer\/[a-f0-9]{24}\/listings(?:\/[a-f0-9]{24})?$/.test(req.path);
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
  return typeof value === 'string' && /^(?:\/|\/profile|\/my-pickups|\/foods\/[a-z0-9-]+|\/organizer(?:\/[a-f0-9]{24}(?:\/(?:listings|pickups|volunteers))?)?)$/.test(value) ? value : '/';
}

function accountHome(user) { return user?.role === 'organizer' ? '/organizer' : '/'; }
function accountDestination(user, value) {
  const destination = safeNext(value);
  if (user.role === 'organizer') return destination === '/profile' || destination.startsWith('/organizer') ? destination : '/organizer';
  return destination.startsWith('/organizer') ? '/' : destination;
}
function requireAccountType(type) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (req.user.role !== type) return next(new HttpError(403, type === 'recipient' ? 'Only recipient accounts can reserve food or manage personal pickups. Use a separate recipient account with a different email.' : 'Organizer access requires a separate organizer account. Recipient accounts cannot manage organizations.'));
    next();
  };
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  const destination = req.method === 'GET' ? req.originalUrl.split('?')[0] : req.params.id && req.path.startsWith('/foods/') ? `/foods/${req.params.id}` : '/my-pickups';
  res.redirect(303, `/login?next=${encodeURIComponent(safeNext(destination))}`);
}

async function establishSession(req, userId) {
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = userId.toString();
  req.session.csrfToken = randomBytes(32).toString('hex');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

module.exports = { csrfProtection, safeNext, requireLogin, establishSession, requireAccountType, accountHome, accountDestination };
