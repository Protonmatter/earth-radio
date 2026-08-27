import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAuthClient } from '../site/assets/auth-core.js';

const required = process.env.AUTH_INTEGRATION === '1';
const hostedAuthUrl = 'https://earth-radio-ci.supabase.co';
const siteUrl = 'https://earth-radio.pages.dev/';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function parseEnv(text) {
  const values = {};
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadLocalStack() {
  const fromFile = process.env.SUPABASE_STATUS_ENV
    ? parseEnv(await readFile(process.env.SUPABASE_STATUS_ENV, 'utf8'))
    : {};
  const url = process.env.SUPABASE_URL || process.env.API_URL || fromFile.SUPABASE_URL || fromFile.API_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLISHABLE_KEY
    || fromFile.SUPABASE_PUBLISHABLE_KEY || fromFile.PUBLISHABLE_KEY;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || fromFile.SUPABASE_ANON_KEY || fromFile.ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
    || fromFile.SUPABASE_SERVICE_ROLE_KEY || fromFile.SERVICE_ROLE_KEY
    || process.env.SECRET_KEY || fromFile.SECRET_KEY;
  const mail = process.env.SUPABASE_MAILPIT_URL || process.env.MAILPIT_URL
    || process.env.SUPABASE_INBUCKET_URL || process.env.INBUCKET_URL
    || fromFile.SUPABASE_MAILPIT_URL || fromFile.MAILPIT_URL
    || fromFile.SUPABASE_INBUCKET_URL || fromFile.INBUCKET_URL
    || 'http://127.0.0.1:54324';
  return { url, publishable, anon, service, mail, apikey: publishable || anon };
}

function localFetch(apiUrl, anonKey) {
  const local = new URL(apiUrl);
  return async (url, init = {}) => {
    const next = new URL(url);
    next.protocol = local.protocol;
    next.host = local.host;
    const headers = { ...(init.headers || {}), apikey: anonKey };
    return fetch(next.href, { ...init, headers });
  };
}

function decodeEntities(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function extractVerifyUrl(body) {
  const text = decodeEntities(typeof body === 'string' ? body : JSON.stringify(body || {}));
  const match = text.match(/https?:\/\/[^"'\\\s]+\/auth\/v1\/verify\?[^"'\\\s]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : null;
}

async function readOkJson(response) {
  const text = await response.text();
  assert.equal(response.ok, true, text.slice(0, 500));
  return JSON.parse(text);
}

async function listMailpitMessages(mailUrl) {
  const response = await fetch(new URL('/api/v1/messages', mailUrl));
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

async function readMailpitMessage(mailUrl, id) {
  const response = await fetch(new URL(`/api/v1/message/${encodeURIComponent(id)}`, mailUrl));
  if (!response.ok) return '';
  const payload = await response.json();
  return [payload?.Text, payload?.HTML, JSON.stringify(payload)].filter(Boolean).join('\n');
}

function messageRecipients(message) {
  const rows = [...(message?.To || []), ...(message?.Cc || []), ...(message?.Bcc || [])];
  return rows.map(entry => String(entry?.Address || entry?.address || '').toLowerCase());
}

async function waitForVerifyUrl(mailUrl, email, timeoutMs = 20000) {
  const started = Date.now();
  const expected = String(email || '').toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const messages = await listMailpitMessages(mailUrl);
    for (const message of messages) {
      if (expected && !messageRecipients(message).includes(expected)) continue;
      const body = await readMailpitMessage(mailUrl, message.ID || message.id);
      const verifyUrl = extractVerifyUrl(body);
      if (verifyUrl) return verifyUrl;
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Mailpit did not receive a magic link for ${email}`);
}

async function followUntilCode(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 8; hop += 1) {
    const parsed = new URL(current);
    const code = parsed.searchParams.get('code');
    if (code) return { href: current, code };
    const response = await fetch(current, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Auth verify stopped without a PKCE code (HTTP ${response.status}).`);
    }
    current = new URL(location, current).href;
  }
  throw new Error('Auth verify exceeded redirect hops without a PKCE code.');
}

const stack = await loadLocalStack();
const skip = !required && !stack.url;

test('local GoTrue completes the production PKCE email workflow without a flow id on redirect_to', {
  skip: skip ? 'Local Supabase Auth is not running. CI sets AUTH_INTEGRATION=1 after supabase start.' : false
}, async () => {
  if (required) {
    assert.ok(stack.url, 'SUPABASE_URL is required when AUTH_INTEGRATION=1');
    assert.ok(stack.apikey, 'PUBLISHABLE_KEY or ANON_KEY is required when AUTH_INTEGRATION=1');
  }
  const id = randomUUID();
  const localPart = `ci-${id}`;
  const email = `${localPart}@earth-radio.test`;
  const storage = memoryStorage();
  const sessionStore = memoryStorage();
  let currentHref = siteUrl;
  const publishableKey = String(stack.publishable || '').startsWith('sb_publishable_')
    ? stack.publishable
    : 'sb_publishable_local_ci_placeholder';
  const client = createAuthClient({
    url: hostedAuthUrl,
    publishableKey,
    storage,
    sessionStorageImpl: sessionStore,
    location: {
      get href() { return currentHref; },
      origin: 'https://earth-radio.pages.dev',
      pathname: '/',
      assign() {}
    },
    history: { replaceState(_state, _title, url) { currentHref = `https://earth-radio.pages.dev${url}`; } },
    fetchImpl: localFetch(stack.url, stack.apikey)
  });

  await client.signInWithEmail(email, { redirectTo: siteUrl });
  const flows = JSON.parse(storage.getItem('earthRadio.auth.pkce.v1'));
  assert.equal(Object.keys(flows).length, 1);

  const verifyUrl = await waitForVerifyUrl(stack.mail, email);
  const callback = await followUntilCode(verifyUrl);
  assert.equal(new URL(callback.href).searchParams.get('er_auth_flow'), null);
  currentHref = callback.href;

  const session = await client.initialize();
  assert.ok(session?.access_token);
  assert.ok(session.user?.id);
  assert.equal(storage.getItem('earthRadio.auth.pkce.v1'), null);

  const documents = await client.rest('user_config_documents?select=document_key,revision');
  assert.ok(Array.isArray(documents));
});

test('local Auth issues unique-user JWTs that RLS accepts and fences', {
  skip: skip ? 'Local Supabase Auth is not running. CI sets AUTH_INTEGRATION=1 after supabase start.' : false
}, async () => {
  if (required) {
    assert.ok(stack.url, 'SUPABASE_URL is required when AUTH_INTEGRATION=1');
    assert.ok(stack.apikey, 'PUBLISHABLE_KEY or ANON_KEY is required when AUTH_INTEGRATION=1');
    assert.ok(stack.service, 'SERVICE_ROLE_KEY is required when AUTH_INTEGRATION=1');
  }
  const userId = randomUUID();
  const email = `rls-${userId}@earth-radio.test`;
  const password = `Ci-${userId.slice(0, 8)}-Pass9`;
  const created = await fetch(new URL('/auth/v1/admin/users', stack.url), {
    method: 'POST',
    headers: {
      apikey: stack.service,
      Authorization: `Bearer ${stack.service}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: userId,
      email,
      password,
      email_confirm: true
    })
  });
  await readOkJson(created);

  const tokenResponse = await fetch(new URL('/auth/v1/token?grant_type=password', stack.url), {
    method: 'POST',
    headers: {
      apikey: stack.apikey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const token = await readOkJson(tokenResponse);

  const own = await fetch(new URL('/rest/v1/user_config_documents?select=document_key', stack.url), {
    headers: {
      apikey: stack.apikey,
      Authorization: `Bearer ${token.access_token}`
    }
  });
  const ownBody = await own.text();
  assert.equal(own.status, 200, ownBody);
  assert.deepEqual(JSON.parse(ownBody), []);

  const anon = await fetch(new URL('/rest/v1/user_config_documents?select=document_key', stack.url), {
    headers: { apikey: stack.apikey }
  });
  assert.ok([401, 403].includes(anon.status), `anonymous REST should be rejected, got ${anon.status}`);
});
