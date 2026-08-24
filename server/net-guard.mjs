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

// Byte-capped, timeout-bounded GET against a resolved public target.
// Returns { statusCode, headers, body (Buffer), text } without following redirects.
export async function requestLimited(streamTarget, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, maxBytes = DEFAULT_MAX_BYTES, collectBody = true, stopWhen } = {}) {
  const target = typeof streamTarget === 'string' ? await resolvePublicTarget(streamTarget) : streamTarget;
  return new Promise((resolve, reject) => {
    const client = target.url.protocol === 'https:' ? https : http;
    const request = client.request(target.url, {
      method: 'GET',
      timeout: timeoutMs,
      lookup: createPinnedLookup(target),
      headers
    }, response => {
      const statusCode = Number(response.statusCode || 0);
      const result = { statusCode, headers: response.headers, body: Buffer.alloc(0), get text() { return this.body.toString('utf8'); } };
      if (isRedirect(statusCode)) {
        response.resume();
        resolve(result);
        return;
      }

      let received = 0;
      const chunks = [];
      response.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          // A capped read is still a successful partial read for stream sampling.
          response.destroy();
          request.destroy();
          result.body = collectBody ? Buffer.concat(chunks) : Buffer.alloc(0);
          result.truncated = true;
          resolve(result);
          return;
        }
        if (collectBody) chunks.push(chunk);
        if (collectBody && typeof stopWhen === 'function' && stopWhen(Buffer.concat(chunks), response.headers)) {
          response.destroy();
          request.destroy();
          result.body = Buffer.concat(chunks);
          result.truncated = true;
          resolve(result);
        }
      });
      response.on('end', () => {
        result.body = collectBody ? Buffer.concat(chunks) : Buffer.alloc(0);
        resolve(result);
      });
      response.on('error', () => {
        if (chunks.length) {
          result.body = Buffer.concat(chunks);
          result.truncated = true;
          resolve(result);
          return;
        }
        reject(new Error('response stream error'));
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timeout')));
    request.on('error', error => reject(error));
    request.end();
  });
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
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
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
  const dotted = lower.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];
  const hexadecimal = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexadecimal) return '';
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}
