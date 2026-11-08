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

test('directory country names resolve to current ISO codes rather than retired Intl aliases', () => {
  const options = responsive.buildCountryOptions([
    {name:'France',count:3},{name:'Germany',count:2},
    {name:'The United Kingdom Of Great Britain And Northern Ireland',count:4},
    {name:'The Netherlands',count:5},{name:'Taiwan, Republic Of China',count:6}
  ]);
  assert.deepEqual(options.map(({name,code})=>({name,code})),[
    {name:'France',code:'FR'},{name:'Germany',code:'DE'},
    {name:'Netherlands',code:'NL'},{name:'Taiwan',code:'TW'},
    {name:'United Kingdom',code:'GB'}
  ]);
  assert.deepEqual(responsive.buildCountryOptions(['Vanuatu','Vietnam','Zimbabwe'].map(name=>({name,count:1}))).map(option=>option.code),['VU','VN','ZW']);
});

test('country picker shares generated aliases across all six UI locales', () => {
  const options = responsive.buildCountryOptions([
    {name: 'United States', count: 1}, {name: 'Poland', count: 1},
    {name: 'South Korea', count: 1}, {name: 'France', count: 1}
  ]);
  for (const [query, code] of [['미국','US'], ['波兰','PL'], ['波蘭','PL'], ['Corea del Sur','KR'], ['فرنسا','FR']]) {
    assert.deepEqual(responsive.filterCountryOptions(options, query).map(option => option.code), [code], query);
  }
});

test('recognized country codes and aliases cannot match substrings in other countries', () => {
  const options = responsive.buildCountryOptions(['South Korea','Ukraine','United Kingdom','United States','Australia','Russia','Austria'].map(name=>({name,count:1})));
  for(const [query,code] of [['KR','KR'],['uk','GB'],['US','US'],['usa','US'],['미국','US']]) {
    assert.deepEqual(responsive.filterCountryOptions(options,query).map(option=>option.code),[code],query);
  }
  assert.deepEqual(responsive.filterCountryOptions(options,'austr').map(option=>option.code).sort(),['AT','AU']);
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
