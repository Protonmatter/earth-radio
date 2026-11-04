import { LIMITS } from '../../workers/rate-limit/policy.mjs';

export function quotaKind(pathname) {
  let path;
  try { path = decodeURIComponent(pathname).replace(/\/+/g, '/').replace(/\/$/, ''); } catch { return null; }
  return path === '/api/nowplaying' ? 'nowplaying' : path === '/api/track/fingerprint' ? 'fingerprint' : null;
}

export function canonicalClientIp(value) {
  const input = String(value || '').trim();
  if (!input || input.length > 64 || !/^[a-f0-9:.]+$/i.test(input)) return null;
  if (input.includes(':')) {
    try { return new URL(`http://[${input}]/`).hostname.slice(1, -1); } catch { return null; }
  }
  const parts = input.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? parts.map(Number).join('.') : null;
}

export async function quotaObjectName(scope, clientIp) {
  const ip = canonicalClientIp(clientIp);
  if (!['production', 'preview'].includes(scope) || !ip) throw new Error('Missing trusted request identity');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}\0${ip}`));
  return `v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function enforceMetadataQuota(context) {
  const { request, env } = context;
  const url = new URL(request.url), kind = quotaKind(url.pathname);
  if (!kind) return failure(404, 'not found');
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405, 'method not allowed');
  let timer, decision;
  try {
    if (typeof env?.METADATA_LIMITS?.getByName !== 'function') throw new Error('Missing quota binding');
    // Cloudflare supplies/overwrites this header. Never use visitor-controlled X-Forwarded-For.
    const name = await quotaObjectName(env.METADATA_LIMIT_SCOPE, request.headers.get('CF-Connecting-IP'));
    decision = await Promise.race([
      env.METADATA_LIMITS.getByName(name).check(kind),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Quota deadline exceeded')), 3000); })
    ]);
    if (typeof decision?.allowed !== 'boolean' || !Number.isInteger(decision.remaining) || decision.remaining < 0 || decision.remaining > LIMITS[kind] ||
        !Number.isInteger(decision.retryAfter) || decision.retryAfter < 0 || decision.retryAfter > 60) throw new Error('Invalid quota response');
  } catch { return failure(503, 'metadata rate control unavailable', 60); }
  finally { clearTimeout(timer); }
  if (!decision.allowed) return failure(429, 'rate limit exceeded', Math.max(1, decision.retryAfter));
  const downstream = await context.next();
  const response = new Response(downstream.body, downstream);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('ratelimit-limit', String(LIMITS[kind]));
  response.headers.set('ratelimit-remaining', String(decision.remaining));
  return response;
}

function failure(status, error, retryAfter = 0) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (retryAfter) headers['retry-after'] = String(retryAfter);
  if (status === 405) headers.allow = 'GET, HEAD';
  return new Response(JSON.stringify({ error }), { status, headers });
}
