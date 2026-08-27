// Shared outbound request boundary for the Cloudflare Pages Functions.
// Contract (mirrors server/net-guard.mjs for the Workers runtime):
//   untrusted URL -> scheme/credential validation -> target policy validation
//   -> fetch with redirect: 'manual' -> validate Location against the current URL
//   -> repeat up to the hop cap -> byte/deadline-capped body reads.
// The initial URL check is never authorization for later hops, and the whole chain
// shares one absolute wall-clock deadline. The `global_fetch_strictly_public`
// compatibility flag (wrangler.jsonc) additionally forces global fetch() through the
// public Internet boundary so a same-zone hostname cannot short-circuit to an origin.

import { isIpAddress, isPublicIpAddress } from '../../server/public-ip-policy.mjs';

const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';

// Rejects URLs this endpoint must never fetch: non-http(s) schemes, embedded
// credentials, and literal private/loopback/link-local/reserved hosts. DNS cannot be
// resolved on Workers, so name-based rebinding is additionally covered by Cloudflare's
// egress policy plus the strict-public fetch flag.
export function validatePublicUrl(rawUrl, { forbiddenOrigins = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('invalid url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only http/https URLs are allowed');
  if (parsed.username || parsed.password) throw new Error('credentials in URLs are not allowed');
  const host = normalizeHostname(parsed.hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    throw new Error('private hosts are blocked');
  }
  if (isIpAddress(host) && !isPublicIpAddress(host)) throw new Error('private hosts are blocked');

  const targetOrigin = canonicalOrigin(parsed);
  for (const forbiddenOrigin of forbiddenOrigins || []) {
    let candidate;
    try { candidate = canonicalOrigin(new URL(String(forbiddenOrigin))); } catch { continue; }
    if (candidate === targetOrigin) throw new Error('same-zone targets are blocked');
  }
  return parsed;
}

export function rejectFetchUrl(rawUrl, options = {}) {
  try {
    validatePublicUrl(rawUrl, options);
    return '';
  } catch (error) {
    return error?.message || 'invalid url';
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function canonicalOrigin(url) {
  const host = normalizeHostname(url.hostname);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.protocol}//${host}:${port}`;
}

// Fetch with manual, revalidated redirects under one absolute deadline.
// Returns the final (non-3xx) Response plus { finalUrl, hops }.
export async function guardedFetch(rawUrl, {
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  deadlineAt,
  forbiddenOrigins = [],
  attemptBudget,
  headers = {},
  method = 'GET',
  body,
  fetchImpl = fetch
} = {}) {
  const deadline = deadlineAt == null ? Date.now() + 8000 : Number(deadlineAt);
  let currentUrl = String(rawUrl || '').trim();
  const visited = new Set();
  const requestHeaders = withDefaultUserAgent(headers);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (deadline <= Date.now()) throw new Error('request deadline exceeded');
    currentUrl = validatePublicUrl(currentUrl, { forbiddenOrigins }).toString();
    if (visited.has(currentUrl)) throw new Error('redirect loop detected');
    visited.add(currentUrl);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('request deadline exceeded');
    consumeFetchAttempt(attemptBudget);

    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => fetchImpl(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: requestHeaders,
          method,
          body
        })),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('request deadline exceeded'));
            controller.abort();
          }, remaining);
        })
      ]);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, finalUrl: currentUrl, hops: hop };
      }
      response.body?.cancel?.().catch?.(() => {});
      if (hop === maxRedirects) throw new Error('too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect without a location header');
      currentUrl = new URL(location, currentUrl).toString();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('too many redirects');
}

// A caller may share this mutable counter across several guardedFetch calls. It is
// consumed immediately before each raw fetch invocation, so redirects and separate
// HLS resources draw from one operation-wide allowance while unrelated fixed-target
// provider requests remain outside it.
function consumeFetchAttempt(attemptBudget) {
  if (attemptBudget == null) return;
  const remaining = Number(attemptBudget.remaining);
  if (!Number.isInteger(remaining) || remaining <= 0) {
    const error = new Error('stream fetch attempt limit exceeded');
    error.code = 'ERR_FETCH_ATTEMPT_LIMIT';
    throw error;
  }
  attemptBudget.remaining = remaining - 1;
}

// Approved simple compatibility surface: callers that only need the final response
// should not depend on guardedFetch's { response, finalUrl, hops } metadata wrapper.
export async function fetchPublic(rawUrl, options = {}) {
  const { response } = await guardedFetch(rawUrl, options);
  return response;
}

// Reads a response body up to maxBytes. Reaching maxBytes or stopOn is a successful
// partial read; deadline expiry is a distinct failure and cancels the reader. stopWhen
// remains as an unambiguous compatibility alias for established callers.
export async function readBodyCapped(response, { maxBytes, deadlineAt, stopOn, stopWhen } = {}) {
  if (stopOn !== undefined && stopWhen !== undefined) {
    throw new Error('provide only one of stopOn or stopWhen');
  }
  const stop = stopOn ?? stopWhen;
  const deadline = deadlineAt == null ? Date.now() + 8000 : Number(deadlineAt);
  if (deadline <= Date.now()) {
    response?.body?.cancel?.().catch?.(() => {});
    throw new Error('request deadline exceeded');
  }
  if (!response?.body) return new Uint8Array(0);
  const numericCap = Number(maxBytes);
  const cap = Number.isFinite(numericCap) && numericCap >= 0 ? numericCap : 256 * 1024;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (received < cap) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('request deadline exceeded');
      const { value, done } = await readWithinDeadline(reader, remaining);
      if (done) break;
      const accepted = value.subarray(0, cap - received);
      if (accepted.length) chunks.push(accepted);
      received += accepted.length;
      if (received >= cap) break;
      if (typeof stop === 'function' && stop({ length: received, chunk: accepted, body: () => concatChunks(chunks, received) })) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return concatChunks(chunks, received);
}

function readWithinDeadline(reader, remaining) {
  let timer;
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('request deadline exceeded')), remaining);
    })
  ]).finally(() => clearTimeout(timer));
}

function withDefaultUserAgent(headers) {
  const result = new Headers(headers || {});
  if (!result.has('user-agent')) result.set('User-Agent', DEFAULT_USER_AGENT);
  return result;
}

export function concatChunks(chunks, total) {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// Per-isolate request limiter — defense in depth beneath the zone-level WAF rules
// documented in docs/OPERATIONS.md (which fire before the Function executes).
export function createRateLimiter({ windowMs = 60_000, max = 30, maxBuckets = 512 } = {}) {
  const buckets = new Map();
  return request => {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    if (buckets.size >= maxBuckets && !buckets.has(key)) {
      for (const [bucketKey, entry] of buckets) {
        if (now >= entry.resetAt) buckets.delete(bucketKey);
      }
      // Every bucket may still be live under distributed traffic; the map must
      // stay bounded regardless, so evict the buckets closest to expiry. The
      // zone WAF in front remains the durable per-IP rate policy — this
      // in-isolate limiter is defense in depth, not the primary control.
      if (buckets.size >= maxBuckets) {
        const oldestFirst = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (const [bucketKey] of oldestFirst.slice(0, buckets.size - maxBuckets + 1)) {
          buckets.delete(bucketKey);
        }
      }
    }
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}
