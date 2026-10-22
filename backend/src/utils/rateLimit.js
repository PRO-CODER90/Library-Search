// Fixed-window rate limiter keyed by client IP (in memory, per process).

export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    /** Records a hit; returns seconds to wait if the limit is exceeded, else 0. */
    hit(key, now = Date.now()) {
      let entry = hits.get(key);
      if (!entry || now - entry.start >= windowMs) {
        entry = { start: now, count: 0 };
        hits.set(key, entry);
        if (hits.size > 50000) hits.clear(); // crude memory bound
      }
      entry.count += 1;
      return entry.count > max ? Math.ceil((entry.start + windowMs - now) / 1000) : 0;
    },
    /** Seconds to wait if the key is already over the limit, without counting a hit. */
    peek(key, now = Date.now()) {
      const entry = hits.get(key);
      if (!entry || now - entry.start >= windowMs || entry.count < max) return 0;
      return Math.ceil((entry.start + windowMs - now) / 1000);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
