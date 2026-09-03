const SESSION_KEY = 'earthRadio.auth.session.v1';
const PKCE_KEY = 'earthRadio.auth.pkce.v1';
const LAST_FLOW_KEY = 'earthRadio.auth.pkce.last.v1';
const COOKIE_NAME = 'er_pkce_v1';
const FLOW_PARAM = 'er_auth_flow';
const API_VERSION = '2024-01-01';
const FLOW_TTL_MS = 20 * 60 * 1000;

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function createVerifier(cryptoImpl) {
  if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle) {
    throw new Error('Secure WebCrypto support is required for sign-in.');
  }
  const random = new Uint8Array(32);
  cryptoImpl.getRandomValues(random);
  return base64Url(random);
}

async function challengeFor(cryptoImpl, verifier) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function userFromAccessToken(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    const id = String(claims?.sub || '').trim();
    return id ? { id, email: claims.email || claims.email_address || undefined } : null;
  } catch {
    return null;
  }
}

function normalizeSession(value) {
  if (!value?.access_token || !value?.refresh_token) return null;
  const expiresAt = Number(value.expires_at) || Math.floor(Date.now() / 1000) + Number(value.expires_in || 0);
  const user = value.user?.id ? value.user : userFromAccessToken(value.access_token);
  return { ...value, ...(user ? { user } : {}), expires_at: expiresAt };
}

