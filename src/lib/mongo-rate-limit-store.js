const { createHash } = require('node:crypto');

// Shared, persistent rate-limit counters survive application restarts.
class MongoRateLimitStore {
  constructor(collection, prefix) { this.collection = collection; this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  id(key) { return createHash('sha256').update(`${this.prefix}:${key}`).digest('hex'); }
  async increment(key) {
    const now = new Date();
    const active = { $gt: [{ $ifNull: ['$resetTime', new Date(0)] }, now] };
    const update = [{ $set: {
      totalHits: { $cond: [active, { $add: ['$totalHits', 1] }, 1] },
      resetTime: { $cond: [active, '$resetTime', new Date(now.getTime() + this.windowMs)] }
    } }];
    let result;
    try {
      result = await this.collection.findOneAndUpdate({ _id: this.id(key) }, update, { upsert: true, returnDocument: 'after', includeResultMetadata: false });
    } catch (error) {
      if (error.code !== 11000) throw error;
      result = await this.collection.findOneAndUpdate({ _id: this.id(key) }, update, { returnDocument: 'after', includeResultMetadata: false });
    }
    return { totalHits: result.totalHits, resetTime: result.resetTime };
  }
  async decrement(key) { await this.collection.updateOne({ _id: this.id(key), totalHits: { $gt: 0 } }, { $inc: { totalHits: -1 } }); }
  async resetKey(key) { await this.collection.deleteOne({ _id: this.id(key) }); }
}

module.exports = { MongoRateLimitStore };
