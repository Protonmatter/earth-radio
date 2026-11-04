export const WINDOW_MS = 60000;
export const RETENTION_MS = 120000;
export const LIMITS = Object.freeze({ nowplaying: 30, fingerprint: 6 });

// Pure transition; time comes only from the Durable Object, never the caller.
export function advanceQuota(previous, limit, now) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('Invalid quota input');
  if (previous && (!['blockedUntil', 'touchedAt'].every(key => Number.isSafeInteger(previous[key]) && previous[key] >= 0) ||
      !Array.isArray(previous.accepted) || previous.accepted.length > limit ||
      !previous.accepted.every((value, index) => Number.isSafeInteger(value) && value >= 0 && value <= previous.touchedAt && (index === 0 || value >= previous.accepted[index - 1])))) throw new Error('Invalid stored quota');
  const time = Math.max(now, previous?.touchedAt ?? 0);
  const state = { accepted: previous ? previous.accepted.filter(value => value > time - WINDOW_MS) : [], blockedUntil: previous?.blockedUntil ?? 0, touchedAt: time };
  if (state.blockedUntil > time) return { state, allowed: false, remaining: 0, retryAfter: Math.ceil((state.blockedUntil - time) / 1000) };
  state.blockedUntil = 0;
  if (state.accepted.length >= limit) {
    state.blockedUntil = time + WINDOW_MS;
    return { state, allowed: false, remaining: 0, retryAfter: 60 };
  }
  state.accepted.push(time);
  return { state, allowed: true, remaining: limit - state.accepted.length, retryAfter: 0 };
}