function parseFlowMap(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function mergeFlowMaps(...maps) {
  const merged = {};
  for (const map of maps) {
    for (const [flowId, flow] of Object.entries(map || {})) {
      if (!flow?.verifier) continue;
      const existing = merged[flowId];
      if (!existing || Number(flow.createdAt || 0) >= Number(existing.createdAt || 0)) {
        merged[flowId] = flow;
      }
    }
  }
  return merged;
}

function liveFlowEntries(flows, now = Date.now()) {
  return Object.entries(flows || {}).filter(([, flow]) => (
    flow?.verifier && now - Number(flow.createdAt || 0) < FLOW_TTL_MS
  ));
}

function readStore(store, key) {
  try { return store?.getItem?.(key) ?? null; }
  catch { return null; }
}

function writeStore(store, key, value) {
  try {
    if (!store) return;
    if (value == null) store.removeItem?.(key);
    else store.setItem?.(key, value);
  } catch {}
}

function createDocumentCookieJar(locationRef) {
  return {
    read() {
      if (typeof document === 'undefined') return null;
      try {
        const prefix = `${COOKIE_NAME}=`;
        const match = String(document.cookie || '').split(/;\s*/).find(part => part.startsWith(prefix));
        if (!match) return null;
        return decodeURIComponent(match.slice(prefix.length));
      } catch { return null; }
    },
    write(value, maxAgeSec) {
      if (typeof document === 'undefined') return;
      try {
        const secure = String(locationRef?.protocol || '') === 'https:' ? '; Secure' : '';
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
      } catch {}
    },
    clear() {
      if (typeof document === 'undefined') return;
      try {
        const secure = String(locationRef?.protocol || '') === 'https:' ? '; Secure' : '';
        document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      } catch {}
    }
  };
}

export function createAuthClient({
  url,
  publishableKey,
  storage = globalThis.localStorage,
  sessionStorageImpl = globalThis.sessionStorage,
  cookieJar,
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
  const cookies = cookieJar || createDocumentCookieJar(location);
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
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(20000)
      : undefined;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method,
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken || publishableKey}`,
          'X-Supabase-Api-Version': API_VERSION,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json;charset=UTF-8' }),
          ...headers
        },
        ...(signal ? { signal } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        const timeout = new Error('Sign-in timed out. Please try again.');
        timeout.status = 408;
        throw timeout;
      }
      throw error;
    }
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
    return mergeFlowMaps(
      parseFlowMap(cookies.read()),
      parseFlowMap(readStore(storage, PKCE_KEY)),
      parseFlowMap(readStore(sessionStorageImpl, PKCE_KEY))
    );
  }

  function persistFlows(flows, lastFlowId) {
    const live = Object.fromEntries(liveFlowEntries(flows));
    const payload = Object.keys(live).length ? JSON.stringify(live) : null;
    writeStore(storage, PKCE_KEY, payload);
    writeStore(sessionStorageImpl, PKCE_KEY, payload);
    writeStore(sessionStorageImpl, LAST_FLOW_KEY, lastFlowId || null);
    try {
      if (payload) cookies.write(payload, Math.ceil(FLOW_TTL_MS / 1000));
      else cookies.clear();
    } catch {}
  }

  function resolvePkceFlow(requestedFlowId) {
    const live = Object.fromEntries(liveFlowEntries(readFlows()));
    if (requestedFlowId) {
      if (live[requestedFlowId]?.verifier) {
        return { flowId: requestedFlowId, verifier: live[requestedFlowId].verifier, flows: live };
      }
      return { flowId: requestedFlowId, verifier: null, flows: live };
    }
    const lastFlowId = readStore(sessionStorageImpl, LAST_FLOW_KEY);
    if (lastFlowId && live[lastFlowId]?.verifier) {
      return { flowId: lastFlowId, verifier: live[lastFlowId].verifier, flows: live };
    }
    const remaining = liveFlowEntries(live);
    if (remaining.length === 1) {
      const [flowId, flow] = remaining[0];
      return { flowId, verifier: flow.verifier, flows: live };
    }
    return { flowId: null, verifier: null, flows: live };
  }

  async function beginPkce() {
    const verifier = createVerifier(cryptoImpl);
    const idBytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(idBytes);
    const flowId = base64Url(idBytes);
    persistFlows({
      [flowId]: { verifier, createdAt: Date.now() }
    }, flowId);
    const challenge = await challengeFor(cryptoImpl, verifier);
    return { verifier, challenge, flowId };
  }

  function allowlistedRedirect(target) {
    const originRoot = `${location.origin}/`;
    try {
      const redirect = new URL(target, location.origin);
      if (redirect.origin !== location.origin) return originRoot;
    } catch {
      return originRoot;
    }
    return originRoot;
  }

  function redirectTarget() {
    return allowlistedRedirect(location.href);
  }

  function redirectForFlow(target) {
    return allowlistedRedirect(target);
  }

  function cleanCallbackUrl() {
    if (!history?.replaceState) return;
    const current = new URL(location.href);
    for (const key of ['code', 'error', 'error_code', 'error_description', FLOW_PARAM]) current.searchParams.delete(key);
    history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);
  }

  async function exchangeCode(code, requestedFlowId) {
    const { flowId, verifier, flows } = resolvePkceFlow(requestedFlowId);
    if (!verifier) {
      cleanCallbackUrl();
      throw new Error('The sign-in verifier is missing. Please start sign-in again.');
    }
    let consumeFlow = true;
    try {
      const value = await request(`${authUrl}/token?grant_type=pkce`, {
        method: 'POST', body: { auth_code: code, code_verifier: verifier }
      });
      const next = saveSession(value);
      if (!next?.user?.id) throw new Error('Sign-in did not return a user. Please try again.');
      return next;
    } catch (error) {
      consumeFlow = !retryableRequestError(error);
      throw error;
    } finally {
      if (consumeFlow) {
        delete flows[flowId];
        persistFlows(flows, null);
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
      const requestedFlowId = current.searchParams.get(FLOW_PARAM);
      if (code) return exchangeCode(code, requestedFlowId);
      try { return await freshSession(); }
      catch (error) {
        if (session && !invalidSessionError(error)) return session;
        throw error;
      }
    },

    async getSession() { return freshSession(); },

    async listExternalProviders() {
      try {
        const settings = await request(`${authUrl}/settings`);
        if (!settings?.external || typeof settings.external !== 'object') return null;
        return settings.external;
      } catch {
        return null;
      }
    },

    onAuthStateChange(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    async signInWithOAuth(provider, { redirectTo = redirectTarget(), scopes, queryParams = {} } = {}) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(provider)) throw new Error('Invalid identity provider.');
      const { challenge } = await beginPkce();
      const endpoint = new URL(`${authUrl}/authorize`);
      endpoint.searchParams.set('provider', provider);
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo));
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
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo));
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
      endpoint.searchParams.set('redirect_to', redirectForFlow(redirectTo));
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
      let signedOut = false;
      try {
        if (current) await request(`${authUrl}/logout`, { method: 'POST', accessToken: current.access_token });
      } catch {
        // Remote revocation is best-effort. Local sign-out and account-data cleanup must still finish offline.
      } finally {
        // A different tab may have installed a replacement session while revocation was in flight.
        if (session === current) {
          saveSession(null, 'SIGNED_OUT');
          persistFlows({}, null);
          signedOut = true;
        } else if (!session) {
          // Another tab completed the same sign-out while this request was in flight.
          signedOut = true;
        }
      }
      return signedOut;
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

export const authStorageKeys = Object.freeze({
  session: SESSION_KEY,
  pkce: PKCE_KEY,
  pkceLast: LAST_FLOW_KEY,
  pkceCookie: COOKIE_NAME
});
