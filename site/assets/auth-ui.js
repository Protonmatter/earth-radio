import { createAuthClient } from './auth-core.js?v=0.36.0';
import { createDesktopAuthClient, isDesktopAuthAvailable } from './desktop-auth.js?v=0.36.0';
import { songLibraryStore, setSongLibraryAccount, pauseSongLibraryAccount } from './song-library-store.js?v=0.36.0';
import { passportStore } from './passport-store.js?v=0.36.0';
import {
  accountDataKey, accountLocalRecords, createSyncEngine, planLocalAccountTransition,
  shouldResetBrowserAccount, stableStringify, syncDocuments
} from './sync-core.js?v=0.36.0';

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
  github: { label: 'GitHub', scopes: 'user:email' },
  google: { label: 'Google', queryParams: { prompt: 'select_account' } },
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

function enabledProviders(config, liveProviders) {
  return Object.entries(config.providers || {})
    .filter(([provider, enabled]) => enabled && PROVIDERS[provider])
    .filter(([provider]) => liveProviders != null && liveProviders[provider] === true)
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
      else setSongLibraryAccount(null);
    } catch (error) {
      console.warn('Earth Radio account detach:', error);
    }
    return;
  }

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './assets/auth-ui.css?v=0.36.0';
  document.head.appendChild(stylesheet);

  const nativeAuth = isDesktopAuthAvailable(window.earthRadio, window.location);
  const auth = nativeAuth ? createDesktopAuthClient(window.earthRadio.auth)
    : createAuthClient({ url: config.url, publishableKey: config.publishableKey });
  let session = null;
  let user = null;
  let syncTimer = null;
  let syncing = false;
  let syncStatus = 'Local only';
  let signingOut = false;
  let signOutFailed = false;
  let resettingSession = false;
  let syncGeneration = 0;
  let accountTransition = Promise.resolve();
  let authInitialized = false;
  let reloadTimer = null;
  let liveProviders = null;

  function cancelReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
  }

  const button = el('button', 'header-btn er-auth-button', 'Sign in');
  button.type = 'button';
  button.id = 'er-auth-button';
  button.setAttribute('aria-haspopup', 'dialog');
  const rail = document.getElementById('er-library-account-actions')||document.querySelector('.header-right');
  if (rail) rail.insertBefore(button, rail.firstChild);
  else document.querySelector('.er-header-tools')?.appendChild(button);
  // Static proxies for this button ship hidden so they never dead-click on a build
  // where `boot()` returned above with authentication disabled.
  for (const proxy of document.querySelectorAll('[data-click-id="er-auth-button"][hidden]')) proxy.hidden = false;

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
    lastMessage = null;
    modal.hidden = true;
    const target = [button, document.querySelector('.er-primary-nav [data-er-primary="library"]'), document.getElementById('er-overflow-toggle')]
      .find(control => control?.getClientRects().length && !control.disabled);
    target?.focus({ preventScroll: true });
  }

  // The status line outlives a render: provider discovery can resolve after an
  // initialization error has been shown, and rebuilding the card must not silently
  // drop the reason the dialog opened. `close()` clears it so a reopened dialog is blank.
  let lastMessage = null;
  // A magic-link request in flight. beginPkce() replaces the whole flow store, so a second
  // submit discards the first verifier and the first email link then fails to exchange.
  // The disabled submit button has to survive a render for that to stay impossible.
  let emailSubmitPending = false;

  function message(text, kind = '') {
    lastMessage = text ? { text, kind } : null;
    const target = card.querySelector('[data-auth-message]');
    if (!target) return;
    target.textContent = text;
    target.dataset.kind = kind;
  }

  async function resetSignedOutSession(userId) {
    if (resettingSession) return;
    resettingSession = true;
    pauseSongLibraryAccount();
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

  auth.onAuthStateChange((event, nextSession, detail) => {
    if (event === 'AUTH_ERROR') { message(detail || 'Sign-in failed. Please try again.', 'error'); return; }
    if (event === 'SIGNED_OUT' && !signingOut) {
      void resetSignedOutSession(localStorage.getItem(ACTIVE_USER_KEY));
      return;
    }
    if (nextSession?.user?.id) {
      const nextUserId = nextSession.user.id;
      const activeUserId = localStorage.getItem(ACTIVE_USER_KEY);
      const tabUserId = session?.user?.id;
      if (shouldResetBrowserAccount(activeUserId, tabUserId, nextUserId, authInitialized)) {
        pauseSongLibraryAccount();
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
    if (authInitialized && !signingOut && !signOutFailed && !resettingSession) setSongLibraryAccount(session?.user?.id || null);
    render();
  });

  async function runSync() {
    if (!session || syncing || signingOut || signOutFailed) return;
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
      const songs = songLibraryStore();
      const passport = passportStore(), stores = { songs, passport };
      let reloadRequired = false;
      const engine = createSyncEngine({
        readLocal: async key => {
          assertActive();
          const value = Object.hasOwn(stores, key) ? await stores[key].readForAccount(userId) : await accountKv('get', key, undefined, userId);
          assertActive();
          return value;
        },
        writeLocal: async (key, value) => {
          assertActive();
          const result = Object.hasOwn(stores, key) ? await stores[key].writeForAccount(userId, value) : await accountKv('put', key, value, userId);
          assertActive();
          return result;
        },
        writeLocalIfUnchanged: async (key, expected, value) => {
          assertActive();
          const written = Object.hasOwn(stores, key) ? await stores[key].compareForAccount(userId, expected, value)
            : await accountKv('comparePut', key, { expected, next: value }, userId);
          assertActive();
          return written;
        },
        readState: async key => {
          assertActive();
          if (Object.hasOwn(stores, key)) { const state = await stores[key].readSyncState(userId); assertActive(); return state; }
          try { return JSON.parse(localStorage.getItem(syncStateKey(userId, key))); }
          catch { return null; }
        },
        writeState: async (key, value) => {
          assertActive();
          if (Object.hasOwn(stores, key)) await stores[key].writeSyncState(userId, value);
          else localStorage.setItem(syncStateKey(userId, key), JSON.stringify(value));
          assertActive();
        },
        onRemoteApplied: key => { if (!Object.hasOwn(stores, key)) reloadRequired = true; },
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
      assertActive();
      if (result.conflicts === 0) await songs.ensureSyncBaseline(userId);
      if (result.conflicts === 0) await passport.ensureSyncBaseline(userId);
      assertActive();
      syncStatus = result.conflicts ? 'Synced · conflicts merged' : 'Synced';
      if (reloadRequired) {
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
      if (error?.code === 'ACCOUNT_CHANGED') return;
      syncStatus = navigator.onLine ? 'Sync paused' : 'Offline';
      console.warn('Earth Radio account sync:', error);
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
    providerButton.dataset.authAction = `${action}:${provider}`;
    providerButton.disabled = signingOut || signOutFailed;
    providerButton.addEventListener('click', async () => {
      message(`${action === 'link' ? 'Opening' : 'Continuing to'} ${definition.label}…`);
      try {
        const options = {
          ...(definition.scopes ? { scopes: definition.scopes } : {}),
          ...(definition.queryParams ? { queryParams: definition.queryParams } : {})
        };
        if (action === 'link') await auth.linkIdentity(provider, options);
        else await auth.signInWithOAuth(provider, options);
        if (nativeAuth) message('Complete sign-in in your browser, then return here. Keep Earth Radio open.');
      } catch (error) { message(error.message, 'error'); }
    });
    return providerButton;
  }

  function render() {
    const label = session ? (user?.email || session.user?.email || 'Account') : 'Sign in';
    button.textContent = label;
    overflowButton.textContent = label;
    // Provider discovery resolves long after the dialog can be opened, and its
    // render() must not eat an address the user is midway through typing. Carry
    // the email field's value, focus, and selection across the rebuild.
    // Only while the dialog is on screen: opening it fresh should still start blank.
    const previousEmail = modal.hidden ? null : card.querySelector('input[type="email"]');
    const focusedAction = !modal.hidden && card.contains(document.activeElement)
      ? document.activeElement.dataset.authAction : null;
    const carriedEmail = previousEmail
      ? {
        value: previousEmail.value,
        focused: document.activeElement === previousEmail,
        selectionStart: previousEmail.selectionStart,
        selectionEnd: previousEmail.selectionEnd
      }
      : null;
    card.replaceChildren();
    let restoreFocus = null;

    const header = el('div', 'er-auth-heading');
    const title = el('h2', '', session ? 'Your Earth Radio account' : 'Sign in to Earth Radio');
    title.id = 'er-auth-title';
    const closeButton = el('button', 'er-auth-close', '×');
    closeButton.type = 'button';
    closeButton.dataset.authAction = 'close';
    closeButton.setAttribute('aria-label', 'Close account dialog');
    closeButton.addEventListener('click', close);
    header.append(title, closeButton);
    card.appendChild(header);

    if (!session) {
      card.appendChild(el('p', 'er-auth-copy', 'Sync favorites, recent stations, and preferences privately across devices.'));
      if (nativeAuth) {
        card.appendChild(el('p', 'er-auth-copy', 'Sign-in opens your default browser. For email, open the link on this computer within 10 minutes and keep Earth Radio open.'));
        const cancelSignIn = el('button', 'er-auth-provider', 'Cancel pending sign-in');
        cancelSignIn.type = 'button';
        cancelSignIn.addEventListener('click', () => { void auth.cancelPendingSignIn().then(() => message('Pending sign-in canceled.')).catch(error => message(error.message, 'error')); });
        card.appendChild(cancelSignIn);
      }
      const providerList = el('div', 'er-auth-providers');
      for (const provider of enabledProviders(config, liveProviders)) providerList.appendChild(providerButton(provider, 'signin'));
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
      submit.dataset.authAction = 'email-submit';
      submit.disabled = emailSubmitPending;
      form.append(input, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        emailSubmitPending = true;
        submit.disabled = true;
        try {
          await auth.signInWithEmail(input.value);
          message(nativeAuth ? 'Check your email on this computer. Keep Earth Radio open while you use the sign-in link.' : 'Check your email for a secure sign-in link.', 'success');
        } catch (error) { message(error.message, 'error'); }
        finally {
          emailSubmitPending = false;
          // Provider discovery may have rebuilt the card while the request was in flight,
          // which leaves `submit` detached; re-enable whichever button is mounted now.
          const mounted = card.querySelector('.er-auth-email button[type="submit"]');
          if (mounted) mounted.disabled = false;
        }
      });
      if (carriedEmail) {
        input.value = carriedEmail.value;
        if (carriedEmail.focused) {
          restoreFocus = () => {
            input.focus();
            try { input.setSelectionRange(carriedEmail.selectionStart, carriedEmail.selectionEnd); }
            catch { /* setSelectionRange is not supported on every email input. */ }
          };
        }
      }
      card.appendChild(form);
    } else {
      card.appendChild(el('p', 'er-auth-copy', user?.email || session.user?.email || 'Signed in'));
      card.appendChild(el('p', 'er-auth-sync', syncStatus));
      const identities = new Set((user?.identities || session.user?.identities || []).map(identity => identity.provider));
      const identityList = el('div', 'er-auth-identities');
      for (const provider of enabledProviders(config, liveProviders)) {
        if (identities.has(provider)) {
          identityList.appendChild(el('span', 'er-auth-linked', `${PROVIDERS[provider].label} linked`));
        } else {
          identityList.appendChild(providerButton(provider, 'link'));
        }
      }
      card.appendChild(identityList);
      const syncNow = el('button', 'er-auth-secondary', 'Sync now');
      syncNow.type = 'button';
      syncNow.dataset.authAction = 'sync';
      syncNow.disabled = signingOut || signOutFailed;
      syncNow.addEventListener('click', () => void runSync());
      const signOut = el('button', 'er-auth-secondary', 'Sign out');
      signOut.type = 'button';
      signOut.dataset.authAction = 'sign-out';
      signOut.disabled = signingOut;
      signOut.addEventListener('click', async () => {
        if (signingOut) return;
        const userId = session?.user?.id;
        signingOut = true;
        pauseSongLibraryAccount();
        signOutFailed = false;
        syncTimer = quiesceSignOut({
          cancelReload,
          syncTimer,
          invalidateSync: () => { syncGeneration += 1; }
        });
        syncStatus = 'Signing out…';
        render();
        try {
          const signedOut = await auth.signOut();
          if (!signedOut) {
            // Another session won the race; initialize its namespace on reload.
            signingOut = false;
            location.reload();
            return;
          }
          await switchLocalAccount(userId, null);
          localStorage.removeItem(ACTIVE_USER_KEY);
          session = null;
          user = null;
          syncStatus = 'Local only';
          location.reload();
        } catch {
          signingOut = false;
          signOutFailed = true;
          syncStatus = 'Sign-out incomplete · sync paused';
          render();
          message(nativeAuth
            ? 'Sign-out did not finish. Unlock your keychain and check device storage, then try Sign out again. Your account data remains on this device until sign-out completes.'
            : 'Sign-out did not finish. Check browser storage access, then try Sign out again. Your account data remains on this device until sign-out completes.', 'error');
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
    if (lastMessage) {
      status.textContent = lastMessage.text;
      status.dataset.kind = lastMessage.kind;
    }
    restoreFocus?.();
    if (focusedAction && !restoreFocus) {
      const control = [...card.querySelectorAll('[data-auth-action]')]
        .find(candidate => candidate.dataset.authAction === focusedAction && !candidate.disabled);
      (control || closeButton).focus({ preventScroll: true });
    }
  }

  button.addEventListener('click', () => {
    render();
    modal.hidden = false;
    card.querySelector('button, input')?.focus();
  });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.addEventListener('keydown', event => {
    if (modal.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...card.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      .filter(control => control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!card.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  window.addEventListener('online', () => void runSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void runSync(); });

  render();
  const callbackParams = new URL(window.location.href).searchParams;
  const finishingCallback = Boolean(callbackParams.get('code') || callbackParams.get('error'));
  if (finishingCallback && callbackParams.get('code')) {
    button.textContent = 'Finishing sign-in…';
    overflowButton.textContent = 'Finishing sign-in…';
  }
  // `listExternalProviders()` resolves to null rather than rejecting, and its result
  // has to land whether or not initialization succeeded: a failed PKCE exchange or an
  // `error` callback opens this dialog, and that is exactly where the GitHub/Google
  // buttons are needed to restart OAuth without a page reload.
  const providerDiscovery = auth.listExternalProviders().then(providers => {
    liveProviders = providers;
    if (authInitialized) render();
  });
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
      setSongLibraryAccount(nextUserId);
      try { await refreshUser(); }
      catch (error) {
        if (resettingSession) return;
        syncStatus = navigator.onLine ? 'Syncing · profile unavailable' : 'Offline';
        console.warn('Earth Radio account profile:', error);
        render();
      }
      if (session && !resettingSession) startSync();
    } else setSongLibraryAccount(null);
    await providerDiscovery;
    render();
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
