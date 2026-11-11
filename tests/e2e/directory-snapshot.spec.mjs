import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
import {serializeVariantGroups} from '../../site/assets/station-variants.js';
import {CATALOGS} from '../../site/i18n/index.js';
import {openAtlasView} from './helpers.mjs';

for(const locale of ['en','es','ar','ko','zh-Hans','zh-Hant'])test(`grouped wire results expose a bounded quality picker without autoplay in ${locale}`,async({page})=>{
  await page.setViewportSize({width:320,height:844});
  await page.addInitScript(locale=>localStorage.setItem('earthRadio.ui.v1',JSON.stringify({locale,palette:'paper'})),locale);
  const rows=[128,320].map(bitrate=>({...FIXTURE_STATIONS[0],name:'Grouped News',stationuuid:'grouped-'+bitrate,bitrate,url:'http://streams.e2e.example/'+bitrate,url_resolved:'http://streams.e2e.example/'+bitrate}));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:{schemaVersion:2,groups:serializeVariantGroups(rows)}});return url.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Grouped News');
  await expect(page.locator('.station-card__name')).toHaveText(['Grouped News']);
  await expect(page.getByRole('img',{name:CATALOGS[locale]['place.webHintLabel'],exact:true})).toBeVisible();
  await page.locator('.station-card .er-discovery-why').click();
  const picker=page.getByRole('combobox',{name:CATALOGS[locale]['discovery.streamQuality'].replace('{name}','Grouped News'),exact:true});await picker.selectOption('grouped-128');await expect(picker).toBeFocused();
  await expect(page.getByRole('img',{name:CATALOGS[locale]['discovery.httpStream'],exact:true})).toBeVisible();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await expect(page.locator('.station-card__favorite')).toHaveAttribute('aria-pressed','false');
  expect(await page.locator('.station-card__favorite svg').evaluate(element=>getComputedStyle(element).fill)).toBe('none');
  const controls=await page.locator('#er-station-detail .er-stream-control').evaluate(node=>{const boxes=[node,...node.children].map(item=>item.getBoundingClientRect()),meta=node.closest('[data-detail-streams]').getBoundingClientRect();return{left:Math.min(...boxes.map(box=>box.left)),right:Math.max(...boxes.map(box=>box.right)),selectWidth:node.querySelector('select').getBoundingClientRect().width,meta:meta.toJSON()};});
  expect(controls.left).toBeGreaterThanOrEqual(controls.meta.left-.5);expect(controls.right).toBeLessThanOrEqual(controls.meta.right+.5);
  expect(controls.selectWidth).toBeGreaterThanOrEqual(44);
});

for(const width of [390,1440])test(`catalog status does not become a control-covering toast at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>{
    window.__e2eCatalogToasts=[];
    new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType===1&&node.closest?.('#toast-container'))window.__e2eCatalogToasts.push(node.textContent);
    }}).observe(document,{childList:true,subtree:true});
  });
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:FIXTURE_STATIONS});return url.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
  expect(await page.evaluate(()=>window.__e2eCatalogToasts)).not.toEqual(expect.arrayContaining([expect.stringMatching(/stations loaded/i)]));
  await page.locator('.station-card__favorite').first().click();await expect(page.locator('#toast-container .toast--visible')).toHaveCount(1);
  const geometry=await page.evaluate(()=>{
    const toast=document.querySelector('#toast-container').getBoundingClientRect(),player=document.querySelector('#player-bar').getBoundingClientRect();
    const button=document.querySelector('.station-card__play'),box=button.getBoundingClientRect();
    return{toastBottom:toast.bottom,playerTop:player.top,hit:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===button};
  });
  expect(geometry.toastBottom).toBeLessThanOrEqual(geometry.playerTop);expect(geometry.hit).toBe(true);
});

for(const width of [390,1440])test(`atlas latitude bounds exclude Antarctic fallback and remain cropped after resize at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>{window.__e2eAtlasViews=[];document.addEventListener('earthradio:map-viewport',event=>window.__e2eAtlasViews.push(event.detail));});
  const rows=[FIXTURE_STATIONS[0],...Array.from({length:8},(_,i)=>({...FIXTURE_STATIONS[0],stationuuid:'aq-'+i,name:'AQ station '+i,country:'Antarctica',countrycode:'AQ',geo_lat:null,geo_long:null}))];
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:rows});return url.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
  if(width<768)await openAtlasView(page);
  const valid=()=>page.evaluate(()=>{const view=window.__e2eAtlasViews.at(-1);return Boolean(view&&view.south>=-60.00001&&view.north<=85.00001);});
  await expect.poll(valid).toBe(true);await expect(page.locator('#er-map-count')).toContainText('8 unlocated');
  const before=await page.evaluate(()=>window.__e2eAtlasViews.length);await page.setViewportSize({width,height:1100});
  await expect.poll(()=>page.evaluate(()=>window.__e2eAtlasViews.length)).toBeGreaterThan(before);await expect.poll(valid).toBe(true);
});

for(const width of [390,1440])test(`cold boot uses one same-origin snapshot and no mirror fan-out at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const calls=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot'){calls.push('snapshot');return route.fulfill({json:FIXTURE_STATIONS});}
    if(url.hostname.endsWith('api.radio-browser.info')){calls.push('unexpected mirror');return route.abort();}
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
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
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
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
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByRole('button',{name:'Choose country',exact:true}).click();await page.locator('#er-country-query').fill('KR');
  await page.locator('#er-country-options [data-country="South Korea"]').click();
  await expect.poll(()=>attempts).toBe(1);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('earth-radio-expanded-unverified-v1')||'[]').includes('KR'))).toBe(true);
  await page.evaluate(()=>window.earthRadioDirectory.expand('KR'));
  await expect.poll(()=>attempts).toBe(2);await expect(page.locator('.station-card__name').filter({hasText:'Targeted Korean News'})).toBeVisible();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('legacy data-module URLs still load after a worker upgrade',async({page})=>{
  await page.goto('/#listen');
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
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
  await page.getByRole('searchbox',{name:'Find a station'}).fill('Approx Country Station');
  await expect(page.locator('.station-card__name')).toHaveText(['Approx Country Station']);
  await expect(page.locator('.station-card__monogram')).toBeVisible();
  await expect(page.locator('#er-map-count')).toContainText('1 approximate');
  await page.getByRole('button',{name:'Fit stations',exact:true}).click();
  await expect(page.locator('path.er-map-approximate')).toHaveCount(1);await page.locator('path.er-map-approximate').hover();
  await expect(page.locator('.er-tt-meta')).toHaveText('Germany');expect(insecure).toEqual([]);
  await expect(page.locator('.er-tt-meta')).not.toContainText(/approximate|unlocated|snapshot/i);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('clusters disclose when they include country-level positions',async({page})=>{
  const rows=[1,2].map(i=>({...FIXTURE_STATIONS[0],stationuuid:'approx-cluster-'+i,name:'Approx Cluster '+i,country:'Germany',countrycode:'DE',geo_lat:null,geo_long:null}));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/directory/snapshot')return route.fulfill({json:rows});return url.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();await expect(page.locator('.er-cluster--approximate').first()).toHaveAttribute('title',/country-level locations/);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
