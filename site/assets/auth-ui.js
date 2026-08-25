import { createAuthClient } from './auth-core.js';
import { createSyncEngine } from './sync-core.js';

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

async function kv(operation, key, value) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('kv', operation === 'get' ? 'readonly' : 'readwrite');
      const request = operation === 'get'
        ? transaction.objectStore('kv').get(key)
        : transaction.objectStore('kv').put(value, key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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

async function boot() {
  const config = window.RADIO_CONFIG?.auth;
  if (!config?.enabled) return;

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

  const button = el('button', 'er-auth-button', 'Sign in');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  document.querySelector('.er-header-tools')?.appendChild(button);

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

  async function runSync() {
    if (!session || syncing) return;
    syncing = true;
    syncStatus = navigator.onLine ? 'Syncing…' : 'Offline';
    render();
    try {
      const userId = session.user.id;
      const engine = createSyncEngine({
        readLocal: key => kv('get', key),
        writeLocal: (key, value) => kv('put', key, value),
        readState: async key => {
          try { return JSON.parse(localStorage.getItem(syncStateKey(userId, key))); }
          catch { return null; }
        },
        writeState: async (key, value) => localStorage.setItem(syncStateKey(userId, key), JSON.stringify(value)),
        fetchRemote: () => auth.rest('user_config_documents?select=document_key,value,revision,deleted_at&order=document_key'),
        upsertRemote: ({ documentKey, value, expectedRevision, deleteDocument }) => auth.rpc(
          'upsert_user_config_document',
          {
            p_document_key: documentKey,
            p_value: deleteDocument ? null : value,
            p_expected_revision: expectedRevision,
            p_delete: deleteDocument
          }
        )
      });
      const result = await engine.syncOnce();
      syncStatus = result.conflicts ? 'Synced · conflicts merged' : 'Synced';
      if (result.downloaded > 0) {
        const reloadKey = `earthRadio.sync.reload.${userId}`;
        const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
        if (Date.now() - lastReload > 5000) {
          sessionStorage.setItem(reloadKey, String(Date.now()));
          location.reload();
          return;
        }
      }
    } catch (error) {
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
    button.textContent = session ? (user?.email || session.user?.email || 'Account') : 'Sign in';
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
        try {
          await auth.signOut();
          session = null;
          user = null;
          syncStatus = 'Local only';
          if (syncTimer) clearInterval(syncTimer);
          syncTimer = null;
          render();
        } catch (error) { message(error.message, 'error'); }
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
  try {
    session = await auth.initialize();
    if (session) {
      await refreshUser();
      startSync();
    }
  } catch (error) {
    message(error.message, 'error');
    modal.hidden = false;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
else void boot();
