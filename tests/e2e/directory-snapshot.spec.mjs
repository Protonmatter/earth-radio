import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';

for(const width of [390,1440])test(`cold boot uses one same-origin snapshot and no mirror fan-out at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const calls=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot'){calls.push('snapshot');return route.fulfill({json:FIXTURE_STATIONS});}
    if(url.hostname.endsWith('api.radio-browser.info')){calls.push('unexpected mirror');return route.abort();}
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();
  expect(calls).toEqual(['snapshot']);await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await page.getByRole('searchbox',{name:'Find a station'}).fill('jazz london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  await page.reload();await expect(page.locator('.station-card').first()).toBeVisible();expect(calls).toEqual(['snapshot']);
});

test('snapshot outage falls back through discovered hosts and preserves station loading',async({page})=>{
  const requests=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot')return route.fulfill({status:503,json:{error:'outage'}});
    if(url.hostname.endsWith('api.radio-browser.info')){
      requests.push(url.hostname+url.pathname);
      if(url.pathname==='/json/servers')return route.fulfill({json:[{name:'de2.api.radio-browser.info'}]});
      return route.fulfill({json:FIXTURE_STATIONS});
    }
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();
  expect(requests.filter(value=>value.includes('/json/servers'))).toHaveLength(1);
  expect(requests.filter(value=>value.includes('/json/stations/')).every(value=>value.startsWith('de2.api.radio-browser.info'))).toBe(true);
  expect(requests.some(value=>/nl1|at1/.test(value))).toBe(false);
});

test('explicit built-in country selection loads targeted records and retries after a failed attempt',async({page})=>{
  let attempts=0;
  const korea={...FIXTURE_STATIONS[0],stationuuid:'targeted-korea',name:'Targeted Korean News',country:'The Republic Of Korea',countrycode:'KR',tags:'news',language:'korean'};
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot')return route.fulfill({json:FIXTURE_STATIONS});
    if(url.pathname==='/directory/countries')return route.fulfill({json:[{name:'The Republic Of Korea',iso_3166_1:'KR',stationcount:100}]});
    if(url.pathname==='/directory/country/KR'){attempts++;return attempts===1?route.fulfill({status:503,json:{error:'outage'}}):route.fulfill({json:[korea]});}
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByRole('button',{name:'Choose country',exact:true}).click();await page.locator('#er-country-query').fill('KR');
  await page.locator('#er-country-options [data-country="South Korea"]').click();
  await expect.poll(()=>attempts).toBe(1);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('earth-radio-expanded-unverified-v1')||'[]').includes('KR'))).toBe(true);
  await page.evaluate(()=>window.earthRadioDirectory.expand('KR'));
  await expect.poll(()=>attempts).toBe(2);await expect(page.locator('.station-card__name').filter({hasText:'Targeted Korean News'})).toBeVisible();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('legacy data-module URLs still load after a worker upgrade',async({page})=>{
  await page.goto('/');
  const count=await page.evaluate(async()=>{const data=await import('/assets/map-world.js');return data.MAP_WORLD.countries.features.length;});
  expect(count).toBeGreaterThan(200);
});

test('missing coordinates get an honest country marker and insecure favicons use a monogram',async({page})=>{
  const insecure=[],station={...FIXTURE_STATIONS[0],stationuuid:'approx-germany',name:'Approx Country Station',country:'Germany',countrycode:'DE',geo_lat:null,geo_long:null,favicon:'http://insecure-icons.e2e.example/icon.png'};
  page.on('request',request=>{if(request.url().includes('insecure-icons.e2e.example'))insecure.push(request.url());});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:[...FIXTURE_STATIONS,station]});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByRole('searchbox',{name:'Find a station'}).fill('Approx Country Station');
  await expect(page.locator('.station-card__name')).toHaveText(['Approx Country Station']);
  await expect(page.locator('.station-card__monogram')).toBeVisible();
  await expect(page.locator('#er-map-count')).toContainText('1 approximate');
  await page.getByRole('button',{name:'Fit stations',exact:true}).click();
  await expect(page.locator('path.er-map-approximate')).toHaveCount(1);await page.locator('path.er-map-approximate').hover();
  await expect(page.locator('.er-tt-meta')).toContainText('Approximate country location');expect(insecure).toEqual([]);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('clusters disclose when they include country-level positions',async({page})=>{
  const rows=[1,2].map(i=>({...FIXTURE_STATIONS[0],stationuuid:'approx-cluster-'+i,name:'Approx Cluster '+i,country:'Germany',countrycode:'DE',geo_lat:null,geo_long:null}));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:rows});return url.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();await expect(page.locator('.er-cluster--approximate').first()).toHaveAttribute('title',/country-level locations/);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
