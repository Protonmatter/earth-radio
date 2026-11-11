import {test,expect} from '@playwright/test';
import {setupToday} from './fixtures/today.mjs';

test('player place facts survive a minute refresh without changing audio or selection',async({page})=>{
 await setupToday(page);await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 await page.getByRole('button',{name:'Play: Berlin Radio 1',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect(page.locator('#player-meta')).toHaveText('Berlin, Germany · Jazz · 13:00');
 const source=await page.locator('#audio-player').getAttribute('src'),hash=new URL(page.url()).hash;
 await page.clock.setFixedTime(new Date('2026-11-11T12:01:05Z'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.locator('#player-meta')).toHaveText('Berlin, Germany · Jazz · 13:01');
 await expect(page.locator('#audio-player')).toHaveAttribute('src',source);await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
 expect(new URL(page.url()).hash).toBe(hash);await expect(page.locator('#player-station')).toHaveText('Berlin Radio 1');
});

test('a facts marker prevents country and clock text from starting song lookup',async({page})=>{
 const lookups=[];page.on('request',request=>{if(new URL(request.url()).hostname==='itunes.apple.com')lookups.push(request.url());});
 await setupToday(page);await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 await page.getByRole('button',{name:'Play: Berlin Radio 1',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await page.locator('#player-meta').evaluate(node=>{node.dataset.erStationFacts='true';node.dataset.erRawTitle='';node.textContent='Berlin, Germany · Jazz · 13:00';});
 await page.evaluate(()=>window.dispatchEvent(new Event('earthradio:metadata-refresh')));
 // Absence of provider work across two debounce windows is the behavior tested.
 await page.waitForTimeout(1800);expect(lookups).toEqual([]);
});

test('the actual runtime ICY callback preserves explicit raw input beside player place facts',async({page})=>{
 await setupToday(page);
 await page.addInitScript(()=>{window.RADIO_CONFIG={proxyBaseUrl:location.origin+'/radio-proxy',directorySnapshotUrl:'',auth:{enabled:false},metadataEnrichment:{enabled:true,iTunesDirectEnabled:false,spotifyProxyEnabled:false,fingerprintEnabled:false,platformNowPlayingEnabled:false}};});
 await page.route('**/radio-proxy/api/stations/**',route=>route.fulfill({json:{stations:[{stationuuid:'raw-berlin',name:'Berlin Raw Radio',countrycode:'DE',state:'Berlin',geo_lat:52.523764,geo_long:13.399603,tags:'jazz',codec:'MP3',bitrate:128,lastcheckok:1,url:'https://streams.e2e.example/raw.wav'}]}}));
 await page.route('**/radio-proxy/api/streams/nowplaying?**',route=>route.fulfill({contentType:'text/event-stream',body:'data: {"streamTitle":"Raw Artist - Raw Song"}\n\n'}));
 await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Raw Radio');await page.getByRole('button',{name:'Play: Berlin Raw Radio',exact:true}).click();
 await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect(page.locator('#nowcard-title')).toHaveText('Raw Song');
 await expect(page.locator('#player-meta')).toHaveAttribute('data-er-raw-title','Raw Artist - Raw Song');
 await expect(page.locator('#player-meta')).toHaveText('Berlin, Germany · Jazz · 13:00');
 await expect(page.locator('#nowcard-title')).toHaveText('Raw Song');
});

test('a minute refresh cannot replace the failed connection message with ordinary facts',async({page})=>{
 await setupToday(page);
 await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 await page.getByRole('button',{name:'Play: Berlin Radio 1',exact:true}).click();
 await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await page.route(url=>url.hostname==='streams.e2e.example'&&url.pathname==='/vienna-0.wav',route=>route.abort());
 await page.locator('#er-discovery-query').fill('Vienna Radio 1');
 await page.getByRole('button',{name:'Play: Vienna Radio 1',exact:true}).click();
 await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});
 await expect(page.locator('#player-meta')).toContainText("Couldn't connect");
 await page.clock.setFixedTime(new Date('2026-11-11T12:01:05Z'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.locator('#player-meta')).toContainText("Couldn't connect");
 await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

for(const cachedTitle of [false,true])test(`a late probe preserves live raw input and failure clears it, cached title=${cachedTitle}`,async({page})=>{
 await setupToday(page);let release;const pending=new Promise(resolve=>{release=resolve;});
 await page.addInitScript(()=>{window.RADIO_CONFIG={proxyBaseUrl:location.origin+'/radio-proxy',directorySnapshotUrl:'',auth:{enabled:false},metadataEnrichment:{enabled:true,iTunesDirectEnabled:false,spotifyProxyEnabled:false,fingerprintEnabled:false,platformNowPlayingEnabled:false}};});
 const rows=[{stationuuid:'probe-berlin',name:'Berlin Probe Radio',countrycode:'DE',state:'Berlin',geo_lat:52.523764,geo_long:13.399603,tags:'jazz',codec:'MP3',bitrate:128,lastcheckok:1,url:'https://streams.e2e.example/probe.wav'},
  {stationuuid:'probe-vienna',name:'Vienna Failed Radio',countrycode:'AT',state:'Vienna',geo_lat:48.2,geo_long:16.37,tags:'jazz',codec:'MP3',bitrate:128,lastcheckok:1,url:'https://streams.e2e.example/failure.wav'}];
 await page.route('**/radio-proxy/api/stations/**',route=>route.fulfill({json:{stations:rows}}));
 await page.route('**/radio-proxy/api/streams/nowplaying?**',route=>route.fulfill({contentType:'text/event-stream',body:'data: {"streamTitle":"Raw Artist - Raw Song"}\n\n'}));
 await page.route('**/radio-proxy/api/streams/probe?**',async route=>{await pending;await route.fulfill({json:{ok:true,metadata:{icyName:'Station branding only',...(cachedTitle?{streamTitle:'Old Artist - Cached Song'}:{})}}});});
 await page.route(url=>url.hostname==='streams.e2e.example'&&url.pathname==='/failure.wav',route=>route.abort());
 try{
  await page.goto('/#listen');await page.getByRole('button',{name:'Play: Berlin Probe Radio',exact:true}).click();
  await expect(page.locator('#player-meta')).toHaveAttribute('data-er-raw-title','Raw Artist - Raw Song');
  await page.locator('#player-meta').evaluate(node=>{
   window.__probeRawUpdates=[];
   new MutationObserver(records=>{for(const record of records)window.__probeRawUpdates.push(record.oldValue,node.getAttribute('data-er-raw-title'));})
    .observe(node,{attributes:true,attributeFilter:['data-er-raw-title'],attributeOldValue:true});
  });release();
  await expect.poll(()=>page.evaluate(url=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('earthRadio',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,read=db.transaction('cache','readonly').objectStore('cache').get('probe:'+url);
    read.onsuccess=()=>{resolve(read.result?.observation?.metadata?.icyName||'');db.close();};read.onerror=()=>{db.close();reject(read.error);};
   };
  }),rows[0].url)).toBe('Station branding only');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect((await page.evaluate(()=>window.__probeRawUpdates)).every(value=>value==='Raw Artist - Raw Song')).toBe(true);
  await expect(page.locator('#player-meta')).toHaveAttribute('data-er-raw-title','Raw Artist - Raw Song');
  await page.locator('#er-discovery-query').fill('Vienna Failed Radio');await page.getByRole('button',{name:'Play: Vienna Failed Radio',exact:true}).click();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});
  await expect(page.locator('#player-meta')).toHaveAttribute('data-er-raw-title','');
 }finally{release();}
});
