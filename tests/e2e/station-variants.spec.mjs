import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
import {silentWav} from './helpers.mjs';
import {serializeVariantGroups} from '../../site/assets/station-variants.js';

const base={...FIXTURE_STATIONS[0],name:'E2E BBC Radio 4',country:'United Kingdom',countrycode:'GB',state:'London',codec:'MP3',tags:'news',geo_lat:51.5,geo_long:-.1};
const rows=[{...base,stationuuid:'variant-128',url:'https://streams.e2e.example/128',url_resolved:'https://streams.e2e.example/128',bitrate:128},
  {...base,stationuuid:'legacy-alias',name:'e2e bbc radio 4',url:'https://streams.e2e.example/128',url_resolved:'https://streams.e2e.example/128',bitrate:128},
  {...base,stationuuid:'variant-320',url:'https://streams.e2e.example/320',url_resolved:'https://streams.e2e.example/320',bitrate:320},
  {...base,stationuuid:'http-only',name:'E2E HTTP Station',url:'http://streams.e2e.example/http',url_resolved:'http://streams.e2e.example/http'}];
async function setup(page,{fail320=false}={}){
  const audio=[];await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot')return route.fulfill({json:{schemaVersion:2,groups:serializeVariantGroups(rows)},headers:{'x-directory-generated-at':'2026-11-09T00:00:00.000Z','x-directory-producer-sha':'a'.repeat(40)}});
    if(url.hostname==='streams.e2e.example'){audio.push(url.pathname);return fail320&&url.pathname==='/320'?route.abort():route.fulfill({contentType:'audio/wav',body:silentWav(120)});}
    if(url.hostname.endsWith('api.radio-browser.info')&&url.pathname.includes('/json/url/'))return route.fulfill({json:{ok:true}});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });return audio;
}
for(const width of [390,1440])test(`variant grouping, accessible quality choice and HTTP disclosure at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const audio=await setup(page);await page.goto('/');
  await page.getByRole('searchbox',{name:'Find a station'}).fill('bbc radio 4');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E BBC Radio 4']);
  const quality=page.getByRole('combobox',{name:'Stream quality for E2E BBC Radio 4'});await expect(quality).toHaveValue('variant-320');await expect(quality.locator('option')).toHaveCount(2);
  await quality.selectOption('legacy-alias');await expect(quality).toBeFocused();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);expect(audio).toEqual([]);
  await page.getByRole('button',{name:'Play: E2E BBC Radio 4',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);expect(audio.at(-1)).toBe('/128');
  await page.locator('#btn-play').click();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await quality.selectOption('variant-320');expect(audio.at(-1)).toBe('/128');await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await page.locator('#btn-play').click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);expect(audio.at(-1)).toBe('/320');
  await page.getByRole('button',{name:'Favorite station: E2E BBC Radio 4',exact:true}).click();await expect(page.getByRole('button',{name:'Unfavorite station: E2E BBC Radio 4',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('searchbox',{name:'Find a station'}).fill('HTTP Station');await expect(page.locator('.er-http-badge')).toHaveText('HTTP stream');
  // The boot generation status survives catalog caching; player actions may
  // intentionally replace it with playback status later.
  await page.reload();await expect(page.locator('#status-line')).toContainText('Snapshot');
});
test('legacy UUID deep links and saved alias favorites survive grouped reload',async({page})=>{
  await setup(page);await page.goto('/#station=legacy-alias');await page.getByRole('searchbox',{name:'Find a station'}).fill('bbc radio 4');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  const quality=page.getByRole('combobox',{name:'Stream quality for E2E BBC Radio 4'});await expect(quality).toHaveValue('legacy-alias');
  await page.getByRole('button',{name:'Favorite station: E2E BBC Radio 4',exact:true}).click();await page.reload();
  await page.getByRole('searchbox',{name:'Find a station'}).fill('bbc radio 4');await expect(page.locator('.station-card__name')).toHaveText(['E2E BBC Radio 4']);
  await expect(page.getByRole('button',{name:'Unfavorite station: E2E BBC Radio 4',exact:true})).toHaveAttribute('aria-pressed','true');await expect(quality).toHaveValue('legacy-alias');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
test('a failed selected stream recovers to an untried sibling without a duplicate card',async({page})=>{
  const audio=await setup(page,{fail320:true});await page.goto('/');await page.getByRole('searchbox',{name:'Find a station'}).fill('bbc radio 4');
  await page.getByRole('button',{name:'Play: E2E BBC Radio 4',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  expect(audio).toContain('/320');expect(audio.at(-1)).toBe('/128');await expect(page.locator('.station-card__name')).toHaveText(['E2E BBC Radio 4']);
});
