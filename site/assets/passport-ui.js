import { t, normalizeLocale } from '../i18n/index.js?v=0.34.1';
import { passportEntries, recordPassportPlace, ContinuousPassportSession } from './passport-core.js?v=0.34.1';
import { passportStore } from './passport-store.js?v=0.34.1';
import { getSongLibraryAccount, subscribeSongLibraryAccount, songLibraryStore } from './song-library-store.js?v=0.34.1';
import { clearSongHistory } from './song-library-core.js?v=0.34.1';
import { currentPlaybackStation } from './discovery-ui.js?v=0.34.1';
import { stationPlace } from './place-core.js?v=0.34.1';
import { displayCountry } from './search-core.js?v=0.34.1';
import { setPassportMapCountries } from './passport-map.js?v=0.34.1';
import { createUserTransfer } from './user-transfer.js?v=0.34.1';

const byId = id => document.getElementById(id);
const locale = () => normalizeLocale(document.documentElement.lang);
const tr = (key, params) => t('passport.' + key, params, locale());
const element = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const sameFence = (a, b) => a && b && a.namespace === b.namespace && a.ownerVersion === b.ownerVersion
  && a.historyEpoch === b.historyEpoch && a.settingsVersion === b.settingsVersion && a.historyEnabled === b.historyEnabled;
const errorText = error => ['PASSPORT_INVALID', 'TRANSFER_INVALID'].includes(error?.code) ? t('transfer.importFailed', undefined, locale()) : tr(error?.code === 'ACCOUNT_CHANGED' ? 'accountChanged'
  : error?.code === 'PASSPORT_FULL' ? 'full' : error?.code === 'PASSPORT_UPDATE_REQUIRED' ? 'updateRequired'
  : ['PASSPORT_SYNC_PENDING', 'PASSPORT_NOT_READY', 'PASSPORT_POLICY_PENDING'].includes(error?.code) ? 'syncPending'
  : error?.code === 'PASSPORT_HISTORY_OFF' ? 'off' : error?.code === 'PASSPORT_POLICY_CHANGED' ? 'historyChanged'
  : error?.code === 'PASSPORT_CORRUPT' || error?.code === 'PASSPORT_POLICY_UNAVAILABLE' ? 'recovery' : 'saveFailed');

