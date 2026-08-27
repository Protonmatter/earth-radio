import { createAuthClient } from './auth-core.js';
import {
  accountDataKey, accountLocalRecords, createSyncEngine, planLocalAccountTransition,
  shouldResetBrowserAccount, stableStringify, syncDocuments
} from './sync-core.js';

export function quiesceSignOut({ cancelReload, syncTimer, invalidateSync, clearIntervalImpl = clearInterval }) {
  invalidateSync();
  cancelReload();
  if (syncTimer) clearIntervalImpl(syncTimer);
  return null;
}

const ACTIVE_USER_KEY = 'earthRadio.auth.activeUser.v1';
const ACTIVE_NAMESPACE_KEY = 'account:active';
const DEFAULT_LOCAL_DATA = Object.freeze({
  favorites: {},
  recents: [],
  prefs: { secureOnly: false, minQuality: 0, volume: 0.8, theme: 'system', locale: 'en' },
  badStations: {},
  lastPlayed: null
});

const PROVIDERS = Object.freeze({
  github: { label: 'GitHub' },
  google: { label: 'Google' },
  apple: { label: 'Apple' },
  azure: { label: 'Microsoft', scopes: 'email' }
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('earthRadio', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function accountChangedError() {
  const error = new Error('Account changed while synchronization was running.');
  error.code = 'ACCOUNT_CHANGED';
  return error;
}

async function accountKv(operation, key, value, userId) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('kv', operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('kv');
      let result;
      let failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(failure || transaction.error || new Error('Account storage access failed.'));
      transaction.onabort = () => reject(failure || transaction.error || new Error('Account storage access aborted.'));
      const namespaceRequest = store.get(ACTIVE_NAMESPACE_KEY);
      namespaceRequest.onerror = () => reject(namespaceRequest.error);
      namespaceRequest.onsuccess = () => {
        const storedNamespace = namespaceRequest.result || null;
        if (storedNamespace !== userId) {
          failure = accountChangedError();
          transaction.abort();
          return;
        }
        if (operation === 'comparePut') {
          const compareRequest = store.get(key);
          compareRequest.onerror = () => reject(compareRequest.error);
          compareRequest.onsuccess = () => {
            if (stableStringify(compareRequest.result) !== stableStringify(value.expected)) {
              result = false;
              return;
            }
            const putRequest = store.put(value.next, key);
            putRequest.onerror = () => reject(putRequest.error);
            putRequest.onsuccess = () => { result = true; };
          };
          return;
        }
        const request = operation === 'get' ? store.get(key) : store.put(value, key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { result = request.result; };
      };
    });
  } finally {
    db.close();
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function enabledProviders(config) {
  return Object.entries(config.providers || {})
    .filter(([provider, enabled]) => enabled && PROVIDERS[provider])
    .map(([provider]) => provider);
}

function syncStateKey(userId, localKey) {
  return `earthRadio.sync.${userId}.${localKey}.v1`;
}

async function switchLocalAccount(previousUserId, nextUserId) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('kv', 'readwrite');
      const store = transaction.objectStore('kv');
      const keys = [ACTIVE_NAMESPACE_KEY, ...accountLocalRecords];
      if (nextUserId) {
        keys.push(...accountLocalRecords.map(localKey => accountDataKey(nextUserId, localKey)));
      }
      const values = new Map();
      let pending = keys.length;
      let result;
      const fail = () => reject(transaction.error || new Error('Account storage transition failed.'));
      transaction.onerror = fail;
      transaction.onabort = fail;
      transaction.oncomplete = () => resolve(result);
      for (const key of keys) {
        const request = store.get(key);
        request.onerror = fail;
        request.onsuccess = () => {
          values.set(key, request.result);
          pending -= 1;
          if (pending !== 0) return;
          const current = Object.fromEntries(accountLocalRecords.map(localKey => [localKey, values.get(localKey)]));
          const saved = Object.fromEntries(accountLocalRecords.map(localKey => [
            localKey,
            nextUserId ? values.get(accountDataKey(nextUserId, localKey)) : undefined
          ]));
          const storedNamespace = values.get(ACTIVE_NAMESPACE_KEY);
          const actualPreviousUserId = storedNamespace === undefined ? previousUserId : storedNamespace;
          result = planLocalAccountTransition({
            previousUserId: actualPreviousUserId,
            nextUserId,
            current,
            saved,
            nextNamespaceExists: Boolean(nextUserId) && values.get(accountDataKey(nextUserId, syncDocuments[0].localKey)) !== undefined,
            defaults: DEFAULT_LOCAL_DATA
          });
          result = { ...result, namespaceMissing: storedNamespace === undefined };
          for (const [keyToWrite, value] of result.writes) store.put(value, keyToWrite);
          store.put(nextUserId || null, ACTIVE_NAMESPACE_KEY);
        };
      }
    });
  } finally {
    db.close();
  }
}

