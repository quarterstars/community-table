const { createHash, randomBytes } = require('node:crypto');
const { HttpError } = require('../lib/errors');
const { hashPassword } = require('../lib/passwords');
const transactionOptions = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };
const emailValue = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function accountFields(name, password) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80 || typeof password !== 'string' || password.trim().length < 12 || password.length > 128 || Buffer.byteLength(password) > 512) throw new HttpError(422, 'Enter a name and a password between 12 and 128 characters.');
}
async function authorizeOrganizer(database, actor, roles, session) {
  const user = await database.models.User.findOneAndUpdate({ _id: actor.userId, role: 'organizer' }, { $inc: { accessVersion: 1 } }, { session, new: true }).lean();
  if (!user) throw new HttpError(403, 'This action requires an organizer account.');
  const member = await database.models.Membership.findOneAndUpdate({ organization: actor.organizationId, user: actor.userId, role: { $in: roles } }, { $inc: { actionVersion: 1 } }, { session, new: true }).lean();
  if (!member) throw new HttpError(403, 'You do not have permission for this organization action.');
  return member;
}
async function auditAccountTypes(database, session = null) {
  const ids = await database.models.Membership.distinct('user').session(session);
  const users = await database.models.User.find({ _id: { $in: ids }, role: 'recipient' }).select('email role').session(session).lean();
  const candidates = [], conflicts = [];
  for (const user of users) {
    const history = await database.models.Reservation.countDocuments({ user: user._id }).session(session);
    const row = { userId: user._id, email: user.email, reservationHistory: history };
    (history ? conflicts : candidates).push(row);
  }
  // Account types must remain exclusive even if old data is inconsistent.
  const organizers = await database.models.User.find({ role: 'organizer' }).select('email').session(session).lean();
  for (const user of organizers) {
    const history = await database.models.Reservation.countDocuments({ user: user._id }).session(session);
    if (history) conflicts.push({ userId: user._id, email: user.email, reservationHistory: history });
  }
  return { candidates, conflicts };
}
async function migrateAccountTypes(database) {
  return database.connection.transaction(async session => {
    const audit = await auditAccountTypes(database, session);
    if (audit.conflicts.length) return { ...audit, migrated: 0 };
    for (const row of audit.candidates) {
      await database.models.User.updateOne({ _id: row.userId, role: 'recipient' }, { $set: { role: 'organizer' }, $inc: { accessVersion: 1 } }, { session, timestamps: false });
    }
    return { ...audit, migrated: audit.candidates.length };
  }, transactionOptions);
}
function createInvitationService(database) {
  const { User, Organization, Membership, Invitation } = database.models;
  async function invite(actor, email) {
    email = emailValue(email);
    if (!email) throw new HttpError(422, 'Enter the exact email for the new organizer account.');
    const token = randomBytes(32).toString('hex');
    await database.connection.transaction(async session => {
      await authorizeOrganizer(database, actor, ['admin'], session);
      const user = await User.findOne({ email }).session(session).lean();
      if (user) throw new HttpError(409, user.role === 'recipient' ? 'This email belongs to a recipient. Invite a different email for a separate organizer account.' : 'This organizer account already exists. Use the confirmed account lookup to add volunteer access.');
      await Invitation.create([{ organization: actor.organizationId, email, role: 'volunteer', tokenHash: tokenHash(token), createdBy: actor.userId, expiresAt: new Date(Date.now() + 7 * 86400000) }], { session });
    }, transactionOptions);
    return token;
  }
  async function get(token, session = null) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, 'Invitation not found.');
    const invitation = await Invitation.findOne({ tokenHash: tokenHash(token), acceptedAt: null, expiresAt: { $gt: new Date() } }).session(session).lean();
    if (!invitation) throw new HttpError(410, 'This invitation has expired or has already been used.');
    const organization = await Organization.findById(invitation.organization).session(session).lean();
    const creator = await User.findOne({ _id: invitation.createdBy, role: 'organizer' }).session(session).lean();
    const member = await Membership.findOne({ user: invitation.createdBy, organization: invitation.organization, role: 'admin' }).session(session).lean();
    if (!organization || !creator || !member) throw new HttpError(410, 'This invitation is no longer available. Ask an organization administrator for a new one.');
    return { ...invitation, organizationName: organization.name };
  }
  async function accept(token, name, password) {
    accountFields(name, password);
    const passwordHash = await hashPassword(password);
    try {
      return await database.connection.transaction(async session => {
        const invitation = await get(token, session);
        await authorizeOrganizer(database, { userId: invitation.createdBy, organizationId: invitation.organization }, ['admin'], session);
        if (await User.exists({ email: invitation.email }).session(session)) throw new HttpError(409, 'This email already has an account. Recipient accounts cannot be converted; ask for an invitation to a different email.');
        const [user] = await User.create([{ name: name.trim(), email: invitation.email, passwordHash, role: 'organizer' }], { session });
        await Membership.create([{ organization: invitation.organization, user: user._id, role: invitation.role }], { session });
        const result = await Invitation.updateOne({ _id: invitation._id, acceptedAt: null, expiresAt: { $gt: new Date() } }, { $set: { acceptedAt: new Date(), acceptedBy: user._id } }, { session });
        if (!result.modifiedCount) throw new HttpError(410, 'This invitation was already used or expired.');
        return user.toObject();
      }, transactionOptions);
    } catch (error) {
      if (error.code === 11000) throw new HttpError(409, 'An account with this email already exists. Use a separate email.');
      throw error;
    }
  }
  return { invite, get, accept };
}
module.exports = { auditAccountTypes, migrateAccountTypes, authorizeOrganizer, createInvitationService, emailValue, accountFields };
