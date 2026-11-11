import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
import {silentWav} from './helpers.mjs';
import {serializeVariantGroups} from '../../site/assets/station-variants.js';

const ids={low:'00000000-0000-4000-8000-000000000101',high:'00000000-0000-4000-8000-000000000102',other:'00000000-0000-4000-8000-000000000103'};
const base={...FIXTURE_STATIONS[0],name:'Trust fixture chosen',country:'United Kingdom',countrycode:'GB',state:'London',city:'London',codec:'MP3',tags:'jazz',geo_lat:51.5,geo_long:-.1};
const rows=[{...base,stationuuid:ids.high,bitrate:320,url:'https://streams.e2e.example/trust-chosen-high',url_resolved:'https://streams.e2e.example/trust-chosen-high'},
  {...base,stationuuid:ids.low,bitrate:128,url:'https://streams.e2e.example/trust-chosen-low',url_resolved:'https://streams.e2e.example/trust-chosen-low'},
  {...base,name:'Trust fixture other',stationuuid:ids.other,country:'New Zealand',countrycode:'NZ',state:'Auckland',city:'Auckland',geo_lat:-36.8,geo_long:174.7,url:'https://streams.e2e.example/trust-other',url_resolved:'https://streams.e2e.example/trust-other'}];

async function setup(page,{hangChosen=false,scan=false,playlistChosen=false}={}){
  const media=[],held=[];let firstGroup;
  const stations=playlistChosen?rows.map(row=>row.stationuuid===ids.high?{...row,url:'https://streams.e2e.example/trust-playlist.m3u',url_resolved:'https://streams.e2e.example/trust-playlist.m3u'}:row):rows;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot')return route.fulfill({json:{schemaVersion:2,groups:serializeVariantGroups(stations)},headers:{'x-directory-generated-at':'2026-11-11T00:00:00Z','x-directory-producer-sha':'a'.repeat(40)}});
    if(url.hostname==='streams.e2e.example'){
      if(!url.pathname.startsWith('/trust-'))return route.fulfill({status:404,body:'No fixture metadata'});
      if(url.pathname==='/trust-playlist.m3u'){held.push(route);return;}
      media.push(url.pathname);const group=url.pathname.includes('trust-chosen')?'chosen':'other';firstGroup??=group;
      if(scan?group===firstGroup:group==='chosen'){
        if(hangChosen){held.push(route);return;}
        return route.abort('failed');
      }
      return route.fulfill({contentType:'audio/wav',body:silentWav(120)});
    }
    if(url.hostname.endsWith('api.radio-browser.info'))return route.fulfill({json:url.pathname==='/json/servers'?[{name:'de1.api.radio-browser.info'}]:{ok:true}});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/#listen');await page.getByRole('searchbox',{name:'Find a station'}).fill('Trust fixture');
  await expect(page.locator('.station-card__name')).toHaveCount(2);
  return{media,held,release:()=>Promise.allSettled(held.splice(0).map(route=>route.abort()))};
}
async function identity(page,name,allowedIds){
  await expect(page.locator('#player-station')).toHaveText(name);
  await expect.poll(()=>page.evaluate(()=>navigator.mediaSession.metadata?.title)).toBe(name);
  const route=await page.evaluate(()=>new URLSearchParams(location.hash.slice(1)).get('station'));
  expect(allowedIds).toContain(route);
  await expect(page.locator('.station-card--active')).toHaveAttribute('data-uuid',route);
}

test('exhausted chosen-program variants stop with explicit actions and consistent identity',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await setup(page);
  await page.getByRole('button',{name:'Play: Trust fixture chosen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});
  await expect(page.getByRole('button',{name:'Play something similar',exact:true})).toBeVisible();
  await expect(page.locator('#player-meta')).toContainText("Couldn't connect");
  expect(state.media.some(path=>path==='/trust-other')).toBe(false);
  expect(new Set(state.media)).toEqual(new Set(['/trust-chosen-high','/trust-chosen-low']));
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await identity(page,'Trust fixture chosen',[ids.low,ids.high]);
  for(const label of ['Try again','Play something similar']){
    const rect=await page.getByRole('button',{name:label,exact:true}).boundingBox();expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(390);expect(rect.y+rect.height).toBeLessThanOrEqual(844);
  }
});

test('one connection budget bounds hung sibling attempts and a paused attempt stays cancelled',async({page},testInfo)=>{
  const state=await setup(page,{hangChosen:true});
  await page.evaluate(()=>{
    window.__trustTiming={};
    window.__trustLongTasks=[];
    new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__trustLongTasks.push({start:entry.startTime,duration:entry.duration});window.__trustLongTasks=window.__trustLongTasks.slice(-32);}).observe({entryTypes:['longtask']});
    document.addEventListener('click',event=>{if(event.target.closest('.station-card__play'))window.__trustTiming.started=performance.now();},true);
    new MutationObserver(()=>{if(!document.querySelector('.er-playback-failure').hidden)window.__trustTiming.failed=performance.now();})
      .observe(document.querySelector('.er-playback-failure'),{attributes:true,attributeFilter:['hidden']});
  });
  await page.getByRole('button',{name:'Play: Trust fixture chosen',exact:true}).click();
  try{
    await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000}).catch(async error=>{
      const browser=await page.evaluate(()=>({timing:window.__trustTiming,now:performance.now(),longTasks:window.__trustLongTasks,visibility:document.visibilityState,playback:document.getElementById('player-bar').dataset.playbackState,hash:location.hash,audio:{paused:document.getElementById('audio-player').paused,readyState:document.getElementById('audio-player').readyState,networkState:document.getElementById('audio-player').networkState}}));
      await testInfo.attach('connection-budget-state',{body:JSON.stringify({browser,media:state.media,held:state.held.length}),contentType:'application/json'});throw error;
    });
    expect(await page.evaluate(()=>window.__trustTiming.failed-window.__trustTiming.started)).toBeLessThan(8000);expect(state.media).not.toContain('/trust-other');
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(page.locator('#btn-play')).toHaveAttribute('aria-label','Pause');await page.locator('#btn-play').click();
    await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
    await page.waitForTimeout(8100);
    await expect(page.getByRole('button',{name:'Try again',exact:true})).not.toBeVisible();expect(state.media).not.toContain('/trust-other');
  }finally{await state.release();}
});

