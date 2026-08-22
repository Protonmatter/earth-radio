import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_SPLIT,
  MIN_LIST_PX,
  MIN_MAP_PX,
  clampSplitPercent,
  nextCollapse,
  parseDestination,
  parseNowPlayingHistory,
  sanitizeUiState
} from '../site/assets/responsive-ui.js';

const root = path.resolve(import.meta.dirname, '..');

test('destination parsing honors approved fragments and ignores runtime query hashes', () => {
  assert.equal(parseDestination('#listen'), 'listen');
  assert.equal(parseDestination('#search'), 'search');
  assert.equal(parseDestination('#map'), 'map');
  assert.equal(parseDestination('#saved'), 'saved');
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

test('invalid presentation preferences are ignored and clamped', () => {
  assert.deepEqual(sanitizeUiState(null).destination, 'listen');
  assert.equal(sanitizeUiState({ destination: 'explore' }).destination, 'listen');
  assert.equal(sanitizeUiState({ split: 3, viewportWidth: 1440 }).split >= 20, true);
  assert.equal(sanitizeUiState({ collapsed: 'both' }).collapsed, null);
  assert.equal(sanitizeUiState({ locale: 'zh' }).locale, 'en');
  assert.equal(sanitizeUiState({ locale: 'zh-Hant' }).locale, 'zh-Hant');
  assert.equal(sanitizeUiState({ savedSegment: 'similar' }).savedSegment, 'favorites');
});

test('Now Playing history state is distinct from runtime hash writes', () => {
  assert.equal(parseNowPlayingHistory({ erNowPlaying: true }), true);
  assert.equal(parseNowPlayingHistory({ erNowPlaying: false }), false);
  assert.equal(parseNowPlayingHistory(null), false);
});

test('responsive assets are referenced after the recovered runtime and staged as site files', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const runtime = html.indexOf('index-B4rKOAHV.js');
  const layer = html.indexOf('responsive-ui.js');
  assert.ok(runtime >= 0 && layer > runtime);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /playsinline/);
  assert.match(html, /zh-Hans/);
  assert.match(html, /zh-Hant/);
  assert.match(html, /er-mobile-nav/);
  assert.match(html, /responsive-ui.css/);
});
