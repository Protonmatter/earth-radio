// Public-web now-playing: the same-origin Pages Function API feeds real track info to
// the metadata panel, and station facts (country · bitrate · codec) are never mistaken
// for a track title.

import { expect, test } from '@playwright/test';
import { playFromList, setupApp } from './helpers.mjs';

test('same-origin now-playing feed surfaces the track in the metadata panel', async ({ page }) => {
  await setupApp(page, {
    sameOriginNowPlaying: {
      found: true,
      source: 'icy',
      platform: 'icy',
      artist: 'IU',
      title: 'Blueming',
      raw: 'IU - Blueming'
    }
  });
  await playFromList(page, 'E2E Seoul Pop');

  const details = page.locator('#metadata-details');
  await expect(details).toContainText('Blueming', { timeout: 25_000 });
  await expect(details).toContainText('IU');
  // Catalogs are unreachable in the hermetic run, so the honest state is the
  // structured station feed, not a fabricated identification.
  await expect(page.locator('#metadata-state')).toHaveText(/Station feed|Identified|Likely match/);
});

test('station facts are never presented as a track title', async ({ page }) => {
  await setupApp(page);
  await playFromList(page, 'E2E Seoul Pop');

  // Without any live feed the panel stays honest: no title scraped from the
  // "country · bitrate · codec" station line.
  await page.waitForTimeout(1500);
  await expect(page.locator('#metadata-state')).toHaveText('Station metadata only');
  await expect(page.locator('#metadata-details')).not.toContainText('The Republic Of Korea');
});
