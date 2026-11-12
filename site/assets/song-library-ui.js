import { t, normalizeLocale } from '../i18n/index.js?v=0.37.0';
import { getCurrentSongSnapshot, subscribeCurrentSong } from './metadata-enrichment.js?v=0.37.0';
import {
  emptySongLibrary, normalizeSong, songId, songServiceLinks, libraryEntries,
  setSongLiked, recordHeardSongs, clearSongHistory, removeSong, setSongHistoryEnabled,
  addSongsFromLibrary, exportSongLibrary, importSongLibrary, ListeningSession
} from './song-library-core.js?v=0.37.0';
import { songLibraryStore, getSongLibraryAccount, subscribeSongLibraryAccount } from './song-library-store.js?v=0.37.0';

const byId = id => document.getElementById(id);
const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const locale = () => normalizeLocale(document.documentElement.lang);
const tr = (key, params) => t(`music.${key}`, params, locale());
const publicError = error => tr(error?.code === 'ACCOUNT_CHANGED' ? 'accountChanged' : error?.code === 'LIBRARY_FULL' ? 'full'
  : ['LIBRARY_SYNC_PENDING', 'LIBRARY_NOT_READY'].includes(error?.code) ? 'syncPending' : error?.code === 'LIBRARY_UPDATE_REQUIRED' ? 'updateRequired' : 'saveFailed');

function services(destination, song) {
  const links = songServiceLinks(song);
  destination.replaceChildren(...links.map(item => {
    const anchor = node('a', '', undefined); anchor.href = item.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.referrerPolicy = 'no-referrer';
    anchor.setAttribute('aria-label', tr(item.kind === 'track' ? 'openOn' : 'searchOn', { service: item.service }));
    anchor.append(node('span', '', item.service), node('small', '', tr(item.kind === 'track' ? 'trackLink' : 'searchLink'))); return anchor;
  }));
}
function dateLabel(at) {
  try { return at ? new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at)) : ''; }
  catch { return ''; }
}

