import { createAuthClient } from '../site/assets/auth-core.js';
import { beginAuthCallback } from './auth-callback.mjs';

export const AUTH_OPERATIONS = Object.freeze(['initialize', 'session', 'providers', 'user', 'signIn', 'link', 'email', 'cancel', 'signOut', 'readDocuments', 'upsertDocument']);
const READ_PATH = 'user_config_documents?select=document_key,value,revision,deleted_at&order=document_key';
const DOCUMENT_LIMITS = Object.freeze({ favorites: 8388608, recents: 1048576, preferences: 65536 });
export const AUTH_MAX_REQUEST_BYTES = 9 * 1024 * 1024;
export class PublicAuthError extends Error {
  constructor(message, code = 'AUTH_FAILED', status = 0) { super(message); this.code = code; this.status = status; }
}
function invalid() { throw new PublicAuthError('Invalid account operation.', 'INVALID_REQUEST'); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}
function profile(user) {
  if (!user?.id) return null;
  return { id: String(user.id).slice(0, 128), email: String(user.email || '').slice(0, 320),
    identities: (Array.isArray(user.identities) ? user.identities : []).slice(0, 10)
      .filter(identity => ['google', 'github', 'email'].includes(identity.provider)).map(identity => ({ provider: identity.provider })) };
}
function displaySession(session) {
  const user = profile(session?.user);
  return user ? { user, expires_at: Number(session.expires_at) || 0 } : null;
}
function publicFailure(error) {
  if (error instanceof PublicAuthError) return error;
  if (error?.code === 'ACCOUNT_CHANGED') return new PublicAuthError('Account changed. Please try again.', 'ACCOUNT_CHANGED');
  if (Number(error?.status) === 409) return new PublicAuthError('Configuration changed on another device. Retrying sync.', 'CONFLICT', 409);
  if (Number(error?.status) === 429) return new PublicAuthError('Too many requests. Wait a moment and try again.', 'RATE_LIMITED', 429);
  return new PublicAuthError('Account request failed. Check your connection and try again.');
}

