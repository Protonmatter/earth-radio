const SESSION_KEY = 'earthRadio.auth.session.v1';
const PKCE_KEY = 'earthRadio.auth.pkce.v1';
const API_VERSION = '2024-01-01';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function createPkce(cryptoImpl) {
  if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle) {
    throw new Error('Secure WebCrypto support is required for sign-in.');
  }
  const random = new Uint8Array(32);
  cryptoImpl.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function normalizeSession(value) {
  if (!value?.access_token || !value?.refresh_token) return null;
  const expiresAt = Number(value.expires_at) || Math.floor(Date.now() / 1000) + Number(value.expires_in || 0);
  return { ...value, expires_at: expiresAt };
}

export function createAuthClient({
  url,
  publishableKey,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  location = globalThis.location,
  history = globalThis.history,
  cryptoImpl = globalThis.crypto
}) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(url || ''))) {
    throw new Error('A valid Supabase project URL is required.');
  }
  if (!String(publishableKey || '').startsWith('sb_publishable_')) {
    throw new Error('A Supabase publishable key is required.');
  }
  if (!fetchImpl) throw new Error('Fetch is required.');

  const baseUrl = url.replace(/\/$/, '');
  const authUrl = `${baseUrl}/auth/v1`;
  let session = readSession();
  const subscribers = new Set();

  function readSession() {
    try { return normalizeSession(JSON.parse(storage.getItem(SESSION_KEY))); }
    catch { return null; }
  }

  function saveSession(next, event = 'SIGNED_IN') {
    session = normalizeSession(next);
    if (session) storage.setItem(SESSION_KEY, JSON.stringify(session));
    else storage.removeItem(SESSION_KEY);
    for (const subscriber of subscribers) subscriber(event, session);
    return session;
  }

  async function request(endpoint, { method = 'GET', body, accessToken, headers = {} } = {}) {
    const response = await fetchImpl(endpoint, {
      method,
      headers: {
        apikey: publishableKey,
        'X-Supabase-Api-Version': API_VERSION,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json;charset=UTF-8' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const contentType = response.headers?.get?.('content-type') || '';
    const payload = contentType.includes('json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.code || payload?.error_code;
      throw error;
    }
    return payload;
  }

  async function freshSession() {
    if (!session) return null;
    const expiresSoon = !session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000) + 90;
    if (!expiresSoon) return session;
    try {
      const refreshed = await request(`${authUrl}/token?grant_type=refresh_token`, {
        method: 'POST', body: { refresh_token: session.refresh_token }
      });
      return saveSession(refreshed, 'TOKEN_REFRESHED');
    } catch (error) {
      saveSession(null, 'SIGNED_OUT');
      throw error;
    }
  }

  async function beginPkce() {
    const pkce = await createPkce(cryptoImpl);
    storage.setItem(PKCE_KEY, pkce.verifier);
    return pkce;
  }

  function redirectTarget() {
    return `${location.origin}${location.pathname || '/'}`;
  }

  function cleanCallbackUrl() {
    if (!history?.replaceState) return;
    const current = new URL(location.href);
    for (const key of ['code', 'error', 'error_code', 'error_description']) current.searchParams.delete(key);
    history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);
  }

  async function exchangeCode(code) {
    const verifier = storage.getItem(PKCE_KEY);
    if (!verifier) throw new Error('The sign-in verifier is missing. Please start sign-in again.');
    try {
      const value = await request(`${authUrl}/token?grant_type=pkce`, {
        method: 'POST', body: { auth_code: code, code_verifier: verifier }
      });
      return saveSession(value);
    } finally {
      storage.removeItem(PKCE_KEY);
      cleanCallbackUrl();
    }
  }

  return {
    async initialize() {
      const current = new URL(location.href);
      if (current.searchParams.get('error')) {
        const message = current.searchParams.get('error_description') || current.searchParams.get('error');
        cleanCallbackUrl();
        throw new Error(message);
      }
      const code = current.searchParams.get('code');
      return code ? exchangeCode(code) : freshSession();
    },

    async getSession() { return freshSession(); },

    onAuthStateChange(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    async signInWithOAuth(provider, { redirectTo = redirectTarget(), scopes, queryParams = {} } = {}) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(provider)) throw new Error('Invalid identity provider.');
      const { challenge } = await beginPkce();
      const endpoint = new URL(`${authUrl}/authorize`);
      endpoint.searchParams.set('provider', provider);
      endpoint.searchParams.set('redirect_to', redirectTo);
      endpoint.searchParams.set('code_challenge', challenge);
      endpoint.searchParams.set('code_challenge_method', 's256');
      if (scopes) endpoint.searchParams.set('scopes', scopes);
      for (const [key, value] of Object.entries(queryParams)) endpoint.searchParams.set(key, String(value));
      location.assign(endpoint.href);
    },

    async signInWithEmail(email, { redirectTo = redirectTarget() } = {}) {
      const normalized = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.');
      const { challenge } = await beginPkce();
      const endpoint = new URL(`${authUrl}/otp`);
      endpoint.searchParams.set('redirect_to', redirectTo);
      await request(endpoint.href, {
        method: 'POST',
        body: { email: normalized, create_user: true, code_challenge: challenge, code_challenge_method: 's256' }
      });
    },

    async linkIdentity(provider, { redirectTo = redirectTarget(), scopes, queryParams = {} } = {}) {
      const current = await freshSession();
      if (!current) throw new Error('Sign in before linking another account.');
      const { challenge } = await beginPkce();
      const endpoint = new URL(`${authUrl}/user/identities/authorize`);
      endpoint.searchParams.set('provider', provider);
      endpoint.searchParams.set('redirect_to', redirectTo);
      endpoint.searchParams.set('code_challenge', challenge);
      endpoint.searchParams.set('code_challenge_method', 's256');
      endpoint.searchParams.set('skip_http_redirect', 'true');
      if (scopes) endpoint.searchParams.set('scopes', scopes);
      for (const [key, value] of Object.entries(queryParams)) endpoint.searchParams.set(key, String(value));
      const result = await request(endpoint.href, { accessToken: current.access_token });
      if (!result?.url) throw new Error('The identity provider did not return a link URL.');
      location.assign(result.url);
    },

    async getUser() {
      const current = await freshSession();
      if (!current) return null;
      return request(`${authUrl}/user`, { accessToken: current.access_token });
    },

    async signOut() {
      const current = session;
      try {
        if (current) await request(`${authUrl}/logout`, { method: 'POST', accessToken: current.access_token });
      } finally {
        saveSession(null, 'SIGNED_OUT');
        storage.removeItem(PKCE_KEY);
      }
    },

    async rest(path, options = {}) {
      const current = await freshSession();
      if (!current) throw new Error('Authentication required.');
      return request(`${baseUrl}/rest/v1/${path.replace(/^\//, '')}`, {
        ...options, accessToken: current.access_token
      });
    },

    async rpc(name, body) {
      return this.rest(`rpc/${encodeURIComponent(name)}`, { method: 'POST', body });
    }
  };
}

export const authStorageKeys = Object.freeze({ session: SESSION_KEY, pkce: PKCE_KEY });
