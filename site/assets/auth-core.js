const SESSION_KEY = 'earthRadio.auth.session.v1';
const PKCE_KEY = 'earthRadio.auth.pkce.v1';
const FLOW_PARAM = 'er_auth_flow';
const API_VERSION = '2024-01-01';
const FLOW_TTL_MS = 20 * 60 * 1000;
const MAX_FLOWS = 8;

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
  cryptoImpl = globalThis.crypto,
  eventTarget = globalThis
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
  let refreshPromise = null;
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

  eventTarget?.addEventListener?.('storage', event => {
    if (event.key !== SESSION_KEY) return;
    session = readSession();
    for (const subscriber of subscribers) subscriber(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
  });

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

  function invalidSessionError(error) {
    return [400, 401, 403].includes(Number(error?.status));
  }

  function retryableRequestError(error) {
    const status = Number(error?.status);
    return !status || status === 408 || status === 425 || status === 429 || status >= 500;
  }

  async function refreshSession() {
    const refreshSource = session;
    if (!refreshSource) return null;
    try {
      const refreshed = await request(`${authUrl}/token?grant_type=refresh_token`, {
        method: 'POST', body: { refresh_token: refreshSource.refresh_token }
      });
      if (session !== refreshSource) return session;
      return saveSession(refreshed, 'TOKEN_REFRESHED');
    } catch (error) {
      if (session !== refreshSource) return session;
      if (invalidSessionError(error)) saveSession(null, 'SIGNED_OUT');
      throw error;
    }
  }

  async function freshSession() {
    if (!session) return null;
    const expiresSoon = !session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000) + 90;
    if (!expiresSoon) return session;
    if (!refreshPromise) refreshPromise = refreshSession().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function readFlows() {
    try {
      const parsed = JSON.parse(storage.getItem(PKCE_KEY));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  async function beginPkce() {
    const pkce = await createPkce(cryptoImpl);
    const idBytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(idBytes);
    const flowId = base64Url(idBytes);
    const now = Date.now();
    const retained = Object.entries(readFlows())
      .filter(([, flow]) => now - Number(flow?.createdAt || 0) < FLOW_TTL_MS)
      .slice(-(MAX_FLOWS - 1));
    storage.setItem(PKCE_KEY, JSON.stringify(Object.fromEntries([
      ...retained,
      [flowId, { verifier: pkce.verifier, createdAt: now }]
    ])));
    return { ...pkce, flowId };
  }

  function redirectTarget() {
    const current = new URL(location.href);
    for (const key of ['code', 'error', 'error_code', 'error_description', FLOW_PARAM]) {
      current.searchParams.delete(key);
    }
    return current.href;
  }

  function redirectForFlow(target, flowId) {
    const redirect = new URL(target);
    redirect.searchParams.set(FLOW_PARAM, flowId);
    return redirect.href;
  }

  function cleanCallbackUrl() {
    if (!history?.replaceState) return;
    const current = new URL(location.href);
    for (const key of ['code', 'error', 'error_code', 'error_description', FLOW_PARAM]) current.searchParams.delete(key);
    history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);
  }

  async function exchangeCode(code, flowId) {
    const flows = readFlows();
    const verifier = flows[flowId]?.verifier;
    if (!flowId || !verifier) throw new Error('The sign-in verifier is missing. Please start sign-in again.');
    let consumeFlow = true;
    try {
      const value = await request(`${authUrl}/token?grant_type=pkce`, {
        method: 'POST', body: { auth_code: code, code_verifier: verifier }
      });
      return saveSession(value);
    } catch (error) {
      consumeFlow = !retryableRequestError(error);
      throw error;
    } finally {
      if (consumeFlow) {
        delete flows[flowId];
        if (Object.keys(flows).length) storage.setItem(PKCE_KEY, JSON.stringify(flows));
        else storage.removeItem(PKCE_KEY);
        cleanCallbackUrl();
      }
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
      if (code) return exchangeCode(code, current.searchParams.get(FLOW_PARAM));
      try { return await freshSession(); }
      catch (error) {
        if (session && !invalidSessionError(error)) return session;
        throw error;
      }
    },

    async getSession() { return freshSession(); },

    onAuthStateChange(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    async signInWithOAuth(provider, { redirectTo = redirectTarget(), scopes, queryParams = {} } = {}) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(provider)) throw new Error('Invalid identity provider.');
      const { challenge, flowId } = await beginPkce();
      const endpoint = new URL(`${authUrl}/authorize`);
      endpoint.searchParams.set('provider', provider);
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo, flowId));
      endpoint.searchParams.set('code_challenge', challenge);
      endpoint.searchParams.set('code_challenge_method', 's256');
      if (scopes) endpoint.searchParams.set('scopes', scopes);
      for (const [key, value] of Object.entries(queryParams)) endpoint.searchParams.set(key, String(value));
      location.assign(endpoint.href);
    },

    async signInWithEmail(email, { redirectTo = redirectTarget() } = {}) {
      const normalized = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.');
      const { challenge, flowId } = await beginPkce();
      const endpoint = new URL(`${authUrl}/otp`);
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo, flowId));
      await request(endpoint.href, {
        method: 'POST',
        body: { email: normalized, create_user: true, code_challenge: challenge, code_challenge_method: 's256' }
      });
    },

    async linkIdentity(provider, { redirectTo = redirectTarget(), scopes, queryParams = {} } = {}) {
      const current = await freshSession();
      if (!current) throw new Error('Sign in before linking another account.');
      const { challenge, flowId } = await beginPkce();
      const endpoint = new URL(`${authUrl}/user/identities/authorize`);
      endpoint.searchParams.set('provider', provider);
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo, flowId));
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
      try {
        return await request(`${authUrl}/user`, { accessToken: current.access_token });
      } catch (error) {
        if (invalidSessionError(error) && session === current) saveSession(null, 'SIGNED_OUT');
        throw error;
      }
    },

    async signOut() {
      const current = session;
      try {
        if (current) await request(`${authUrl}/logout`, { method: 'POST', accessToken: current.access_token });
      } catch {
        // Remote revocation is best-effort. Local sign-out and account-data cleanup must still finish offline.
      } finally {
        saveSession(null, 'SIGNED_OUT');
        storage.removeItem(PKCE_KEY);
      }
    },

    async rest(path, { expectedUserId, ...options } = {}) {
      const current = await freshSession();
      if (!current) throw new Error('Authentication required.');
      if (expectedUserId && current.user?.id !== expectedUserId) {
        const error = new Error('Account changed before the request could be sent.');
        error.code = 'ACCOUNT_CHANGED';
        throw error;
      }
      return request(`${baseUrl}/rest/v1/${path.replace(/^\//, '')}`, {
        ...options, accessToken: current.access_token
      });
    },

    async rpc(name, body, options = {}) {
      return this.rest(`rpc/${encodeURIComponent(name)}`, { ...options, method: 'POST', body });
    }
  };
}

export const authStorageKeys = Object.freeze({ session: SESSION_KEY, pkce: PKCE_KEY });
