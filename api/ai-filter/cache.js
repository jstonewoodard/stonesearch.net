/* Tiny in-memory TTL cache with LRU eviction.
   Production: replace with Redis. Same get/set interface.
*/
'use strict';

const crypto = require('crypto');

class TtlCache {
  constructor({ maxEntries = 5000, defaultTtlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map(); // key -> {value, expiresAt}
    this.hits = 0;
    this.misses = 0;
  }

  static key({ url, contentHash }) {
    const h = crypto.createHash('sha256');
    h.update(url);
    h.update(':');
    h.update(contentHash || '');
    return h.digest('hex');
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return null; }
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return null;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries) {
      // Evict oldest (first inserted key)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total === 0 ? 0 : Math.round((this.hits / total) * 1000) / 1000,
    };
  }

  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
}

module.exports = { TtlCache };
