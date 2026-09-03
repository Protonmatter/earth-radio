import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { SCENARIOS } from './browser/scenarios.mjs';
import {
  DEFAULT_SPLIT,
  MIN_LIST_PX,
  MIN_MAP_PX,
  clampSplitPercent,
  advanceLocalePreview,
  nextCollapse,
  nowPlayingSheetCopy,
  parseDestination,
  parseNowPlayingHistory,
  resolveInitialLocale,
  resolveThemePreference,
  sanitizeUiState
} from '../site/assets/responsive-ui.js';

const root = path.resolve(import.meta.dirname, '..');

test('destination parsing honors approved fragments and ignores runtime query hashes', () => {
  assert.equal(parseDestination('#listen'), 'listen');
  assert.equal(parseDestination('#search'), 'search');
  assert.equal(parseDestination('#map'), 'map');
  assert.equal(parseDestination('#saved'), 'saved');
  assert.equal(parseDestination('#you'), 'you');
  assert.equal(parseDestination('#unknown'), 'listen');
  assert.equal(parseDestination('#station=abc&view=favorites'), null);
  assert.equal(parseDestination('#view=recent'), null);
  assert.equal(parseDestination(''), null);
});

test('split percentages clamp to usable list and map minimums', () => {
  assert.equal(clampSplitPercent(42, 1440), 42);
  assert.equal(clampSplitPercent(5, 1280) * 1280 / 100 >= MIN_LIST_PX - 1, true);
  assert.equal((100 - clampSplitPercent(95, 1280)) * 1280 / 100 >= MIN_MAP_PX - 1, true);
  assert.equal(clampSplitPercent('nope', 1440), DEFAULT_SPLIT);
  assert.equal(clampSplitPercent(42, MIN_LIST_PX + MIN_MAP_PX - 20), DEFAULT_SPLIT);
});

test('collapse invariants refuse to hide both panels', () => {
  assert.deepEqual(nextCollapse(null, 'map'), 'map');
  assert.deepEqual(nextCollapse('map', 'map'), null);
  assert.deepEqual(nextCollapse('map', 'list'), 'list');
  assert.deepEqual(nextCollapse('list', 'list'), null);
});

test('Now Playing sheet copy prefers a live track over the station name', () => {
  assert.deepEqual(nowPlayingSheetCopy({
    station: '102.7 KIIS FM',
    facts: 'United States · 0 kbps · AAC',
    trackTitle: 'Stupid Song',
    trackArtist: 'Olivia Rodrigo | Pop',
    playerTrack: 'Olivia Rodrigo \u2013 Stupid Song'
  }), { title: 'Stupid Song', meta: 'Olivia Rodrigo | Pop' });
  assert.deepEqual(nowPlayingSheetCopy({
    station: 'BBC World Service',
    facts: 'United Kingdom · 56 kbps · MP3',
    trackTitle: '-',
    playerTrack: ''
  }), { title: 'BBC World Service', meta: 'United Kingdom · 56 kbps · MP3' });
  assert.deepEqual(nowPlayingSheetCopy({
    station: '102.7 KIIS FM',
    facts: 'United States · 0 kbps · AAC',
    trackTitle: 'LA',
    trackArtist: 'Live radio',
    playerTrack: ''
  }), { title: '102.7 KIIS FM', meta: 'United States · 0 kbps · AAC' });
  assert.deepEqual(nowPlayingSheetCopy({
    station: 'LISTEN.moe',
    facts: 'Japan · 128 kbps · MP3',
    playerTrack: 'GARNiDELiA \u2013 Diamond'
  }), { title: 'Diamond', meta: 'GARNiDELiA' });
});

test('invalid presentation preferences are ignored and clamped', () => {
  assert.deepEqual(sanitizeUiState(null).destination, 'listen');
  assert.equal(sanitizeUiState({ destination: 'explore' }).destination, 'listen');
  assert.equal(sanitizeUiState({ split: 3, viewportWidth: 1440 }).split >= 20, true);
  assert.equal(sanitizeUiState({ collapsed: 'both' }).collapsed, null);
  assert.equal(sanitizeUiState({ locale: 'zh' }).locale, 'en');
  assert.equal(sanitizeUiState({ locale: 'zh-Hant' }).locale, 'zh-Hant');
  assert.equal(sanitizeUiState({ savedSegment: 'similar' }).savedSegment, 'favorites');
  assert.equal(sanitizeUiState(null).localeExplicit, false);
  assert.equal(sanitizeUiState({ locale: 'en' }).localeExplicit, true);
});

