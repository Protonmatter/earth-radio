// Shared outbound request boundary for the Cloudflare Pages Functions.
// Contract (mirrors server/net-guard.mjs for the Workers runtime):
//   untrusted URL -> scheme/credential validation -> target policy validation
//   -> fetch with redirect: 'manual' -> validate Location against the current URL
//   -> repeat up to the hop cap -> byte/deadline-capped body reads.
// The initial URL check is never authorization for later hops, and the whole chain
// shares one absolute wall-clock deadline. The `global_fetch_strictly_public`
// compatibility flag (wrangler.toml) additionally forces global fetch() through the
// public Internet boundary so a same-zone hostname cannot short-circuit to an origin.

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = 'EarthRadio/0.24.0 pages-fn (+https://github.com/Protonmatter/EarthRadio)';

// Rejects URLs this endpoint must never fetch: non-http(s) schemes, embedded
// credentials, and literal private/loopback/link-local/reserved hosts. DNS cannot be
// resolved on Workers, so name-based rebinding is additionally covered by Cloudflare's
// egress policy plus the strict-public fetch flag.
export function rejectFetchUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return 'invalid url';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'only http/https URLs are allowed';
  if (parsed.username || parsed.password) return 'credentials in URLs are not allowed';
  const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return 'private hosts are blocked';
  }
  const ipv4 = ipv4From(host);
  if (ipv4) {
    const [a, b] = ipv4.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 ||
        a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a >= 224) {
      return 'private hosts are blocked';
    }
    return '';
  }
  if (host.includes(':')) {
    const lower = host.split('%', 1)[0];
    const firstWord = Number.parseInt(lower.split(':').find(Boolean) || '0', 16);
    if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
        (Number.isFinite(firstWord) && (firstWord & 0xffc0) === 0xfe80) || lower.startsWith('ff')) {
      return 'private hosts are blocked';
    }
  }
  return '';
}

// Normalizes dotted, integer, and hex IPv4 forms (and IPv4 embedded in IPv6) so
// encoded loopback like http://2130706433/ cannot slip past the literal checks.
function ipv4From(host) {
  const lower = String(host || '').toLowerCase();
  // Mapped/compatible prefixes plus the NAT64 translation prefixes (RFC 6052
  // 64:ff9b::/96 well-known, RFC 8215 64:ff9b:1:: local-use) embed IPv4 in the
  // final 32 bits.
  const mapped = lower.match(/^(?:::(?:ffff:)?|64:ff9b::|64:ff9b:1::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  // WHATWG URL canonicalizes bracketed IPv4-mapped IPv6 into hex words
  // ([::ffff:127.0.0.1] -> ::ffff:7f00:1), so cover that form too.
  const hexMapped = lower.match(/^(?:::(?:ffff:)?|64:ff9b::|64:ff9b:1::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped && hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  const candidate = mapped ? mapped[1] : lower;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    return candidate.split('.').every(part => Number(part) <= 255) ? candidate : '';
  }
  if (/^(0x[0-9a-f]+|\d+)$/.test(candidate)) {
    const value = candidate.startsWith('0x') ? Number.parseInt(candidate, 16) : Number.parseInt(candidate, 10);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return '';
    return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  }
  return '';
}

// Fetch with manual, revalidated redirects under one absolute deadline.
// Returns the final (non-3xx) Response plus { finalUrl, hops }.
export async function guardedFetch(rawUrl, {
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  deadlineAt,
  headers = {},
  fetchImpl = fetch
} = {}) {
  const deadline = Number(deadlineAt) || Date.now() + 8000;
  let currentUrl = String(rawUrl || '').trim();
  const visited = new Set();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('request deadline exceeded');
    const rejection = rejectFetchUrl(currentUrl);
    if (rejection) throw new Error(rejection);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': DEFAULT_USER_AGENT, ...headers }
      });
    } finally {
      clearTimeout(timer);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: currentUrl, hops: hop };
    }
    response.body?.cancel?.().catch?.(() => {});
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect without a location header');
    const nextUrl = new URL(location, currentUrl).toString();
    if (visited.has(nextUrl) || nextUrl === currentUrl) throw new Error('redirect loop detected');
    visited.add(currentUrl);
    currentUrl = nextUrl;
  }
  throw new Error('too many redirects');
}

// Reads a response body up to maxBytes or the deadline, whichever comes first.
// Returns a Uint8Array of what was read (a capped read is a valid partial result).
export async function readBodyCapped(response, { maxBytes, deadlineAt, stopWhen } = {}) {
  if (!response?.body) return new Uint8Array(0);
  const deadline = Number(deadlineAt) || Date.now() + 8000;
  const cap = Number(maxBytes) || 256 * 1024;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (received < cap) {
      // The clock check alone cannot bound a stalled upstream: a reader.read() that
      // never resolves would pend past every deadline. Race each read against the
      // remaining budget and return the partial result when time runs out.
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      let timer;
      const result = await Promise.race([
        reader.read(),
        new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), remaining); })
      ]).finally(() => clearTimeout(timer));
      if (result.timedOut) break;
      const { value, done } = result;
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (typeof stopWhen === 'function' && stopWhen({ length: received, chunk: value, body: () => concatChunks(chunks, received) })) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return concatChunks(chunks, received);
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
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  const buckets = new Map();
  return request => {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const now = Date.now();
    if (buckets.size > 512) {
      for (const [bucketKey, entry] of buckets) {
        if (now >= entry.resetAt) buckets.delete(bucketKey);
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