export function createDesktopAuthManager({ config, vault, openExternal, fetchImpl = globalThis.fetch }) {
  let flow = null, generation = 0, closed = false, notification = 0, persistenceFailed = false;
  const listeners = new Set();
  const base = new URL(config.url);
  function emit(event, session, message) {
    const payload = { event, session: displaySession(session), ...(message ? { message } : {}) };
    for (const listener of listeners) listener(payload);
  }
  async function guardedFetch(url, init) {
    const endpoint = new URL(url);
    if (endpoint.origin !== base.origin || endpoint.username || endpoint.password ||
        !['/auth/v1/', '/rest/v1/'].some(prefix => endpoint.pathname.startsWith(prefix))) invalid();
    const response = await fetchImpl(endpoint.href, { ...init, redirect: 'error' });
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 10 * 1024 * 1024) throw new Error('Oversized account response.');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  }
  const client = createAuthClient({ ...config, storage: vault.storage, sessionStorageImpl: vault.storage,
    cookieJar: { read: () => null, write() {}, clear() {} }, eventTarget: null, fetchImpl: guardedFetch,
    location: { origin: base.origin, href: `${base.origin}/`, async assign(raw) {
      const endpoint = new URL(raw);
      const allowed = endpoint.origin === base.origin && endpoint.pathname === '/auth/v1/authorize';
      // Linking returns a provider URL from Auth. Only the two fixed provider
      // authorization endpoints are accepted; renderer input never selects it.
      const provider = (endpoint.origin === 'https://accounts.google.com' && ['/o/oauth2/v2/auth', '/o/oauth2/auth'].includes(endpoint.pathname)) ||
        (endpoint.origin === 'https://github.com' && endpoint.pathname === '/login/oauth/authorize');
      if (!flow || closed || (!allowed && !provider) || endpoint.username || endpoint.password) invalid();
      await openExternal(endpoint.href);
    } }, resolveRedirect() {
      if (!flow || closed) throw new PublicAuthError('Start sign-in again.', 'CANCELED');
      return flow.url;
    } });

  client.onAuthStateChange((event, session) => {
    const current = ++notification;
    void vault.flush().then(() => {
      if (!closed && current === notification) emit(event, session);
    }).catch(() => {
      persistenceFailed = true;
      if (!closed && current === notification) emit('AUTH_ERROR', null, 'Could not securely save sign-in. Unlock your keychain and restart Earth Radio.');
    });
  });

  async function cancel() {
    generation++;
    client.cancelPendingSignIn();
    const previous = flow;
    flow = null;
    await previous?.cancel();
  }
  async function start(operation, input) {
    const attempt = generation + 1;
    await cancel();
    if (closed || attempt !== generation) throw new PublicAuthError('Sign-in canceled.', 'CANCELED');
    const next = await beginAuthCallback({ async onCode(code) {
      if (closed || attempt !== generation) throw new Error('Canceled.');
      const session = await client.exchangeCode(code);
      await vault.flush();
      if (closed || attempt !== generation) throw new Error('Canceled.');
      return displaySession(session);
    } });
    if (closed || attempt !== generation) { await next.cancel(); throw new PublicAuthError('Sign-in canceled.', 'CANCELED'); }
    flow = next;
    void next.result.then(() => {
      if (flow === next) { flow = null; emit('FLOW_COMPLETED', null); }
    }).catch(() => {
      if (flow === next) {
        flow = null;
        client.cancelPendingSignIn();
        emit('AUTH_ERROR', null, 'Sign-in was not completed or expired. Please start again.');
      }
    });
    try {
      if (operation === 'email') await client.signInWithEmail(input.email);
      else {
        const options = input.provider === 'github' ? { scopes: 'user:email' } : { queryParams: { prompt: 'select_account' } };
        if (operation === 'link') await client.linkIdentity(input.provider, options);
        else await client.signInWithOAuth(input.provider, options);
      }
      return { pending: true };
    } catch (error) { if (flow === next) await cancel(); throw error; }
  }
  async function execute(operation, input = {}) {
    if (closed) throw new PublicAuthError('Account service has closed. Restart Earth Radio.');
    if (!AUTH_OPERATIONS.includes(operation) || !exactKeys(input, {
      signIn: ['provider'], link: ['provider'], email: ['email'],
      readDocuments: ['expectedUserId'], upsertDocument: ['expectedUserId', 'body']
    }[operation] || [])) invalid();
    if (['signIn', 'link'].includes(operation) && !['google', 'github'].includes(input.provider)) invalid();
    if (operation === 'email' && (typeof input.email !== 'string' || input.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))) invalid();
    if (['readDocuments', 'upsertDocument'].includes(operation) && (typeof input.expectedUserId !== 'string' || !input.expectedUserId || input.expectedUserId.length > 128)) invalid();
    if (operation === 'upsertDocument') {
      const b = input.body;
      if (!exactKeys(b, ['p_document_key', 'p_value', 'p_expected_revision', 'p_delete']) || Object.keys(b).length !== 4 ||
          !Object.hasOwn(DOCUMENT_LIMITS, b.p_document_key) || !Number.isSafeInteger(b.p_expected_revision) || b.p_expected_revision < 0 ||
          typeof b.p_delete !== 'boolean' || b.p_value === undefined ||
          Buffer.byteLength(JSON.stringify(b.p_value)) > DOCUMENT_LIMITS[b.p_document_key]) invalid();
    }
    try {
      if (operation === 'signOut') {
        await cancel();
        const value = await client.signOut({ immediate: true });
        await vault.flush();
        persistenceFailed = false;
        return value;
      }
      if (persistenceFailed) throw new PublicAuthError('Could not securely save sign-in. Unlock your keychain and restart Earth Radio.');
      let value;
      switch (operation) {
        case 'initialize': value = displaySession(await client.initialize()); break;
        case 'session': value = displaySession(await client.getSession()); break;
        case 'user': value = profile(await client.getUser()); break;
        case 'providers': {
          const providers = await client.listExternalProviders();
          value = providers ? Object.fromEntries(['google', 'github', 'email'].map(key => [key, providers[key] === true])) : null;
          break;
        }
        case 'signIn': case 'link': case 'email': value = await start(operation, input); break;
        case 'cancel': await cancel(); value = true; break;
        case 'readDocuments': value = await client.rest(READ_PATH, { expectedUserId: input.expectedUserId }); break;
        case 'upsertDocument': value = await client.rpc('upsert_user_config_document', input.body, { expectedUserId: input.expectedUserId }); break;
      }
      await vault.flush();
      return value;
    } catch (error) { throw publicFailure(error); }
  }
  return { execute, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() { closed = true; notification++; listeners.clear(); await cancel(); await vault.flush(); } };
}