test('explicit locale and system theme preferences survive initialization', () => {
  assert.equal(resolveInitialLocale({ locale: 'en', localeExplicit: true }, ['ko-KR']), 'en');
  assert.equal(resolveInitialLocale({ locale: 'en', localeExplicit: false }, ['ko-KR']), 'ko');
  assert.equal(resolveInitialLocale({ locale: 'zh-Hant', localeExplicit: true }, ['en-US']), 'zh-Hant');
  assert.equal(resolveThemePreference('system', true), 'dark');
  assert.equal(resolveThemePreference('system', false), 'light');
  assert.equal(resolveThemePreference('dark', false), 'dark');
  assert.equal(resolveThemePreference('invalid', true), 'dark');
});

test('locale preview transition leaves the persisted locale untouched', () => {
  assert.deepEqual(
    advanceLocalePreview({ persistedLocale: 'en', previewLocale: null, selectedLocale: 'en' }, { type: 'preview', locale: 'ar' }),
    { persistedLocale: 'en', previewLocale: 'ar', selectedLocale: 'ar' }
  );
});

test('locale preview dismissal clears the preview and resets the selection to the persisted locale', () => {
  assert.deepEqual(
    advanceLocalePreview({ persistedLocale: 'en', previewLocale: 'ar', selectedLocale: 'ar' }, { type: 'dismiss' }),
    { persistedLocale: 'en', previewLocale: null, selectedLocale: 'en' }
  );
});

test('locale preview save commits the selected locale and clears the preview', () => {
  assert.deepEqual(
    advanceLocalePreview({ persistedLocale: 'en', previewLocale: 'ar', selectedLocale: 'ar' }, { type: 'save' }),
    { persistedLocale: 'ar', previewLocale: null, selectedLocale: 'ar' }
  );
});

test('locale rendered scenarios use real modal controls and state barriers', () => {
  const byScenarioId = new Map(SCENARIOS.map(scenario => [scenario.id, scenario]));
  const ids = [
    'settings-locale-preview-ar-390x844',
    'settings-locale-preview-cancel-390x844',
    'settings-locale-preview-save-390x844',
    'settings-locale-preview-close-390x844',
    'settings-locale-preview-backdrop-390x844',
    'settings-locale-preview-escape-390x844',
    'settings-locale-preview-reopen-390x844'
  ];
  for (const id of ids) {
    const scenario = byScenarioId.get(id);
    assert.ok(scenario, `${id} is missing`);
    assert.ok(scenario.actions.some(action => action.type === 'waitFor'), `${id} has no deterministic barrier`);
    assert.equal(scenario.actions.some(action => action.type === 'wait'), false, `${id} uses a timing sleep`);
    assert.equal(scenario.actions.some(action => /stopImmediatePropagation/.test(action.code || '')), false, `${id} bypasses a runtime handler`);
  }
  const save = byScenarioId.get('settings-locale-preview-save-390x844');
  assert.equal(save.actions.some(action => action.type === 'click' && action.selector === '#settings-save'), true);
  assert.equal(save.actions.some(action => action.type === 'markNavigation'), true, 'Save has no reload checkpoint');
  const postReload = save.actions.find(action => action.type === 'waitForNavigation');
  assert.ok(postReload, 'Save does not wait for a cross-navigation barrier');
  assert.match(postReload.expression, /earthRadio\.preferences\.v1/);
  assert.match(postReload.expression, /sessionStorage/);
});

test('Now Playing history state is distinct from runtime hash writes', () => {
  assert.equal(parseNowPlayingHistory({ erNowPlaying: true }), true);
  assert.equal(parseNowPlayingHistory({ erNowPlaying: false }), false);
  assert.equal(parseNowPlayingHistory(null), false);
});

test('responsive assets are referenced after the recovered runtime and staged as site files', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const runtime = html.indexOf('index-690938fe.js');
  const layer = html.indexOf('responsive-ui.js');
  assert.ok(runtime >= 0 && layer > runtime);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /playsinline/);
  assert.match(html, /zh-Hans/);
  assert.match(html, /zh-Hant/);
  assert.match(html, /er-mobile-nav/);
  assert.match(html, /responsive-ui.css/);
  assert.match(html, /data-i18n-attr="aria-label"/);
  assert.match(html, /er-icon-search/);
  assert.match(html, /id="er-nowplaying-metadata"/);
  assert.match(html, /data-er-sleep-min="30"/);
});

