const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { hashPassword, verifyPassword } = require('../lib/passwords');
const { MongoRateLimitStore } = require('../lib/mongo-rate-limit-store');
const { safeNext, establishSession, requireLogin, accountDestination } = require('../middleware/security');

function createAuthRoutes({ connection, models, cookieOptions, loginLimit = 10, signupLimit = 30 }) {
  const router = express.Router();
  const render = (req, res, mode, status = 200, error = '') => res.status(status).render('auth', {
    title: mode === 'signup' ? 'Create an account' : 'Log in', activePage: 'profile', mode, error,
    name: typeof req.body?.name === 'string' ? req.body.name.slice(0, 80) : '',
    email: typeof req.body?.email === 'string' ? req.body.email.slice(0, 254) : '',
    nextDestination: safeNext(req.body?.next || req.query.next)
  });
  const limiter = (prefix, windowMs, limit) => rateLimit({
    windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    store: new MongoRateLimitStore(connection.db.collection('rate_limits'), prefix),
    handler: (req, res) => render(req, res, prefix, 429, 'Too many attempts. Please wait before trying again.')
  });
  for (const mode of ['signup', 'login']) {
    router.get(`/${mode}`, (req, res) => {
      if (req.user) return res.redirect(303, accountDestination(req.user, req.query.next));
      render(req, res, mode);
    });
  }
  router.post('/signup', limiter('signup', 60 * 60 * 1000, signupLimit), async (req, res) => {
    const { name, email, password } = req.body;
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 ||
        typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || password.trim().length < 12 || password.length > 128 || Buffer.byteLength(password) > 512) {
      return render(req, res, 'signup', 422, 'Enter a name, a valid email, and a password between 12 and 128 characters.');
    }
    let user;
    try {
      user = await models.User.create({
        name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await hashPassword(password),
        role: 'member' // Organization access is never granted by signup.
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      return render(req, res, 'signup', 409, 'An account with this email already exists. Try logging in.');
    }
    await establishSession(req, user._id);
    res.redirect(303, accountDestination(user, req.body.next));
  });
  router.post('/login', limiter('login', 15 * 60 * 1000, loginLimit), async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = email.length <= 254 ? await models.User.findOne({ email }).select('+passwordHash') : null;
    const verified = await verifyPassword(password, user?.passwordHash);
    if (!verified || !user) return render(req, res, 'login', 401, 'Email or password is incorrect.');
    await establishSession(req, user._id);
    res.redirect(303, accountDestination(user, req.body.next));
  });
  router.post('/logout', requireLogin, async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    res.clearCookie('community.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieOptions.secure });
    res.redirect(303, '/profile');
  });
  return router;
}
module.exports = { createAuthRoutes };