test('retry stays in the chosen group and Similar changes program only after its explicit tap',async({page})=>{
  const state=await setup(page);await page.getByRole('button',{name:'Play: Trust fixture chosen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});const before=state.media.length;
  await page.getByRole('button',{name:'Try again',exact:true}).click();await expect.poll(()=>state.media.length).toBeGreaterThan(before);
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});expect(state.media).not.toContain('/trust-other');
  await page.getByRole('button',{name:'Play something similar',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  expect(state.media.at(-1)).toBe('/trust-other');await identity(page,'Trust fixture other',[ids.other]);
});

test('World Scan may skip programs and keeps the new program identity in every surface',async({page})=>{
  const state=await setup(page,{scan:true});await page.locator('.er-primary-nav [data-er-primary="atlas"]').click();
  await page.locator('#er-today [data-click-id="surprise"]').click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/,{timeout:12000});
  const groups=new Set(state.media.map(path=>path.includes('trust-chosen')?'chosen':'other'));expect(groups.size).toBe(2);
  const name=state.media.at(-1)==='/trust-other'?'Trust fixture other':'Trust fixture chosen';
  await identity(page,name,name.endsWith('other')?[ids.other]:[ids.high,ids.low]);
  await expect(page.locator('#toast-container')).toContainText(name);
});

test('a late failed attempt cannot replace a newer explicit choice',async({page})=>{
  const state=await setup(page,{hangChosen:true});
  await page.getByRole('button',{name:'Play: Trust fixture chosen',exact:true}).click();await expect.poll(()=>state.held.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Play: Trust fixture other',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await state.release();await identity(page,'Trust fixture other',[ids.other]);
  await page.waitForTimeout(8000);await identity(page,'Trust fixture other',[ids.other]);
  await expect(page.getByRole('button',{name:'Try again',exact:true})).not.toBeVisible();
});

test('next and previous are explicit selections and cannot inherit World Scan skipping',async({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Play: Trust fixture other',exact:true}).click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await page.locator('#btn-next').click();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});
  await identity(page,'Trust fixture chosen',[ids.low,ids.high]);
  expect(state.media.filter(path=>path==='/trust-other')).toHaveLength(1);
  await page.locator('#btn-prev').click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await identity(page,'Trust fixture other',[ids.other]);
});

test('a pending playlist remains cancellable and resume resolves a fresh source',async({page})=>{
  const state=await setup(page,{playlistChosen:true});
  await page.getByRole('button',{name:'Play: Trust fixture other',exact:true}).click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await page.getByRole('button',{name:'Play: Trust fixture chosen',exact:true}).click();
  await expect.poll(()=>state.held.length).toBe(1);
  try{
    await expect(page.locator('#btn-play')).toHaveAttribute('aria-label','Pause');
    await page.locator('#btn-play').click();await expect(page.locator('#btn-play')).toHaveAttribute('aria-label','Play');
    await state.release();await page.locator('#btn-play').click();await expect.poll(()=>state.held.length).toBe(1);
    await state.held.shift().fulfill({contentType:'audio/x-mpegurl',body:'https://streams.e2e.example/trust-other'});
    await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
    await identity(page,'Trust fixture chosen',[ids.high]);
  }finally{await state.release();}
});

test('selecting an already-playing station again does not expire healthy playback',async({page})=>{
  const state=await setup(page);
  const play=page.getByRole('button',{name:'Play: Trust fixture other',exact:true});
  await play.click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await play.click();await page.waitForTimeout(8100);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
  await expect(page.getByRole('button',{name:'Try again',exact:true})).not.toBeVisible();
  await identity(page,'Trust fixture other',[ids.other]);expect(new Set(state.media)).toEqual(new Set(['/trust-other']));
});
