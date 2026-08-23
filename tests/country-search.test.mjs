import assert from 'node:assert/strict';
import test from 'node:test';
import * as responsive from '../site/assets/responsive-ui.js';

function requiredExport(name) {
  assert.equal(typeof responsive[name], 'function', `${name} must be implemented`);
  return responsive[name];
}

test('country options normalize counts, codes, flags, and deterministic ordering', () => {
  const buildCountryOptions = requiredExport('buildCountryOptions');
  const options = buildCountryOptions([
    { name: 'South Korea', count: '(8)' },
    { name: 'United States', count: '12' },
    { name: 'South Korea', count: 2 },
    { name: '', count: 99 }
  ]);

  assert.deepEqual(options, [
    { name: 'South Korea', code: 'KR', flag: '🇰🇷', count: 10 },
    { name: 'United States', code: 'US', flag: '🇺🇸', count: 12 }
  ]);
});

test('country option search accepts names, codes, and familiar aliases', () => {
  const buildCountryOptions = requiredExport('buildCountryOptions');
  const filterCountryOptions = requiredExport('filterCountryOptions');
  const options = buildCountryOptions([
    { name: 'South Korea', count: 8 },
    { name: 'United Kingdom', count: 6 },
    { name: 'United States', count: 12 }
  ]);

  assert.deepEqual(filterCountryOptions(options, 'kr').map(option => option.name), ['South Korea']);
  assert.deepEqual(filterCountryOptions(options, 'Britain').map(option => option.name), ['United Kingdom']);
  assert.deepEqual(filterCountryOptions(options, 'USA').map(option => option.name), ['United States']);
});

test('country and station terms form one normalized runtime query', () => {
  const buildCountryStationQuery = requiredExport('buildCountryStationQuery');
  assert.equal(buildCountryStationQuery('South Korea', '  jazz  '), 'South Korea jazz');
  assert.equal(buildCountryStationQuery('United States', ''), 'United States');
  assert.equal(buildCountryStationQuery('', 'news'), 'news');
});

test('strict result matching reads the country field instead of loose metadata', () => {
  const matchesSelectedCountry = requiredExport('matchesSelectedCountry');
  assert.equal(matchesSelectedCountry('South Korea · MP3 · 128 kbps · strong', 'South Korea'), true);
  assert.equal(matchesSelectedCountry('United States · AAC · 192 kbps · strong', 'South Korea'), false);
  assert.equal(matchesSelectedCountry('Korean music from United States · MP3', 'South Korea'), false);
  assert.equal(matchesSelectedCountry('Anything', ''), true);
});
