const { Schema } = require('mongoose');

const integer = (value) => Number.isSafeInteger(value);
function createModels(connection) {
  const userSchema = new Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    // Legacy values remain stored; personal sharing/receiving never depends on role.
    role: { type: String, enum: ['member', 'recipient', 'organizer'], default: 'member', required: true },
    accessVersion: { type: Number, default: 0 },
    needsFoodSupport: { type: Boolean, default: false, select: false }
  }, { timestamps: true });
  userSchema.index({ email: 1 }, { unique: true });

  const organizationSchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, match: /^[a-z0-9-]+$/, maxlength: 100 },
    isDemo: { type: Boolean, default: true }
  }, { timestamps: true });
  organizationSchema.index({ slug: 1 }, { unique: true });
  const membershipSchema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'volunteer'], required: true },
    // Explicit grants enable one membership, including quarantined legacy recipients.
    accessGranted: { type: Boolean, default: false },
    actionVersion: { type: Number, default: 0 }
  }, { timestamps: true });
  membershipSchema.index({ organization: 1, user: 1 }, { unique: true });
  membershipSchema.index({ user: 1 });
  const invitationSchema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['volunteer'], required: true },
    tokenHash: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }, { timestamps: true });
  invitationSchema.index({ tokenHash: 1 }, { unique: true });
  const eventSchema = new Schema({
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, maxlength: 150 },
    description: { type: String, maxlength: 2000, default: '' },
    pickupStartsAt: { type: Date, required: true },
    pickupEndsAt: { type: Date, required: true },
    pickupLocation: { type: String, required: true, maxlength: 300 },
    pickupInstructions: { type: String, required: true, maxlength: 3000 },
    status: { type: String, enum: ['open', 'paused', 'closed'], default: 'open' },
    revision: { type: Number, min: 0, default: 0, validate: integer },
    seedKey: String,
    legacyListing: { type: Schema.Types.ObjectId, ref: 'Listing' }
  }, { timestamps: true });
  eventSchema.index({ organization: 1, seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });
  eventSchema.index({ legacyListing: 1 }, { unique: true, partialFilterExpression: { legacyListing: { $type: 'objectId' } } });

  const translatedTextSchema = new Schema({ name: String, organization: String, category: String, description: String, portionSize: String, ingredients: [String], allergens: String, pickupLocation: String, pickupInstructions: String, imageAlt: String }, { _id: false });
  const translationsSchema = new Schema({ am: { type: translatedTextSchema, default: undefined } }, { _id: false });

  const listingSchema = new Schema({
    slug: { type: String, required: true, match: /^[a-z0-9-]+$/, maxlength: 100 },
    name: { type: String, required: true, maxlength: 150 },
    organization: { type: String, required: true, maxlength: 150 },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event' },
    revision: { type: Number, min: 0, default: 0, validate: integer },
    category: String,
    description: { type: String, required: true },
    portionSize: String,
    ingredients: { type: [String], default: undefined },
    allergens: String,
    image: { type: String, default: '/images/food-placeholder.svg' },
    imageAlt: { type: String, default: 'Neutral food placeholder; no photograph is available' },
    imageType: { type: String, enum: ['illustration', 'photo', 'placeholder'], default: 'placeholder' },
    translations: { type: translationsSchema, default: undefined },
    totalPortions: { type: Number, required: true, min: 1, validate: integer },
    availablePortions: { type: Number, required: true, min: 0, validate: integer },
    perAccountLimit: { type: Number, required: true, min: 1, validate: integer },
    priorityEnabled: { type: Boolean, default: false },
    priorityOpensAt: Date,
    generalOpensAt: Date,
    demoStockDate: String,
    pickupStartsAt: { type: Date, required: true },
    pickupEndsAt: { type: Date, required: true },
    pickupLocation: { type: String, required: true },
    pickupInstructions: { type: String, required: true },
    status: { type: String, enum: ['open', 'paused', 'closed'], default: 'open' },
    isDemo: { type: Boolean, default: true }
  }, { timestamps: true });
  listingSchema.index({ slug: 1 }, { unique: true });
  listingSchema.index({ status: 1, pickupEndsAt: 1 });
  listingSchema.index({ organizationId: 1, eventId: 1 });
  listingSchema.index({ owner: 1, createdAt: -1 });
  listingSchema.pre('validate', function () {
    if (this.availablePortions > this.totalPortions) this.invalidate('availablePortions', 'Inventory exceeds total portions.');
    if (this.pickupEndsAt <= this.pickupStartsAt) this.invalidate('pickupEndsAt', 'Pickup must end after it starts.');
  });

  const snapshotSchema = new Schema({
    name: { type: String, required: true },
    organization: { type: String, required: true },
    image: String,
    imageAlt: String,
    imageType: String,
    translations: { type: translationsSchema, default: undefined },
    portionSize: String,
    pickupLocation: { type: String, required: true },
    pickupInstructions: { type: String, required: true }
  }, { _id: false });
  const reservationSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    listingSlug: { type: String, required: true },
    requestKey: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, validate: integer },
    pickupCode: { type: String, required: true },
    pickupStartsAt: { type: Date, required: true },
    pickupEndsAt: { type: Date, required: true },
    food: { type: snapshotSchema, required: true },
    status: { type: String, enum: ['active', 'cancelled', 'collected', 'missed'], default: 'active' },
    cancelledAt: Date,
    collectedAt: Date,
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }, { timestamps: true });
  reservationSchema.index({ user: 1, requestKey: 1 }, { unique: true });
  reservationSchema.index({ pickupCode: 1 }, { unique: true });
  // One active reservation per account/listing makes the per-account limit exact.
  reservationSchema.index({ user: 1, listing: 1 }, {
    unique: true,
    partialFilterExpression: { status: 'active' }
  });
  reservationSchema.index({ user: 1, createdAt: -1 });
  reservationSchema.index({ organizationId: 1, status: 1, pickupEndsAt: 1 });

  return {
    User: connection.models.User || connection.model('User', userSchema),
    Organization: connection.models.Organization || connection.model('Organization', organizationSchema),
    Membership: connection.models.Membership || connection.model('Membership', membershipSchema),
    Invitation: connection.models.Invitation || connection.model('Invitation', invitationSchema),
    Event: connection.models.Event || connection.model('Event', eventSchema),
    Listing: connection.models.Listing || connection.model('Listing', listingSchema),
    Reservation: connection.models.Reservation || connection.model('Reservation', reservationSchema)
  };
}

module.exports = { createModels };
