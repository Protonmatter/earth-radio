import assert from 'node:assert/strict';
import test from 'node:test';
import {
  byId,
  overlapArea,
  rendererUnavailableReason,
  runRenderedHarness
} from './browser/harness.mjs';
import { matchesSelectedCountry } from '../site/assets/responsive-ui.js';

const unavailable = rendererUnavailableReason();

function assertInsideLateralSafeArea(items, id, start = 50, end = 794) {
  const visible = items.filter(item => item.visible);
  assert.ok(visible.length > 0, `${id}: no visible safe-area content was probed`);
  for (const item of visible) {
    assert.ok(item.rect.left >= start, `${id}: content crosses the start safe area (${item.rect.left}px)`);
    assert.ok(item.rect.right <= end, `${id}: content crosses the end safe area (${item.rect.right}px)`);
  }
}

test('responsive UI rendered matrix preserves layout, actions, and locale contracts', {
  skip: unavailable || false,
  timeout: 180_000
}, async () => {
  const payload = await runRenderedHarness();
  assert.equal(payload.complete, true);
  assert.equal(payload.results.some(result => result.error), false);

  for (const result of payload.results) {
    assert.equal(result.ready, true, `${result.id}: responsive controller did not become ready`);
    assert.equal(result.probe.viewport.width, Math.round(result.width / result.zoom), `${result.id}: width`);
    assert.equal(result.probe.viewport.height, Math.round(result.height / result.zoom), `${result.id}: height`);
    assert.ok(result.probe.horizontalOverflow <= 0, `${result.id}: horizontal document overflow`);
    assert.ok(result.probe.bodyOverflow <= 0, `${result.id}: horizontal body overflow`);
  }

  for (const id of ['mobile-listen-390x844', 'mobile-listen-430x932', 'mobile-standalone-390x844']) {
    const { probe } = byId(payload.results, id);
    assert.ok(probe.header.rect.height >= 90, `${id}: top safe area consumes header content`);
    assert.equal(overlapArea(probe.player.rect, probe.nav.rect), 0, `${id}: player overlaps navigation`);
    assert.equal(probe.navButtons.length, 4, `${id}: destination count`);
    for (const button of probe.navButtons) {
      assert.equal(button.actionable, true, `${id}: ${button.text} is not actionable`);
      assert.ok(button.rect.width >= 44 && button.rect.height >= 44, `${id}: ${button.text} touch target`);
    }
  }

  const search = byId(payload.results, 'mobile-search-390x844');
  assert.equal(search.probe.destination, 'search');
  assert.equal(search.probe.searchPanel.visible, true);
  assert.equal(search.probe.activeElement.id, 'er-station-query');
  assert.equal(search.imeDuringComposition, 0, 'IME input filtered before compositionend');

  const selectedSearch = byId(payload.results, 'mobile-search-select-390x844').probe;
  assert.equal(selectedSearch.destination, 'listen');
  assert.equal(selectedSearch.searchPanel.visible, false);
  assert.equal(selectedSearch.activatedSearchName, 'Atlas Editorial FM');
  assert.ok(selectedSearch.settledSearchNames.length > 0);
  assert.ok(selectedSearch.settledSearchNames.length < selectedSearch.stationCount);
  assert.equal(selectedSearch.settledSearchNames.every(name => /atlas/i.test(name)), true);
  const selectedSearchResult = byId(payload.results, 'mobile-search-select-390x844');
  assert.equal(selectedSearchResult.actionLog.find(entry => entry.action.type === 'pointer')?.result.trustedPointer?.received?.isTrusted, true);
  assert.ok(selectedSearchResult.streamHosts.includes('stream49.example.invalid'));

  const keyboardSearch = byId(payload.results, 'mobile-search-keyboard-select-390x844').probe;
  assert.equal(keyboardSearch.destination, 'listen');
  assert.equal(keyboardSearch.searchPanel.visible, false);
  assert.equal(keyboardSearch.activatedSearchName, 'Praha Vinyl');
  assert.ok(byId(payload.results, 'mobile-search-keyboard-select-390x844').streamHosts.includes('stream44.example.invalid'));

  const countrySearch = byId(payload.results, 'mobile-country-search-390x844').probe;
  assert.equal(countrySearch.stationQuery.visible, true);
  assert.equal(countrySearch.countryQuery.visible, true);
  assert.equal(countrySearch.countryQuery.value, 'South Korea');
  assert.match(countrySearch.countrySummary.text, /South Korea/);
  assert.ok(countrySearch.searchResultMetadata.length > 0, 'country search has no results');
  assert.equal(
    countrySearch.searchResultMetadata.every(meta => matchesSelectedCountry(meta, 'South Korea')),
    true,
    'country search leaked stations from another country'
  );

  const palette = byId(payload.results, 'mobile-listen-390x844').probe.palette;
  assert.equal(palette.header, 'rgb(37, 36, 61)');
  assert.equal(palette.body, 'rgb(247, 241, 233)');
  assert.equal(palette.primary, 'rgb(223, 98, 69)');
  assert.equal(palette.map, 'rgb(227, 228, 234)');

  const darkPalette = byId(payload.results, 'mobile-dark-390x844').probe.palette;
  assert.equal(darkPalette.header, 'rgb(23, 22, 38)');
  assert.equal(darkPalette.body, 'rgb(29, 27, 43)');
  assert.equal(darkPalette.primary, 'rgb(237, 118, 91)');
  assert.equal(darkPalette.map, 'rgb(41, 40, 56)');

  const nowPlaying = byId(payload.results, 'mobile-nowplaying-390x844').probe;
  assert.equal(nowPlaying.nowPlaying.visible, true);
  assert.equal(nowPlaying.nowPlayingDismiss.actionable, true);
  assert.equal(nowPlaying.activeElement.id, 'er-nowplaying-dismiss');
  assert.notEqual(nowPlaying.nowPlayingTitle.text, 'Select a station');
  assert.equal(nowPlaying.nowPlayingMetadata.visible, true);
  assert.equal(nowPlaying.nowPlayingMetadata.ariaLabel, 'Track metadata confidence');
  assert.match(nowPlaying.nowPlayingMetadata.text, /Station metadata only|Identifying|Identified|Raw ICY/i);
  assert.equal(nowPlaying.nowPlayingPlay.ariaLabel, nowPlaying.playerPlay.ariaLabel);
  assert.ok(nowPlaying.nowPlayingSleepButtons.length >= 4);
  assert.equal(nowPlaying.nowPlayingSleepButtons.every(item => item.actionable), true);

  const nowPlayingMap = byId(payload.results, 'mobile-nowplaying-map-390x844').probe;
  assert.equal(nowPlayingMap.destination, 'map');
  assert.equal(nowPlayingMap.nowPlaying.visible, false);

  const overflow = byId(payload.results, 'mobile-overflow-390x844').probe;
  assert.equal(overflow.overflowSheet.visible, true);
  assert.equal(overflow.headerOverflow.ariaExpanded, 'true');
  assert.equal(overflow.overflowItems.every(item => item.actionable), true);
  assert.equal(overflow.activeElement.tag, 'BUTTON');

  const overflowSettings = byId(payload.results, 'mobile-overflow-settings-390x844').probe;
  assert.equal(overflowSettings.overflowSheet.visible, false);
  assert.equal(overflowSettings.settingsModal.visible, true);
  assert.equal(
    ['INPUT', 'BUTTON', 'SELECT'].includes(overflowSettings.activeElement.tag),
    true,
    'Settings did not receive focus after opening from overflow'
  );
  assert.notEqual(overflowSettings.activeElement.id, 'er-overflow-toggle');

  const landscape = byId(payload.results, 'mobile-landscape-844x390').probe;
  assert.equal(landscape.safeAreaVariables.start, '50px');
  assert.equal(landscape.safeAreaVariables.end, '50px');
  assertInsideLateralSafeArea(landscape.headerContent, 'mobile-landscape header');
  assertInsideLateralSafeArea(landscape.playerContent, 'mobile-landscape player');

  const landscapeOverflow = byId(payload.results, 'mobile-landscape-overflow-844x390').probe;
  assert.equal(landscapeOverflow.overflowSheet.visible, true);
  assertInsideLateralSafeArea(landscapeOverflow.overflowItems, 'mobile-landscape overflow');

  const landscapeNowPlaying = byId(payload.results, 'mobile-landscape-nowplaying-844x390').probe;
  assert.equal(landscapeNowPlaying.nowPlaying.visible, true);
  assertInsideLateralSafeArea(landscapeNowPlaying.nowPlayingContent, 'mobile-landscape Now Playing');

  const desktop = byId(payload.results, 'desktop-1440x900').probe;
  assert.match(desktop.documentElementClass, /\ber-desktop\b/);
  assert.equal(desktop.nav.visible, false);
  assert.equal(desktop.separator.visible, true);

  const keyboard = byId(payload.results, 'desktop-1440x900-keyboard').probe;
  assert.equal(keyboard.separatorValues.now, '54');
  assert.equal(keyboard.activeElement.id, 'er-separator');

  const collapsed = byId(payload.results, 'desktop-1440x900-collapse').probe;
  assert.equal(collapsed.collapsed, 'map');
  assert.equal(collapsed.map.visible, false);
  assert.equal(collapsed.separator.visible, false);
  assert.equal(collapsed.activeElement.id, 'er-restore-panel');

  const desktopNowPlaying = byId(payload.results, 'desktop-1440x900-nowplaying').probe;
  assert.equal(desktopNowPlaying.nowPlaying.visible, true);
  assert.equal(desktopNowPlaying.nowPlayingDismiss.actionable, true);

  const ko = byId(payload.results, 'mobile-ko-390x844').probe;
  const simplified = byId(payload.results, 'mobile-zh-hans-390x844').probe;
  const traditional = byId(payload.results, 'mobile-zh-hant-390x844').probe;
  assert.equal(ko.lang, 'ko');
  assert.equal(ko.fontProfile, 'ko');
  assert.equal(simplified.lang, 'zh-Hans');
  assert.equal(simplified.fontProfile, 'zh-Hans');
  assert.equal(traditional.lang, 'zh-Hant');
  assert.equal(traditional.fontProfile, 'zh-Hant');
  assert.notEqual(simplified.navButtons[0].text, traditional.navButtons[0].text);
});
