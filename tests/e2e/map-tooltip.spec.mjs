import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { setupApp,refreshDirectory,openAtlasView } from './helpers.mjs';
import { FIXTURE_STATIONS } from './fixtures/stations.mjs';

for (const { width, palette, longName = false } of [
  { width: 1440, palette: 'paper' }, { width: 390, palette: 'paper' },
  { width: 320, palette: 'paper' }, { width: 1440, palette: 'night', longName: true },
  { width: 390, palette: 'night', longName: true }
]) {
  test(`map tooltip keeps readable lines at ${width}px in ${palette}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(palette => {
      window.__e2eMapViews=[];
      document.addEventListener('earthradio:map-viewport',event=>window.__e2eMapViews.push(event.detail));
      localStorage.setItem('earthRadio.ui.v1', JSON.stringify({ palette, locale: 'en' }));
    }, palette);
    await setupApp(page, { sameOriginNowPlaying: { found: false } });
    const station = { ...FIXTURE_STATIONS[0],
      stationuuid: '11111111-1111-4111-8111-111111111111',
      name: longName ? 'CBS JOY4U — International Classical Music and Stories from Around the World' : 'CBS JOY4U',
      codec: 'AAC', bitrate: 97, url: 'https://streams.e2e.example/tooltip.mp3',
      url_resolved: 'https://streams.e2e.example/tooltip.mp3' };
    await page.route('**/json/stations/topclick/**', route => route.fulfill({ json: [station] }));
    let finishLookup;
    const lookup = new Promise(resolve => { finishLookup = resolve; });
    await page.route('**/api/nowplaying?**', async route => {
      if (!new URL(route.request().url()).searchParams.get('url')?.includes('/tooltip.mp3')) return route.fallback();
      await lookup;
      return route.fulfill({ json: { found: true, source: 'icy', artist: 'Test artist', title: 'A measured melody' } });
    });
    try {
      await refreshDirectory(page);
      const query = page.getByRole('searchbox', { name: 'Find a station' });
      await query.fill('CBS JOY4U');
      await expect(page.locator('.station-card__name')).toHaveText([station.name]);
      if (width < 768) await openAtlasView(page);
      await page.getByRole('button', { name: 'Fit stations', exact: true }).click();
      // Finish the zoom-specific geographic layout before parking the pointer.
      // A tooltip can legitimately close while the map is being resized.
      try{await expect(page.locator('#map')).toHaveAttribute('data-er-map-detail', 'detail', { timeout: 20000 });}
      catch(error){await test.info().attach('map-view-transitions',{body:JSON.stringify(await page.evaluate(()=>({views:window.__e2eMapViews,count:document.querySelector('#er-map-count').textContent,box:document.querySelector('#map').getBoundingClientRect().toJSON()}))),contentType:'application/json'});throw error;}
      await expect(page.locator('#er-map-data-status')).toBeHidden({ timeout: 20000 });
      await page.locator('#map path.leaflet-interactive:visible').first().hover();
      const tooltip = page.locator('.er-station-tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip.locator('.er-tt-meta')).toHaveText('South Korea');
      await expect(tooltip.locator('.er-tt-meta')).not.toContainText(/AAC|kbps|quality|HTTPS/);
      await expect(tooltip.locator('.er-tt-np--pending')).toBeVisible();
      const geometry = await tooltip.evaluate(element => {
        const box = element.getBoundingClientRect();
        const line = selector => {
          const node = element.querySelector(selector), r = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const verticalInsets = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
            .reduce((sum, key) => sum + parseFloat(style[key]), 0);
          return { width: r.width, height: r.height - verticalInsets, lineHeight: parseFloat(style.lineHeight) };
        };
        return { width: box.width, height: box.height, left: box.left, right: box.right,
          viewport: document.documentElement.clientWidth,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          background: getComputedStyle(element).backgroundColor,
          surface: getComputedStyle(document.documentElement).getPropertyValue('--er2-surface').trim(),
          name: line('.er-tt-name'), pending: line('.er-tt-np'), hint: line('.er-tt-hint') };
      });
      await mkdir('.build/evidence/tooltip-layout', { recursive: true });
      await page.screenshot({ path: `.build/evidence/tooltip-layout/${width}-${palette}-pending.png` });
      expect(geometry.width).toBeGreaterThanOrEqual(240);
      expect(geometry.width).toBeLessThanOrEqual(Math.min(300, width - 24));
      expect(geometry.height).toBeLessThan(longName ? 230 : 180);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.background).toBe(palette === 'paper' ? 'rgb(250, 247, 241)' : 'rgb(25, 51, 46)');
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.name.height).toBeLessThanOrEqual(geometry.name.lineHeight * (longName ? 3.1 : 1.1));
      expect(geometry.pending.height).toBeLessThanOrEqual(geometry.pending.lineHeight * 1.1);
      expect(geometry.hint.height).toBeLessThanOrEqual(geometry.hint.lineHeight * 1.1);
      finishLookup();
      await expect(tooltip.locator('.er-tt-np')).toContainText('A measured melody');
      await expect(page.locator('#audio-player')).toHaveJSProperty('paused', true);
      await page.screenshot({ path: `.build/evidence/tooltip-layout/${width}-${palette}-resolved.png` });
      await tooltip.screenshot({ path: `.build/evidence/tooltip-layout/${width}-${palette}-tooltip.png` });
    } finally { finishLookup(); }
  });
}