function start() {
  const feed = byId('er-song-feed'), dialog = byId('er-song-details'), audio = byId('audio-player');
  if (!feed || !dialog || !audio) return;
  const store = songLibraryStore(), listening = new ListeningSession();
  let doc = emptySongLibrary(), snapshot = null, current = null, view = 'recent', shown = 20;
  let busy = false, refreshing = false, refreshAgain = false, metadataGeneration = 0, errorText = '';
  let detail = null, detailInvoker = null, undo = null, undoTimer = null, sleepMirror = null, pendingFocus = null;
  const pendingHeard = new Map();

  function message(text, nowPlaying = false) {
    byId(nowPlaying ? 'er-song-now-message' : 'er-song-library-message').textContent = text;
  }
  function renderMain() {
    const button = byId('er-song-like'), liked = Boolean(current && doc.tracks[current.id]?.liked);
    button.disabled = !current || !snapshot?.canWrite || busy || !getSongLibraryAccount().ready;
    button.setAttribute('aria-pressed', String(liked)); button.dataset.i18n = liked ? 'music.songLiked' : 'music.likeSong'; button.textContent = tr(liked ? 'songLiked' : 'likeSong');
    services(byId('er-song-services'), current);
    if (detail && dialog.open) {
      const control = byId('er-song-detail-like');
      if (control && detail.song) {
        const saved = Boolean(doc.tracks[detail.song.id]?.liked); control.disabled = !snapshot?.canWrite || busy;
        control.setAttribute('aria-pressed', String(saved)); control.textContent = tr(saved ? 'songLiked' : 'likeSong');
      }
    }
    for (const control of document.querySelectorAll('[data-song-like], [data-song-remove], #er-song-history-enabled, #er-song-clear, #er-song-import, #er-song-add-local')) control.disabled = !snapshot?.canWrite || busy;
  }
  function renderFeed() {
    if (busy) return;
    const active = document.activeElement, oldRows = [...feed.querySelectorAll('[data-song-id]')];
    const focusedRow = active?.closest?.('[data-song-id]'), restore = focusedRow && feed.contains(active)
      ? { id: focusedRow.dataset.songId, index: oldRows.indexOf(focusedRow), action: active.hasAttribute('data-song-like') ? 'like' : 'details' }
      : active === document.body ? pendingFocus : null;
    pendingFocus = null;
    const entries = libraryEntries(doc, view);
    const rows = entries.slice(0, shown).map(entry => {
      const row = node('article', 'er-song-row'); row.dataset.songId = entry.id;
      const art = entry.track.artworkUrl ? node('img', 'er-song-row-art') : node('span', 'er-song-row-art', [...entry.track.artist][0] || '♪');
      if (entry.track.artworkUrl) { art.src = entry.track.artworkUrl; art.alt = ''; art.loading = 'lazy'; art.referrerPolicy = 'no-referrer'; }
      else art.setAttribute('aria-hidden', 'true');
      const copy = node('div', 'er-song-row-copy');
      copy.append(node('h4', '', entry.track.title), node('p', '', entry.track.artist), node('small', '', [entry.stationName, dateLabel(view === 'liked' ? entry.likeChangedAt : entry.heardAt)].filter(Boolean).join(' · ')));
      const like = node('button', '', entry.liked ? '♥' : '♡'); like.type = 'button'; like.dataset.songLike = entry.id; like.disabled = !snapshot?.canWrite || busy;
      like.setAttribute('aria-pressed', String(entry.liked)); like.setAttribute('aria-label', tr(entry.liked ? 'unlikeFor' : 'likeFor', { title: entry.track.title }));
      const info = node('button', '', '⋯'); info.type = 'button'; info.dataset.songDetails = entry.id; info.setAttribute('aria-label', tr('detailsFor', { title: entry.track.title }));
      row.append(art, copy, like, info); return row;
    });
    feed.replaceChildren(...(rows.length ? rows : [node('p', 'er-song-empty', errorText || tr(view === 'liked' ? 'likedEmpty' : 'recentEmpty'))]));
    byId('er-song-more').hidden = entries.length <= shown;
    for (const button of document.querySelectorAll('[data-song-view]')) button.setAttribute('aria-pressed', String(button.dataset.songView === view));
    const owner = getSongLibraryAccount();
    byId('er-song-library-status').textContent = errorText || (!owner.ready || owner.accountId && !snapshot?.canWrite ? tr('syncPending') : tr(owner.accountId ? 'accountLibrary' : 'localOnly'));
    byId('er-song-history-enabled').checked = doc.historyEnabled;
    byId('er-song-history-enabled').disabled = !snapshot?.canWrite || busy;
    byId('er-song-clear').disabled = !snapshot?.canWrite || busy;
    byId('er-song-export').disabled = !snapshot;
    byId('er-song-import').disabled = !snapshot?.canWrite || busy;
    if (restore) {
      const match = [...feed.querySelectorAll('[data-song-id]')].find(row => row.dataset.songId === restore.id)
        || feed.querySelectorAll('[data-song-id]')[Math.min(restore.index, rows.length - 1)];
      (match?.querySelector(restore.action === 'like' ? '[data-song-like]' : '[data-song-details]') || document.querySelector(`[data-song-view="${view}"]`))?.focus({ preventScroll: true });
    }
  }
  async function refresh() {
    refreshAgain = true; if (refreshing) return; refreshing = true;
    try {
      while (refreshAgain) {
        refreshAgain = false;
        const owner = getSongLibraryAccount();
        try {
          const value = await store.read();
          if (getSongLibraryAccount().version !== owner.version) continue;
          snapshot = value; doc = value.value || emptySongLibrary(); errorText = '';
          for (const [id, pending] of pendingHeard) if (!doc.historyEnabled || pending.historyEpoch !== doc.historyEpoch || pending.ownerVersion !== owner.version) pendingHeard.delete(id);
          const available = await store.guestSongsAvailable();
          if (getSongLibraryAccount().version !== owner.version) continue;
          byId('er-song-add-local').hidden = !available;
          byId('er-song-add-local').disabled = !value.canWrite || busy;
        } catch (error) {
          if (getSongLibraryAccount().version !== owner.version) continue;
          snapshot = null; doc = emptySongLibrary(); errorText = publicError(error); byId('er-song-add-local').hidden = true;
        }
        renderMain(); renderFeed();
        flushHeard();
      }
    } finally { refreshing = false; }
  }
  async function perform(transform, { quiet = false, success = 'saved' } = {}) {
    if (busy) return false;
    const focused = document.activeElement, focusedRow = focused?.closest?.('[data-song-id]');
    if (focusedRow && feed.contains(focused)) pendingFocus = { id: focusedRow.dataset.songId,
      index: [...feed.querySelectorAll('[data-song-id]')].indexOf(focusedRow), action: focused.hasAttribute('data-song-like') ? 'like' : 'details' };
    const owner = getSongLibraryAccount(); busy = true; renderMain();
    try {
      const value = await store.mutate(transform, owner.version); if (getSongLibraryAccount().version !== owner.version) return false;
      doc = value || emptySongLibrary();
      if (!quiet) message(tr(success)); message('', true); return { value: doc };
    } catch (error) {
      if (getSongLibraryAccount().version === owner.version && !quiet) { message(publicError(error)); message(publicError(error), true); }
      return false;
    } finally { busy = false; renderMain(); void refresh(); }
  }

  function flushHeard() {
    const owner = getSongLibraryAccount();
    if (busy || !snapshot?.canWrite || !owner.ready || !doc.historyEnabled) return;
    const batch = [...pendingHeard.values()].filter(item => item.ownerVersion === owner.version && item.historyEpoch === doc.historyEpoch && item.attempts < 3 && item.retryAt <= performance.now());
    if (!batch.length) return;
    for (const item of batch) { ++item.attempts; item.retryAt = performance.now() + 5000; }
    void perform(value => recordHeardSongs(value, batch), { quiet: true }).then(saved => {
      if (!saved || getSongLibraryAccount().version !== owner.version) return;
      for (const item of batch) if (pendingHeard.get(item.song.id) === item) pendingHeard.delete(item.song.id);
    });
  }

  function closeDetails({ historyChanged = false } = {}) {
    if (dialog.open) dialog.close(); delete dialog.dataset.songKind;
    detail = null; byId('er-song-details-content').replaceChildren(); byId('er-song-identify-row').hidden = true;
    if (!historyChanged && history.state?.erSongDetails) history.back();
    if (detailInvoker?.isConnected) detailInvoker.focus({ preventScroll: true }); detailInvoker = null;
  }
  function requestCloseDetails() { if (history.state?.erSongDetails) history.back(); else closeDetails(); }
  function mirrorIdentify() {
    const source = byId('metadata-fingerprint-btn'), row = byId('metadata-fingerprint-row'), target = byId('er-song-identify');
    const visible = dialog.open && dialog.dataset.songKind === 'current' && source && row && !row.hidden;
    byId('er-song-identify-row').hidden = !visible;
    if (visible) { target.disabled = source.disabled; target.textContent = source.textContent === 'Identify song' ? tr('identify') : tr('identifying'); byId('er-song-identify-status').textContent = byId('metadata-fingerprint-status')?.textContent || ''; }
  }
  function fillDetails() {
    const destination = byId('er-song-details-content'), song = detail?.song;
    if (!song) {
      const heading = node('h2', '', byId('player-station')?.textContent || tr('details')); heading.id = 'er-song-details-title';
      destination.replaceChildren(heading, node('p', 'er-song-detail-artist', tr('waiting'))); mirrorIdentify(); return;
    }
    const heading = node('h2', '', song.title); heading.id = 'er-song-details-title';
    const artist = node('p', 'er-song-detail-artist', song.artist), facts = node('dl', '');
    const record = doc.tracks[song.id];
    for (const [label, value] of [['artist', song.artist], ['album', song.album], ['genre', song.genre], ['released', song.releaseYear], ['isrc', song.isrc],
      ['station', detail.stationName || song.stationName], ['heardOn', record?.heardAt ? dateLabel(record.heardAt) : ''], ['source', tr(song.catalogMatched ? 'matched' : 'fromStation')]]) {
      if (value) facts.append(node('dt', '', tr(label)), node('dd', '', String(value)));
    }
    const links = node('nav', 'er-song-services'); links.setAttribute('aria-label', tr('services')); services(links, song);
    const like = node('button', 'er-song-detail-action', tr('likeSong')); like.id = 'er-song-detail-like'; like.type = 'button'; like.dataset.songDetailLike = song.id;
    const remove = node('button', 'er-song-detail-remove', tr('removeSong')); remove.type = 'button'; remove.dataset.songRemove = song.id; remove.hidden = !record?.track;
    destination.replaceChildren(heading, artist, facts, links, like, remove); renderMain(); mirrorIdentify();
  }
  function openDetails(id, invoker) {
    const record = id === 'current' ? null : doc.tracks[id];
    const song = id === 'current' ? current && structuredClone(current) : record?.track && { ...record.track, id };
    detail = { song, stationName: record?.stationName || song?.stationName || '', followIdentification: id === 'current' && !song };
    dialog.dataset.songKind = id === 'current' ? 'current' : 'history';
    dialog.querySelector('.er-song-broadcast-details').hidden = id !== 'current';
    detailInvoker = invoker; fillDetails();
    if (!dialog.open) { dialog.showModal(); history.pushState({ ...(history.state || {}), erSongDetails: true }, ''); }
    mirrorIdentify(); dialog.querySelector('[data-song-details-close]').focus();
  }
  async function metadataChanged(value) {
    const generation = ++metadataGeneration;
    try {
      const song = normalizeSong(value), id = song ? await songId(song) : '';
      if (generation !== metadataGeneration) return;
      current = song && { ...song, id }; listening.setTrack(current); renderMain();
      if (dialog.open && dialog.dataset.songKind === 'current' && detail) {
        if (detail.followIdentification && current) { detail.song = structuredClone(current); detail.followIdentification = false; fillDetails(); }
        else if (detail.song && (!current || current.id !== detail.song.id || current.stationUuid !== detail.song.stationUuid)) {
          dialog.dataset.songKind = 'history'; dialog.querySelector('.er-song-broadcast-details').hidden = true; byId('er-song-identify-row').hidden = true;
        }
      }
    } catch { current = null; listening.setTrack(null); renderMain(); }
  }
  function sample() {
    if (!getSongLibraryAccount().ready || !snapshot?.canWrite || !doc.historyEnabled) { listening.sample({ mediaTime: 0, now: performance.now(), playing: false }); return; }
    const song = listening.sample({ mediaTime: audio.currentTime, now: performance.now(),
      playing: !audio.paused && !audio.ended && !audio.muted && audio.volume > 0 && audio.readyState >= 3, seeking: audio.seeking });
    if (song) {
      pendingHeard.delete(song.id);
      pendingHeard.set(song.id, { song, at: Date.now(), historyEpoch: doc.historyEpoch, ownerVersion: getSongLibraryAccount().version, attempts: 0, retryAt: 0 });
      while (pendingHeard.size > 200) pendingHeard.delete(pendingHeard.keys().next().value);
    }
    flushHeard();
  }
  for (const event of ['timeupdate', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'volumechange']) audio.addEventListener(event, sample);
  subscribeCurrentSong(value => { void metadataChanged(value); });
  subscribeSongLibraryAccount(() => {
    ++metadataGeneration; snapshot = null; doc = emptySongLibrary(); current = null; listening.setTrack(null); pendingHeard.clear(); undo = null; pendingFocus = null; clearTimeout(undoTimer);
    if (dialog.open) closeDetails(); renderMain(); renderFeed();
    void metadataChanged(getCurrentSongSnapshot()); void refresh();
  });
  store.subscribe(() => void refresh());
  const metadataRoot = byId('nowcard');
  if (metadataRoot) new MutationObserver(mirrorIdentify).observe(metadataRoot, { subtree: true, childList: true, attributes: true, characterData: true });
  new MutationObserver(() => { renderMain(); renderFeed(); if (dialog.open) fillDetails(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null; if (!target) return;
    const open = target.closest('[data-song-details]'); if (open) { openDetails(open.dataset.songDetails, open); return; }
    if (target.closest('[data-song-details-close]')) { requestCloseDetails(); return; }
    const tab = target.closest('[data-song-view]'); if (tab) { view = tab.dataset.songView; shown = 20; renderFeed(); return; }
    const like = target.closest('#er-song-like, [data-song-like], [data-song-detail-like]');
    if (like && !like.disabled) {
      const id = like.id === 'er-song-like' ? current?.id : like.dataset.songLike || like.dataset.songDetailLike;
      const song = id === current?.id ? current : id === detail?.song?.id ? detail.song : doc.tracks[id]?.track && { ...doc.tracks[id].track, id };
      if (!song) return; const captured = structuredClone(song), desired = !doc.tracks[id]?.liked;
      void perform(value => setSongLiked(value, captured, desired)); return;
    }
    const remove = target.closest('[data-song-remove]');
    if (remove) {
      const id = remove.dataset.songRemove, before = structuredClone(doc), at = Date.now(), ownerVersion = getSongLibraryAccount().version;
      void perform(value => removeSong(value, id, at), { success: 'removed' }).then(saved => {
        if (!saved || getSongLibraryAccount().version !== ownerVersion) return;
        closeDetails(); undo = { before, id, ownerVersion, after: structuredClone(saved.value.tracks[id]), epoch: saved.value.historyEpoch };
        const button = node('button', 'er-song-undo', tr('undo')); button.type = 'button'; button.dataset.songUndo = 'true';
        byId('er-song-library-message').append(' ', button); clearTimeout(undoTimer); undoTimer = setTimeout(() => { undo = null; button.remove(); }, 10000);
      }); return;
    }
    if (target.closest('[data-song-undo]') && undo) {
      const saved = undo; undo = null; clearTimeout(undoTimer);
      void perform(value => {
        const row = value.tracks[saved.id];
        if (getSongLibraryAccount().version !== saved.ownerVersion || value.historyEpoch !== saved.epoch || row?.likeVersion !== saved.after?.likeVersion || row?.heardVersion !== saved.after?.heardVersion) throw new Error('Songs changed');
        const source = { ...emptySongLibrary(), tracks: { [saved.id]: saved.before.tracks[saved.id] } };
        return addSongsFromLibrary(value, source);
      });
    }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestCloseDetails(); });
  window.addEventListener('popstate', event => { if (dialog.open && !event.state?.erSongDetails) closeDetails({ historyChanged: true }); });
  byId('er-song-more').addEventListener('click', () => { shown += 20; renderFeed(); });
  byId('er-song-history-enabled').addEventListener('change', event => { const enabled = event.target.checked; if (!enabled) pendingHeard.clear(); void perform(value => setSongHistoryEnabled(value, enabled)); });
  byId('er-song-clear').addEventListener('click', () => { if (window.confirm(tr('confirmClear'))) { pendingHeard.clear(); const at = Date.now(); void perform(value => clearSongHistory(value, at), { success: 'cleared' }); } });
  byId('er-song-add-local').addEventListener('click', async () => {
    if (busy) return; const owner = getSongLibraryAccount(); busy = true; renderMain();
    try { await store.importGuest(owner.version); if (getSongLibraryAccount().version === owner.version) message(tr('added')); }
    catch (error) { if (getSongLibraryAccount().version === owner.version) message(publicError(error)); }
    finally { busy = false; renderMain(); void refresh(); }
  });
  byId('er-song-export').addEventListener('click', async () => {
    try {
      const value = await store.read(); if (value.ownerVersion !== getSongLibraryAccount().version) return;
      const url = URL.createObjectURL(new Blob([exportSongLibrary(value.value)], { type: 'application/json' }));
      const anchor = node('a'); anchor.href = url; anchor.download = `EarthRadio-Songs-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { message(publicError(error)); }
  });
  byId('er-song-import').addEventListener('change', async event => {
    const file = event.target.files?.[0], owner = getSongLibraryAccount(); if (!file) return;
    try {
      if (file.size > 2097152) throw new Error('Invalid song library file');
      const imported = importSongLibrary(await file.text());
      if (getSongLibraryAccount().version !== owner.version) return;
      await perform(value => addSongsFromLibrary(value, imported), { success: 'imported' });
    } catch { message(tr('importFailed')); }
    finally { event.target.value = ''; }
  });
  const timer = byId('er-nowplaying-timer');
  timer.addEventListener('change', () => { if (/^(0|15|30|60)$/.test(timer.value)) document.querySelector(`#sleep-menu [data-min="${timer.value}"]`)?.click(); });
  document.addEventListener('click', event => {
    const choice = event.target instanceof Element && event.target.closest('#sleep-menu [data-min]'); if (!choice) return;
    const minutes = Number(choice.dataset.min); if (![0, 15, 30, 60].includes(minutes)) return;
    timer.value = String(minutes); clearTimeout(sleepMirror); if (minutes) sleepMirror = setTimeout(() => { timer.value = '0'; }, minutes * 60000);
  }, true);
  const retryHeard = () => { for (const item of pendingHeard.values()) { item.attempts = 0; item.retryAt = 0; } void refresh(); };
  window.addEventListener('focus', retryHeard);
  window.addEventListener('online', retryHeard);
  void refresh();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
