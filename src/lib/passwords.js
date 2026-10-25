const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const parameters = `${options.N}:${options.r}:${options.p}`;

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `scrypt:${parameters}:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 512) return false;
  // The same work is performed when an email doesn't exist, without a fake account.
  const [algorithm, cost, blockSize, parallelism, salt, hash, extra] =
    (stored || `scrypt:${parameters}:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  if (algorithm !== 'scrypt' || `${cost}:${blockSize}:${parallelism}` !== parameters || extra !== undefined ||
      !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const candidate = await derive(password, salt, 64, options);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex')) && Boolean(stored);
}

module.exports = { hashPassword, verifyPassword };
