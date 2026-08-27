// Small shared cache utilities: bounded TTL cache with LRU-ish eviction and
// in-flight request deduplication, used by the platform now-playing and
// fingerprint resolvers so their caching semantics cannot drift apart.

export function createBoundedTtlCache({ maxEntries = 256 } = {}) {
  const entries = new Map();
  return {
    read(key) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      entry.lastAccessedAt = Date.now();
      return { ...entry.payload };
    },
    write(key, payload, ttlMs) {
      entries.set(key, { payload: { ...payload }, expiresAt: Date.now() + ttlMs, lastAccessedAt: Date.now() });
      if (entries.size <= maxEntries) return;
      const oldest = [...entries.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0]?.[0];
      if (oldest !== undefined) entries.delete(oldest);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}

// Runs produce() once per key at a time; concurrent callers join the same promise
// and their results are marked cached. The cache write picks its TTL per payload.
export async function resolveWithCache({ cache, inFlight, key, produce, ttlFor }) {
  const cached = cache.read(key);
  if (cached) return { ...cached, cached: true };
  if (inFlight.has(key)) return { ...await inFlight.get(key), cached: true };

  const promise = produce();
  inFlight.set(key, promise);
  try {
    const payload = await promise;
    const ttlMs = ttlFor(payload);
    // Symbols such as DO_NOT_CACHE are dropped by `{...payload}` in write(); skip
    // the store entirely when the producer asks for a zero TTL.
    if (ttlMs > 0) cache.write(key, payload, ttlMs);
    return payload;
  } finally {
    inFlight.delete(key);
  }
}
