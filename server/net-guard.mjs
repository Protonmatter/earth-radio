// Earth Radio shared outbound network guard.
// Public-target resolution, private-address rejection, pinned DNS lookups, and
// byte-capped HTTP requests shared by the desktop proxy and metadata resolvers.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';
import { embeddedIpv4Address, isPublicIpAddress } from './public-ip-policy.mjs';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 64 * 1024;
// Deterministic identity at the shared outbound boundary; callers may override.
const DEFAULT_USER_AGENT = 'EarthRadio/0.24.0 (+https://github.com/Protonmatter/EarthRadio)';

export async function resolvePublicTarget(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only http/https stream URLs are allowed');
  if (!parsed.hostname) throw new Error('missing stream host');
  if (parsed.username || parsed.password) throw new Error('stream URL credentials are blocked');

  const hostname = normalizeHostname(parsed.hostname);
  if (isForbiddenHostname(hostname)) throw new Error('private stream hosts are blocked');
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
export async function requestLimited(streamTarget, { timeoutMs = DEFAULT_TIMEOUT_MS, deadlineAt = 0, signal, headers = {}, maxBytes = DEFAULT_MAX_BYTES, stopWhen } = {}) {
  const deadline = deadlineAt > 0 ? deadlineAt : Date.now() + timeoutMs;
  const target = typeof streamTarget === 'string'
    ? await withinDeadline(resolvePublicTarget(streamTarget), deadline, signal)
    : streamTarget;
  if (signal?.aborted) throw abortError();
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError();
  const socketTimeout = Math.min(timeoutMs, remaining);
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer;
    let request;
    let response;
    let onData;
    let onEnd;
    let onResponseError;
    let onRequestError;
    let onAbort;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (response) {
        if (onData) response.off('data', onData);
        if (onEnd) response.off('end', onEnd);
        if (onResponseError) response.off('error', onResponseError);
      }
      request?.setTimeout(0);
      request?.off('error', onRequestError);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const client = target.url.protocol === 'https:' ? https : http;
    request = client.request(target.url, {
      method: 'GET',
      lookup: createPinnedLookup(target),
      headers: withDefaultUserAgent(headers)
    }, incoming => {
      response = incoming;
      const statusCode = Number(response.statusCode || 0);
      const result = { statusCode, headers: response.headers, body: Buffer.alloc(0), truncated: false, get text() { return this.body.toString('utf8'); } };
      if (isRedirect(statusCode)) {
        onResponseError = () => settle(reject, new Error('response stream error'));
        response.on('error', onResponseError);
        response.once('close', () => settle(resolve, result));
        response.destroy();
        request.destroy();
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
      onData = chunk => {
        if (settled) return;
        const remainingBytes = Math.max(0, maxBytes - received);
        const accepted = chunk.subarray(0, remainingBytes);
        received += accepted.length;
        if (accepted.length) chunks.push(accepted);
        if (received >= maxBytes) return finish(true);
        if (typeof stopWhen === 'function' &&
            stopWhen({ length: received, chunk: accepted, headers: response.headers, body: () => Buffer.concat(chunks) })) {
          finish(true);
        }
      };
      onEnd = () => finish(false);
      onResponseError = () => settle(reject, new Error('response stream error'));
      response.on('data', onData);
      response.on('end', onEnd);
      response.on('error', onResponseError);
    });
    onRequestError = error => settle(reject, error);
    onAbort = () => request.destroy(abortError());
    deadlineTimer = setTimeout(() => request.destroy(timeoutError()), remaining);
    request.setTimeout(socketTimeout, () => request.destroy(timeoutError()));
    request.on('error', onRequestError);
    signal?.addEventListener('abort', onAbort, { once: true });
    request.end();
  });
}

// Redirect-following boundary for radio-controlled URLs. Every hop is re-resolved and
// public-target checked, while one absolute deadline covers DNS, sockets, and bodies.
export async function requestPublic(rawUrl, {
  deadlineAt = Date.now() + DEFAULT_TIMEOUT_MS,
  maxRedirects = 4,
  signal,
  resolveTarget = resolvePublicTarget,
  requestOnce = requestLimited,
  ...options
} = {}) {
  const deadline = deadlineAt > 0 ? deadlineAt : Date.now() + DEFAULT_TIMEOUT_MS;
  let currentUrl = String(rawUrl || '').trim();
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (signal?.aborted) throw abortError();
    if (visited.has(currentUrl)) throw new Error('redirect loop blocked');
    visited.add(currentUrl);
    const target = await withinDeadline(resolveTarget(currentUrl), deadline, signal);
    const response = await withinDeadline(requestOnce(target, { ...options, deadlineAt: deadline, signal }), deadline, signal);
    if (!isRedirect(response.statusCode)) {
      return { ...response, finalUrl: target.href, hops: hop };
    }
    if (hop === maxRedirects) throw new Error('redirect limit exceeded');
    const location = String(response.headers?.location || '');
    if (!location) throw new Error('redirect location missing');
    const nextUrl = new URL(location, target.href).toString();
    currentUrl = nextUrl;
  }
  throw new Error('redirect limit exceeded');
}

// Compatibility name for established callers and external integrations. The public
// API above uses requestOnce; this wrapper accepts the older performRequest injection.
export async function guardedRequest(rawUrl, options = {}) {
  const { performRequest, requestOnce, ...rest } = options;
  return requestPublic(rawUrl, { ...rest, requestOnce: requestOnce || performRequest || requestLimited });
}

export function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

export function normalizeHostname(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

export function isPrivateIp(address) {
  return !isPublicIpAddress(address);
}

export function ipv4FromMappedOrCompatibleIpv6(address) {
  return embeddedIpv4Address(address);
}

function isForbiddenHostname(hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal');
}

function timeoutError() {
  return new Error('request timeout');
}

function abortError() {
  return new Error('request aborted');
}

function withinDeadline(promise, deadlineAt, signal) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(timeoutError());
  if (signal?.aborted) return Promise.reject(abortError());
  let timer;
  let onAbort;
  const races = [Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), remaining);
  })];
  if (signal) {
    races.push(new Promise((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
    }));
  }
  return Promise.race(races).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

function withDefaultUserAgent(headers) {
  const supplied = Object.keys(headers || {}).some(name => name.toLowerCase() === 'user-agent');
  return supplied ? { ...headers } : { 'User-Agent': DEFAULT_USER_AGENT, ...headers };
}
