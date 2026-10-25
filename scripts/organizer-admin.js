const { loadEnvironment, readConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');
const { grantDevelopmentAdmin } = require('../src/services/development');
const { HttpError } = require('../src/lib/errors');
const readline = require('node:readline');
const { Writable } = require('node:stream');
async function passwordPrompt() {
  if (!process.stdin.isTTY) throw new HttpError(422, 'Set DEV_ORGANIZER_PASSWORD or run this command in a terminal to enter a new organizer password privately.');
  const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const input = readline.createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('New organizer password (12–128 characters, hidden): ');
  try { return await new Promise(resolve => input.question('', resolve)); }
  finally { input.close(); process.stdout.write('\n'); }
}
async function main() {
  loadEnvironment();
  if (process.env.NODE_ENV === 'production') throw new HttpError(403, 'Development organizer setup is disabled in production.');
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    if (!['--email', '--slug', '--name', '--account-name'].includes(key) || !process.argv[index + 1]) throw new HttpError(422, 'Usage: npm run dev:organizer -- --email separate-organizer@example.test [--account-name "Organizer name"] [--slug demo-slug] [--name "Fictional organization name"]');
    args[key === '--account-name' ? 'accountName' : key.slice(2)] = process.argv[index + 1];
  }
  if (!args.email) throw new HttpError(422, 'Provide --email for a separate organizer account, different from any recipient email.');
  const config = readConfig();
  const database = await connectDatabase(config.mongoUri);
  try {
    const existing = await database.models.User.findOne({ email: args.email.trim().toLowerCase() }).select('role').lean();
    if (!existing) args.password = process.env.DEV_ORGANIZER_PASSWORD || await passwordPrompt();
    await grantDevelopmentAdmin(database, { ...args, production: config.production });
    console.log('Dedicated organizer account ready; admin membership granted. Log in and open /organizer. Recipient accounts and history were not changed.');
  } finally { await database.connection.close(); }
}
if (require.main === module) main().catch(error => { console.error(error instanceof HttpError ? error.message : 'Organizer setup failed. Check configuration and MongoDB authentication.'); process.exitCode = 1; });
