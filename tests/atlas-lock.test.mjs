import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DESTINATIONS, parseDestination, sanitizeUiState } from '../site/assets/responsive-ui.js';
import { t } from '../site/i18n/index.js';

const root = path.resolve(import.meta.dirname, '..');

test('phone destinations are Atlas, Browse, Kept, and You', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  const nav = html.match(/<nav class="er-mobile-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'missing mobile nav');
  const dests = [...nav[0].matchAll(/data-er-dest="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(dests, ['map', 'listen', 'saved', 'you']);
  assert.equal(nav[0].includes('data-er-dest="search"'), false);
  assert.match(html, /id="er-you"/);
  assert.match(html, /atlas-lock\.css/);
  assert.match(html, /atlas-lock\.js/);
  assert.match(html, /class="header-right"[\s\S]*data-er-dest="you"[\s\S]*kbd-hint/);
  assert.ok(html.indexOf('id="er-you"') < html.indexOf('id="player-bar"'));
  assert.ok(html.indexOf('</main>') < html.indexOf('id="er-you"'));
});

test('search copy and markup put places first', async () => {
  const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
  assert.equal(t('search.stationPlaceholder', undefined, 'en'), 'Country, city, or station');
  assert.equal(t('nav.map', undefined, 'en'), 'Atlas');
  assert.equal(t('nav.listen', undefined, 'en'), 'Browse');
  assert.equal(t('nav.saved', undefined, 'en'), 'Kept');
  assert.equal(t('nav.you', undefined, 'en'), 'You');
  const country = html.indexOf('id="er-country-query"');
  const station = html.indexOf('id="er-station-query"');
  assert.ok(country > 0 && station > country);
});

test('You is a first-class destination and glass/palette persist', () => {
  assert.ok(DESTINATIONS.includes('you'));
  assert.equal(parseDestination('#you'), 'you');
  assert.equal(sanitizeUiState({ destination: 'you' }).destination, 'you');
  assert.equal(sanitizeUiState({ glassLog: true }).glassLog, true);
  assert.equal(sanitizeUiState({ glassLog: false }).glassLog, false);
  assert.equal(sanitizeUiState({ palette: 'paper' }).palette, 'paper');
  assert.equal(sanitizeUiState({ palette: 'night' }).palette, 'night');
  assert.equal(sanitizeUiState({ palette: 'system' }).palette, 'night');
});

test('glass frosts only the log, and Night/Paper replace system theme', async () => {
  const css = await readFile(path.join(root, 'site', 'assets', 'atlas-lock.css'), 'utf8');
  const js = await readFile(path.join(root, 'site', 'assets', 'responsive-ui.js'), 'utf8');
  const lock = await readFile(path.join(root, 'site', 'assets', 'atlas-lock.js'), 'utf8');
  const scenarios = await readFile(path.join(root, 'tests', 'browser', 'scenarios.mjs'), 'utf8');
  const headers = await readFile(path.join(root, 'site', '_headers'), 'utf8');
  assert.match(css, /html\.er-glass-log\.er-root #grid-panel/);
  assert.match(css, /backdrop-filter: none/);
  assert.match(css, /data-er-palette="night"/);
  assert.match(css, /data-er-palette="paper"/);
  assert.match(js, /loadUiState\(\)\.palette === 'paper' \? 'light' : 'dark'/);
  assert.match(js, /destination === 'you' && loadUiState\(\)\.destination === 'you'/);
  assert.match(lock, /saveUiState\(\{ palette/);
  assert.match(lock, /glassLog/);
  assert.doesNotMatch(scenarios, /data-er-dest="search"/);
  assert.match(scenarios, /data-er-open-search/);
  for (const asset of ['atlas-lock.css', 'atlas-lock.js']) {
    assert.match(
      headers,
      new RegExp(`/assets/${asset}\\n\\s+Cache-Control: public, max-age=300, must-revalidate`)
    );
  }
});