function clearMissingNamespaceSyncState(userId, transition) {
  if (userId && (transition.namespaceMissing || (!transition.restored && !transition.unchanged))) {
    for (const { localKey } of syncDocuments) localStorage.removeItem(syncStateKey(userId, localKey));
  }
}

async function boot() {
  const config = window.RADIO_CONFIG?.auth;
  if (!config?.enabled) {
    const activeUserId = localStorage.getItem(ACTIVE_USER_KEY);
    try {
      const transition = await switchLocalAccount(activeUserId, null);
      localStorage.removeItem(ACTIVE_USER_KEY);
      if (activeUserId || transition.detached) location.reload();
    } catch (error) {
      console.warn('Earth Radio account detach:', error);
    }
    return;
  }

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './assets/auth-ui.css';
  document.head.appendChild(stylesheet);

  const auth = createAuthClient({ url: config.url, publishableKey: config.publishableKey });
  let session = null;
  let user = null;
  let syncTimer = null;
  let syncing = false;
  let syncStatus = 'Local only';
  let signingOut = false;
  let resettingSession = false;
  let syncGeneration = 0;
  let accountTransition = Promise.resolve();
  let authInitialized = false;
  let reloadTimer = null;

  function cancelReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
  }

  const button = el('button', 'header-btn er-auth-button', 'Sign in');
  button.type = 'button';
  button.id = 'er-auth-button';
  button.setAttribute('aria-haspopup', 'dialog');
  const rail = document.querySelector('.header-right');
  if (rail) rail.insertBefore(button, rail.firstChild);
  else document.querySelector('.er-header-tools')?.appendChild(button);

  const overflow = document.getElementById('er-overflow');
  const overflowButton = el('button', 'er-auth-overflow', 'Sign in');
  overflowButton.type = 'button';
  overflowButton.setAttribute('data-click-id', 'er-auth-button');
  overflowButton.setAttribute('aria-haspopup', 'dialog');
  overflow?.insertBefore(overflowButton, overflow.firstChild);

  const modal = el('div', 'er-auth-modal');
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'er-auth-title');
  const card = el('section', 'er-auth-card');
  modal.appendChild(card);
  document.body.appendChild(modal);

  function close() {
    modal.hidden = true;
    button.focus();
  }

  function message(text, kind = '') {
    const target = card.querySelector('[data-auth-message]');
    if (!target) return;
    target.textContent = text;
    target.dataset.kind = kind;
  }

  async function resetSignedOutSession(userId) {
    if (resettingSession) return;
    resettingSession = true;
    syncGeneration += 1;
    cancelReload();
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    session = null;
    user = null;
    await switchLocalAccount(userId, null);
    localStorage.removeItem(ACTIVE_USER_KEY);
    location.reload();
  }

  auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_OUT' && !signingOut) {
      void resetSignedOutSession(localStorage.getItem(ACTIVE_USER_KEY));
      return;
    }
    if (nextSession?.user?.id) {
      const nextUserId = nextSession.user.id;
      const activeUserId = localStorage.getItem(ACTIVE_USER_KEY);
      const tabUserId = session?.user?.id;
      if (shouldResetBrowserAccount(activeUserId, tabUserId, nextUserId, authInitialized)) {
        syncGeneration += 1;
        cancelReload();
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = null;
        session = null;
        user = null;
        accountTransition = accountTransition.then(async () => {
          const previousUserId = localStorage.getItem(ACTIVE_USER_KEY);
          const transition = await switchLocalAccount(previousUserId, nextUserId);
          clearMissingNamespaceSyncState(nextUserId, transition);
          localStorage.setItem(ACTIVE_USER_KEY, nextUserId);
          location.reload();
        });
        return;
      }
    }
    session = nextSession;
    render();
  });

  async function runSync() {
    if (!session || syncing) return;
    syncing = true;
    syncStatus = navigator.onLine ? 'Syncing…' : 'Offline';
    render();
    try {
      const userId = session.user.id;
      const generation = syncGeneration;
      const assertActive = () => {
        if (generation !== syncGeneration || session?.user?.id !== userId) {
          throw accountChangedError();
        }
      };
      const assertActiveNamespace = async () => {
        assertActive();
        await accountKv('get', ACTIVE_NAMESPACE_KEY, undefined, userId);
        assertActive();
      };
      const engine = createSyncEngine({
        readLocal: async key => {
          assertActive();
          const value = await accountKv('get', key, undefined, userId);
          assertActive();
          return value;
        },
        writeLocal: async (key, value) => {
          assertActive();
          const result = await accountKv('put', key, value, userId);
          assertActive();
          return result;
        },
        writeLocalIfUnchanged: async (key, expected, value) => {
          assertActive();
          const written = await accountKv('comparePut', key, { expected, next: value }, userId);
          assertActive();
          return written;
        },
        readState: async key => {
          assertActive();
          try { return JSON.parse(localStorage.getItem(syncStateKey(userId, key))); }
          catch { return null; }
        },
        writeState: async (key, value) => {
          assertActive();
          localStorage.setItem(syncStateKey(userId, key), JSON.stringify(value));
        },
        fetchRemote: async () => {
          await assertActiveNamespace();
          const rows = await auth.rest(
            'user_config_documents?select=document_key,value,revision,deleted_at&order=document_key',
            { expectedUserId: userId }
          );
          await assertActiveNamespace();
          return rows;
        },
        upsertRemote: async ({ documentKey, value, expectedRevision, deleteDocument }) => {
          await assertActiveNamespace();
          const row = await auth.rpc('upsert_user_config_document', {
            p_document_key: documentKey,
            p_value: deleteDocument ? null : value,
            p_expected_revision: expectedRevision,
            p_delete: deleteDocument
          }, { expectedUserId: userId });
          await assertActiveNamespace();
          return row;
        }
      });
      const result = await engine.syncOnce();
      syncStatus = result.conflicts ? 'Synced · conflicts merged' : 'Synced';
      if (result.downloaded > 0) {
        const reloadKey = `earthRadio.sync.reload.${userId}`;
        const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
        const reloadDelay = Math.max(0, 5000 - (Date.now() - lastReload));
        const reload = () => {
          reloadTimer = null;
          if (session?.user?.id !== userId) return;
          sessionStorage.setItem(reloadKey, String(Date.now()));
          location.reload();
        };
        if (reloadDelay === 0) {
          reload();
          return;
        }
        if (!reloadTimer) reloadTimer = setTimeout(reload, reloadDelay);
      }
    } catch (error) {
      syncStatus = navigator.onLine ? 'Sync paused' : 'Offline';
      console.warn('Earth Radio account sync:', error);
      if (error?.code === 'ACCOUNT_CHANGED') return;
    } finally {
      syncing = false;
      render();
    }
  }

  function startSync() {
    if (syncTimer) clearInterval(syncTimer);
    if (!session) return;
    void runSync();
    syncTimer = setInterval(() => void runSync(), Math.max(4000, Number(config.syncIntervalMs) || 5000));
  }

  async function refreshUser() {
    user = session ? await auth.getUser() : null;
    if (session && user) session = { ...session, user };
    render();
  }

  function providerButton(provider, action) {
    const definition = PROVIDERS[provider];
    const providerButton = el('button', 'er-auth-provider', `${action === 'link' ? 'Link' : 'Continue with'} ${definition.label}`);
    providerButton.type = 'button';
    providerButton.addEventListener('click', async () => {
      message(`${action === 'link' ? 'Opening' : 'Continuing to'} ${definition.label}…`);
      try {
        const options = definition.scopes ? { scopes: definition.scopes } : {};
        if (action === 'link') await auth.linkIdentity(provider, options);
        else await auth.signInWithOAuth(provider, options);
      } catch (error) { message(error.message, 'error'); }
    });
    return providerButton;
  }

  function render() {
    const label = session ? (user?.email || session.user?.email || 'Account') : 'Sign in';
    button.textContent = label;
    overflowButton.textContent = label;
    card.replaceChildren();

    const header = el('div', 'er-auth-heading');
    const title = el('h2', '', session ? 'Your Earth Radio account' : 'Sign in to Earth Radio');
    title.id = 'er-auth-title';
    const closeButton = el('button', 'er-auth-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close account dialog');
    closeButton.addEventListener('click', close);
    header.append(title, closeButton);
    card.appendChild(header);

    if (!session) {
      card.appendChild(el('p', 'er-auth-copy', 'Sync favorites, recent stations, and preferences privately across devices.'));
      const providerList = el('div', 'er-auth-providers');
      for (const provider of enabledProviders(config)) providerList.appendChild(providerButton(provider, 'signin'));
      card.appendChild(providerList);

      const divider = el('p', 'er-auth-divider', 'or use email');
      card.appendChild(divider);
      const form = el('form', 'er-auth-email');
      const input = el('input');
      input.type = 'email';
      input.name = 'email';
      input.autocomplete = 'email';
      input.placeholder = 'you@example.com';
      input.required = true;
      input.setAttribute('aria-label', 'Email address');
      const submit = el('button', 'er-auth-primary', 'Email me a sign-in link');
      submit.type = 'submit';
      form.append(input, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await auth.signInWithEmail(input.value);
          message('Check your email for a secure sign-in link.', 'success');
        } catch (error) { message(error.message, 'error'); }
        finally { submit.disabled = false; }
      });
      card.appendChild(form);
    } else {
      card.appendChild(el('p', 'er-auth-copy', user?.email || session.user?.email || 'Signed in'));
      card.appendChild(el('p', 'er-auth-sync', syncStatus));
      const identities = new Set((user?.identities || session.user?.identities || []).map(identity => identity.provider));
      const identityList = el('div', 'er-auth-identities');
      for (const provider of enabledProviders(config)) {
        if (identities.has(provider)) {
          identityList.appendChild(el('span', 'er-auth-linked', `${PROVIDERS[provider].label} linked`));
        } else {
          identityList.appendChild(providerButton(provider, 'link'));
        }
      }
      card.appendChild(identityList);
      const syncNow = el('button', 'er-auth-secondary', 'Sync now');
      syncNow.type = 'button';
      syncNow.addEventListener('click', () => void runSync());
      const signOut = el('button', 'er-auth-secondary', 'Sign out');
      signOut.type = 'button';
      signOut.addEventListener('click', async () => {
        const userId = session?.user?.id;
        signingOut = true;
        syncTimer = quiesceSignOut({
          cancelReload,
          syncTimer,
          invalidateSync: () => { syncGeneration += 1; }
        });
        let signedOut = false;
        try {
          signedOut = await auth.signOut();
        } finally {
          if (signedOut) {
            try {
              await switchLocalAccount(userId, null);
            } finally {
              localStorage.removeItem(ACTIVE_USER_KEY);
              session = null;
              user = null;
              syncStatus = 'Local only';
            }
          } else {
            signingOut = false;
          }
        }
        if (!signedOut) {
          // A replacement session won the race; reload to reinitialize its namespace and sync loop.
          location.reload();
          return;
        }
        try {
          location.reload();
        } catch (error) {
          signingOut = false;
          message(error.message, 'error');
        }
      });
      const actions = el('div', 'er-auth-actions');
      actions.append(syncNow, signOut);
      card.appendChild(actions);
    }

    const status = el('p', 'er-auth-message');
    status.dataset.authMessage = '';
    status.setAttribute('role', 'status');
    card.appendChild(status);
  }

  button.addEventListener('click', () => {
    render();
    modal.hidden = false;
    card.querySelector('button, input')?.focus();
  });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
  window.addEventListener('online', () => void runSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void runSync(); });

  render();
  const callbackParams = new URL(window.location.href).searchParams;
  const finishingCallback = Boolean(callbackParams.get('code') || callbackParams.get('error'));
  if (finishingCallback && callbackParams.get('code')) {
    button.textContent = 'Finishing sign-in…';
    overflowButton.textContent = 'Finishing sign-in…';
  }
  try {
    session = await auth.initialize();
    authInitialized = true;
    render();
    await accountTransition;
    if (resettingSession) return;
    if (session) {
      const previousUserId = localStorage.getItem(ACTIVE_USER_KEY);
      const nextUserId = session.user?.id;
      if (!nextUserId) throw new Error('Sign-in did not return a user. Please try again.');
      const transition = await switchLocalAccount(previousUserId, nextUserId);
      clearMissingNamespaceSyncState(nextUserId, transition);
      localStorage.setItem(ACTIVE_USER_KEY, nextUserId);
      if (transition.archived || transition.restored) {
        syncGeneration += 1;
        location.reload();
        return;
      }
      try { await refreshUser(); }
      catch (error) {
        if (resettingSession) return;
        syncStatus = navigator.onLine ? 'Syncing · profile unavailable' : 'Offline';
        console.warn('Earth Radio account profile:', error);
        render();
      }
      if (session && !resettingSession) startSync();
    }
  } catch (error) {
    authInitialized = true;
    render();
    message(error.message, 'error');
    modal.hidden = false;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
  else void boot();
}