function start() {
  const section = byId('er-passport'), audio = byId('audio-player'); if (!section || !audio) return;
  const store = passportStore(), songs = songLibraryStore(), transfer = createUserTransfer(), listening = new ContinuousPassportSession();
  let snapshot = null, observationPolicy = null, songSnapshot = null, shown = 30;
  let busy = false, saving = false, refreshing = false, refreshAgain = false, failure = null, stopped = false;
  const pending = new Map();
  function message(text = '') { byId('er-passport-message').textContent = text; }
  function invalidate() {
    snapshot = null; songSnapshot = null; setPassportMapCountries([]); render();
  }
  function date(day) {
    try { return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(day * 86400000)); }
    catch { return ''; }
  }
  function render() {
    if (stopped) return;
    const owner = getSongLibraryAccount(), usable = owner.ready && snapshot?.ownerVersion === owner.version;
    const entries = usable && snapshot.historyEnabled ? passportEntries(snapshot.value) : [];
    const numbers = new Intl.NumberFormat(locale());
    byId('er-passport-countries').textContent = numbers.format(entries.length);
    byId('er-passport-cities').textContent = numbers.format(entries.reduce((sum, row) => sum + row.cities.length, 0));
    byId('er-passport-status').textContent = failure ? errorText(failure) : !usable ? tr('loading')
      : owner.accountId && snapshot.historyEnabled && !snapshot.canWrite ? tr('syncPending') : tr(owner.accountId ? 'account' : 'local');
    byId('er-passport-off').hidden = !usable || snapshot.historyEnabled;
    byId('er-passport-empty').hidden = !usable || !snapshot.historyEnabled || Boolean(entries.length);
    byId('er-passport-list').replaceChildren(...entries.slice(0, shown).map(row => {
      const item = element('li'); item.dataset.passportCountry = row.countrycode;
      item.append(element('h4', displayCountry({ countrycode: row.countrycode }, locale())),
        element('p', tr('visited', { first: date(row.firstDay), last: date(row.lastDay) })));
      if (row.cities.length) {
        const cities = element('ul');
        cities.append(...row.cities.map(city => element('li', city.name))); item.append(cities);
      }
      return item;
    }));
    byId('er-passport-more').hidden = entries.length <= shown;
    byId('er-passport-export').disabled = busy || !usable;
    byId('er-passport-import').disabled = busy || !usable || !snapshot.canWrite;
    byId('er-passport-add-local').disabled = busy || !usable || !snapshot.canWrite;
    byId('er-passport-clear').disabled = busy || !owner.ready || !songSnapshot?.canWrite;
    setPassportMapCountries(entries.map(row => row.countrycode));
  }
  async function refresh() {
    refreshAgain = true; invalidate(); if (refreshing) return; refreshing = true;
    try {
      while (refreshAgain) {
        if (stopped) break;
        refreshAgain = false; const owner = getSongLibraryAccount();
        try {
          const value = await store.read(), history = await songs.read();
          if (getSongLibraryAccount().version !== owner.version || stopped) continue;
          if (!sameFence(observationPolicy, value)) { listening.reset(); pending.clear(); }
          observationPolicy = value; snapshot = value; songSnapshot = history; failure = null;
          let available = false;
          try { available = await store.guestPassportAvailable(); } catch { /* guest recovery never hides the current profile */ }
          if (getSongLibraryAccount().version !== owner.version || stopped) continue;
          byId('er-passport-add-local').hidden = !available;
        } catch (error) {
          if (getSongLibraryAccount().version !== owner.version || stopped) continue;
          snapshot = observationPolicy = songSnapshot = null; pending.clear(); listening.reset(); failure = error;
          byId('er-passport-add-local').hidden = true;
        }
        render(); void flush();
      }
    } finally { refreshing = false; }
  }
  async function flush() {
    if (saving || busy || stopped || !observationPolicy?.canWrite) return;
    const owner = getSongLibraryAccount();
    if (!owner.ready || observationPolicy.ownerVersion !== owner.version) return;
    const item = [...pending.values()].find(row => row.attempts < 3 && row.retryAt <= performance.now()); if (!item) return;
    if (!sameFence(observationPolicy, { ...item.observation, namespace: item.observation.ownerNamespace, historyEnabled: true })) { pending.delete(item.key); return; }
    saving = true; item.attempts++; item.retryAt = performance.now() + 5000;
    try {
      await store.mutate(doc => recordPassportPlace(doc, item.observation.place, item.observation.day), item.observation);
      if (pending.get(item.key) === item) pending.delete(item.key);
    } catch (error) {
      if (['ACCOUNT_CHANGED', 'PASSPORT_POLICY_CHANGED', 'PASSPORT_HISTORY_OFF'].includes(error.code)) pending.delete(item.key);
      if (getSongLibraryAccount().version === owner.version && !stopped) message(errorText(error));
    } finally { saving = false; }
  }
  function sample() {
    if (stopped) return;
    let playback;
    try { playback = currentPlaybackStation(); } catch { listening.reset(); return; }
    const owner = getSongLibraryAccount(), policy = observationPolicy;
    const observation = listening.sample({ now: performance.now(), mediaTime: audio.currentTime, day: Math.floor(Date.now() / 86400000),
      ownerNamespace: policy?.namespace, ownerVersion: owner.version, historyEpoch: policy?.historyEpoch,
      settingsVersion: policy?.settingsVersion, historyEnabled: policy?.historyEnabled,
      ready: owner.ready && Boolean(policy?.canWrite) && policy?.ownerVersion === owner.version,
      programKey: playback?.programKey, sourceKey: playback ? [playback.station.url_resolved || playback.station.url, audio.currentSrc].join('|') : '',
      place: stationPlace(playback?.station), playing: !audio.paused && !audio.ended,
      muted: audio.muted, volume: audio.volume, readyState: audio.readyState, seeking: audio.seeking });
    if (observation) {
      const key = JSON.stringify([observation.ownerNamespace, observation.historyEpoch, observation.settingsVersion, observation.place.countrycode, observation.place.cityId, observation.day]);
      pending.set(key, { key, observation, attempts: 0, retryAt: 0 });
      while (pending.size > 4) pending.delete(pending.keys().next().value);
    }
    void flush();
  }
  function reset() { listening.reset(); }
  const resets = ['pause', 'waiting', 'stalled', 'seeking', 'ended', 'error', 'emptied', 'loadstart'];
  const samples = ['timeupdate', 'playing', 'seeked', 'volumechange'];
  for (const event of resets) audio.addEventListener(event, reset);
  for (const event of samples) audio.addEventListener(event, sample);
  const unsubscribeOwner = subscribeSongLibraryAccount(() => {
    listening.reset(); pending.clear(); observationPolicy = null; failure = null; byId('er-passport-add-local').hidden = true; message(); void refresh();
  });
  const unsubscribe = store.subscribe(() => void refresh());
  const language = new MutationObserver(render); language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  byId('er-passport-more').addEventListener('click', () => { shown += 30; render(); });
  byId('er-passport-history-settings').addEventListener('click', () => {
    document.querySelector('#er-you [data-er-library-section="music"]')?.click();
    requestAnimationFrame(() => byId('er-song-history-enabled')?.focus({ preventScroll: false }));
  });
  async function perform(action, success) {
    if (busy) return;
    const owner = getSongLibraryAccount(); busy = true; render();
    try {
      await action();
      if (owner.version === getSongLibraryAccount().version && !stopped) message(tr(success));
    } catch (error) { if (owner.version === getSongLibraryAccount().version && !stopped) message(errorText(error)); }
    finally { busy = false; void refresh(); }
  }
  byId('er-passport-add-local').addEventListener('click', () => {
    const fence = snapshot; if (fence) void perform(() => store.importGuest(fence), 'added');
  });
  byId('er-passport-clear').addEventListener('click', () => {
    if (busy || !songSnapshot?.canWrite || !confirm(t('music.confirmClear', undefined, locale()))) return;
    const owner = getSongLibraryAccount(); listening.reset(); pending.clear(); invalidate();
    void perform(() => songs.mutate(doc => clearSongHistory(doc, Date.now()), owner.version), 'cleared');
  });
  byId('er-passport-export').addEventListener('click', () => void perform(async () => {
    const owner = getSongLibraryAccount(), text = await transfer.exportPassportData();
    if (owner.version !== getSongLibraryAccount().version) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = element('a');
    anchor.href = url; anchor.download = `EarthRadio-Passport-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'exported'));
  byId('er-passport-import').addEventListener('change', event => {
    const file = event.target.files?.[0]; if (!file) return;
    void perform(() => transfer.importFile(file, { passportOnly: true }), 'imported').finally(() => { event.target.value = ''; });
  });
  const retry = () => { for (const item of pending.values()) { item.attempts = 0; item.retryAt = 0; } void refresh(); };
  window.addEventListener('focus', retry); window.addEventListener('online', retry);
  window.addEventListener('pagehide', event => {
    listening.reset(); pending.clear(); if (event.persisted) return;
    stopped = true; unsubscribe(); unsubscribeOwner(); language.disconnect();
    for (const name of resets) audio.removeEventListener(name, reset);
    for (const name of samples) audio.removeEventListener(name, sample);
    window.removeEventListener('focus', retry); window.removeEventListener('online', retry); setPassportMapCountries([]);
  });
  void refresh();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