test('overflow menu can become visible and search occupies the mobile workspace', async () => {
  const source = await readFile(path.join(root, 'site', 'assets', 'responsive-ui.js'), 'utf8');
  assert.match(source, /targetId === 'settings-toggle' \|\| targetId === 'filters-toggle' \|\| targetId === 'er-auth-button'/);
  assert.match(source, /targetId === 'er-auth-button' \? document\.querySelector\('\.er-auth-modal'\)/);
  const css = await readFile(path.join(root, 'site', 'assets', 'responsive-ui.css'), 'utf8');
  assert.match(css, /\.er-overflow:not\(\[hidden\]\)\s*\{\s*display:\s*grid;/);
  assert.match(css, /html\.er-mobile \.search-modal\.er-search-destination\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(css, /html\.er-mobile \.search-modal\.er-search-destination\s*\{[\s\S]*padding:\s*0;/);
  assert.match(css, /html\.er-root \.player-info\s*\{[\s\S]*appearance:\s*none;/);
  assert.match(css, /html\.er-root #toast-container\s*\{[\s\S]*top:\s*calc\(var\(--er-header\)/);
  assert.match(css, /\.er-nowplaying-art\s*\{[\s\S]*flex-shrink:\s*0;/);
  // Header favorites/recent listeners exist only after the recovered runtime
  // finishes loadStations(). Clicking those toggles during overlay start()
  // selects Saved chrome without applying the filter.
  const startSource = source.slice(source.lastIndexOf('function start()'));
  const setDestSource = source.slice(
    source.indexOf('function setDestination'),
    source.indexOf('function applySavedSegment')
  );
  assert.match(source, /querySelectorAll\('button\[data-er-saved\]'\)/);
  assert.match(source, /['"]earthradio:stations-load-settled['"]/);
  assert.match(
    startSource,
    /whenStationsLoadSettled\(\(\) => \{[\s\S]*if \(state\.destination === 'saved'\) applySavedSegment\(state\.savedSegment\)/
  );
  assert.match(setDestSource, /whenStationsLoadSettled/);
  assert.match(setDestSource, /applySavedSegment/);
});

test('stations-settled waiters stand down once the destination has moved on', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'responsive-ui.js'), 'utf8');
  // applySavedSegment() persists destination: 'saved', so any waiter queued before the
  // station load settled must re-check the current destination or it will drag a later
  // navigation back to Saved and make the newer waiter stand down instead.
  const setDestination = source.slice(source.indexOf('function setDestination('), source.indexOf('function applySavedSegment('));
  assert.match(setDestination, /if \(loadUiState\(\)\.destination !== destination\) return;/);
  assert.ok(
    setDestination.indexOf('if (loadUiState().destination !== destination) return;')
      < setDestination.indexOf("if (destination === 'saved') applySavedSegment("),
    'the guard must precede applySavedSegment()'
  );
  // The Favorites/Recent segment buttons queue their own waiter.
  const segmentWaiter = source.slice(source.indexOf("target.closest('button[data-er-saved]')"), source.indexOf("[data-er-open-search]"));
  assert.match(segmentWaiter, /if \(loadUiState\(\)\.destination !== 'saved'\) return;/);
  assert.ok(
    segmentWaiter.indexOf("if (loadUiState().destination !== 'saved') return;")
      < segmentWaiter.indexOf('applySavedSegment(segment)'),
    'the segment waiter needs the same guard'
  );
  const startupWaiter = source.slice(source.indexOf('  restoreStoredTheme();'), source.indexOf('  bindActions();'));
  assert.match(startupWaiter, /if \(loadUiState\(\)\.destination !== state\.destination\) return;/);
  assert.ok(
    startupWaiter.indexOf('if (loadUiState().destination !== state.destination) return;')
      < startupWaiter.indexOf("if (state.destination === 'saved') applySavedSegment("),
    'the startup waiter needs the same guard'
  );
});

test('the locked palette owns the inline color-scheme, not the runtime preference', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const source = await readFile(path.join(root, 'site', 'assets', 'responsive-ui.js'), 'utf8');
  const lock = await readFile(path.join(root, 'site', 'assets', 'atlas-lock.js'), 'utf8');
  // The runtime writes an inline color-scheme resolved against the OS, which outranks the
  // stylesheet for native controls; every path that settles data-theme must settle it too.
  assert.match(source, /function syncColorScheme\(theme\)/);
  assert.match(source, /if \(document\.documentElement\.style\.colorScheme !== theme\)/);
  const restore = source.slice(source.indexOf('function restoreStoredTheme()'), source.indexOf('let previewLocale'));
  assert.match(restore, /syncColorScheme\(theme\)/);
  const observer = source.slice(source.indexOf('const observer = new MutationObserver'), source.indexOf('observer.observe('));
  assert.match(observer, /syncColorScheme\(wantedTheme\)/);
  assert.ok(
    observer.indexOf('syncColorScheme(wantedTheme)') < observer.indexOf("dataset.theme !== wantedTheme"),
    'color-scheme must be reconciled on both observer branches'
  );
  // A late runtime write lands on style, so the observer has to watch it; the write guard
  // above is what keeps that from looping.
  assert.match(source, /attributeFilter: \['lang', 'dir', 'data-font-profile', 'data-theme', 'style'\]/);
  assert.match(lock, /if \(root\.style\.colorScheme !== theme\) root\.style\.colorScheme = theme;/);
});
