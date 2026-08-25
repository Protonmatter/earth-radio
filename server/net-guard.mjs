// Earth Radio shared outbound network guard.
// Public-target resolution, private-address rejection, pinned DNS lookups, and
// byte-capped HTTP requests shared by the desktop proxy and metadata resolvers.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
// Deterministic identity at the shared outbound boundary; callers may override.
const DEFAULT_USER_AGENT = 'EarthRadio/0.24.0 (+https://github.com/Protonmatter/EarthRadio)';

export async function resolvePublicTarget(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only http/https stream URLs are allowed');
  if (!parsed.hostname) throw new Error('missing stream host');

  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('private stream IPs are blocked');
    return { href: parsed.toString(), url: parsed, hostname, address: hostname, family: net.isIP(hostname) };
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length) throw new Error('stream host did not resolve');
  if (records.some(record => isPrivateIp(record.address))) throw new Error('stream host resolves to a private address');
  const record = records[0];
  return { href: parsed.toString(), url: parsed, hostname, address: record.address, family: record.family };
}

export function createPinnedLookup(target) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (!cb) return;
    if (normalizeHostname(hostname) === target.hostname) {
      if (isPrivateIp(target.address)) {
        cb(new Error('stream host resolves to a private address'));
        return;
      }
      cb(null, target.address, target.family);
      return;
    }
    dns.lookup(normalizeHostname(hostname), { all: true, verbatim: false })
      .then(records => {
        if (!records.length) throw new Error('stream host did not resolve');
        if (records.some(record => isPrivateIp(record.address))) throw new Error('stream host resolves to a private address');
        cb(null, records[0].address, records[0].family);
      })
      .catch(error => cb(error));
  };
}

// Byte-capped, timeout-bounded GET against a resolved public target. Returns
// { statusCode, headers, body (Buffer), text, truncated } without following redirects.
// Hitting the byte cap (or a stopWhen early-stop) is a successful partial read with
// truncated: true — endless live streams are the normal case here, not an error.
// stopWhen receives { length, chunk, headers, body() } where body() concatenates the
// buffered bytes on demand; return true to stop reading.
export async function requestLimited(streamTarget, { timeoutMs = DEFAULT_TIMEOUT_MS, deadlineAt = 0, headers = {}, maxBytes = DEFAULT_MAX_BYTES, stopWhen } = {}) {
  const target = typeof streamTarget === 'string' ? await resolvePublicTarget(streamTarget) : streamTarget;
  // The socket timeout below resets on activity; the wall-clock budget must not — a
  // trickling upstream can otherwise pin the request (and its caller) indefinitely.
  const budgetMs = Math.max(1, Math.min(timeoutMs, deadlineAt > 0 ? deadlineAt - Date.now() : Number.POSITIVE_INFINITY));
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer = null;
    // Replaced once a body is streaming so the deadline yields a usable partial read.
    let onDeadline = () => settle(reject, new Error('request deadline exceeded'));
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      fn(value);
    };
    const client = target.url.protocol === 'https:' ? https : http;
    const request = client.request(target.url, {
      method: 'GET',
      timeout: budgetMs,
      lookup: createPinnedLookup(target),
      headers: { 'User-Agent': DEFAULT_USER_AGENT, ...headers }
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      const result = { statusCode, headers: response.headers, body: Buffer.alloc(0), truncated: false, get text() { return this.body.toString('utf8'); } };
      if (isRedirect(statusCode)) {
        response.resume();
        settle(resolve, result);
        return;
      }

      let received = 0;
      const chunks = [];
      const finish = truncated => {
        result.body = Buffer.concat(chunks);
        result.truncated = truncated;
        if (truncated) {
          response.destroy();
          request.destroy();
        }
        settle(resolve, result);
      };
      response.on('data', chunk => {
        if (settled) return;
        received += chunk.length;
        chunks.push(chunk);
        if (received >= maxBytes) return finish(true);
        if (typeof stopWhen === 'function' &&
            stopWhen({ length: received, chunk, headers: response.headers, body: () => Buffer.concat(chunks) })) {
          finish(true);
        }
      });
      response.on('end', () => finish(false));
      response.on('error', () => {
        // A torn read with bytes in hand is still a usable partial result.
        if (chunks.length) finish(true);
        else settle(reject, new Error('response stream error'));
      });
      onDeadline = () => {
        if (chunks.length) finish(true);
        else {
          response.destroy();
          request.destroy();
          settle(reject, new Error('request deadline exceeded'));
        }
      };
    });
    deadlineTimer = setTimeout(() => onDeadline(), budgetMs);
    request.setTimeout(budgetMs, () => request.destroy(new Error('request timeout')));
    request.on('error', error => settle(reject, error));
    request.end();
  });
}

// Redirect-following variant of requestLimited. Every hop is re-validated through the
// public-target policy (the initial URL check is not authorization for later hops),
// the hop count is capped, and the whole chain shares one absolute wall-clock
// deadline. resolveTarget/performRequest are injectable for tests.
export async function guardedRequest(rawUrl, {
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  deadlineAt = 0,
  resolveTarget = resolvePublicTarget,
  performRequest = requestLimited,
  ...options
} = {}) {
  const deadline = deadlineAt > 0 ? deadlineAt : Date.now() + timeoutMs;
  let currentUrl = String(rawUrl || '').trim();
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (Date.now() >= deadline) throw new Error('request deadline exceeded');
    const target = await resolveTarget(currentUrl);
    const response = await performRequest(target, { ...options, timeoutMs, deadlineAt: deadline });
    if (!isRedirect(response.statusCode)) {
      return { ...response, statusCode: response.statusCode, finalUrl: target.href, hops: hop };
    }
    const location = response.headers?.location;
    if (!location) throw new Error('redirect without a location header');
    const nextUrl = new URL(location, target.href).toString();
    if (visited.has(nextUrl) || nextUrl === currentUrl) throw new Error('redirect loop detected');
    visited.add(currentUrl);
    currentUrl = nextUrl;
  }
  throw new Error('too many redirects');
}

export function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

export function normalizeHostname(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

export function isPrivateIp(address) {
  const embeddedIpv4 = ipv4FromMappedOrCompatibleIpv6(address);
  if (embeddedIpv4) return isPrivateIp(embeddedIpv4);
  const kind = net.isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    // Reserved/documentation networks fail closed: TEST-NET-1/2/3 and the
    // 198.18.0.0/15 benchmarking range are never legitimate stream hosts.
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }
  if (kind === 6) {
    const lower = address.toLowerCase().split('%', 1)[0];
    const firstWord = Number.parseInt(lower.split(':').find(Boolean) || '0', 16);
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
      (Number.isFinite(firstWord) && (firstWord & 0xffc0) === 0xfe80) || lower.startsWith('ff');
  }
  return false;
}

export function ipv4FromMappedOrCompatibleIpv6(address) {
  const lower = String(address || '').toLowerCase().split('%', 1)[0];
  if (!lower.includes(':')) return '';
  // Mapped (::ffff:), compatible (::), and NAT64 translation prefixes — the RFC 6052
  // well-known 64:ff9b::/96 and RFC 8215 local-use 64:ff9b:1:: form — all embed an
  // IPv4 address in the final 32 bits; a NAT64 route would deliver it to that IPv4.
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::|64:ff9b:1::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];
  const hexadecimal = lower.match(/^(?:::(?:ffff:)?|64:ff9b::|64:ff9b:1::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexadecimal) return '';
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}
