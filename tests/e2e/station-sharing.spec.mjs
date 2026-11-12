import {test,expect} from '@playwright/test';
import {setupApp,openSearchView} from './helpers.mjs';
import {SHARING_STATIONS} from './fixtures/sharing.mjs';
import {CATALOGS} from '../../site/i18n/index.js';
import {readFile} from 'node:fs/promises';
const {version}=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));

const [station,longTail,hostile]=SHARING_STATIONS;
const publicUrl=row=>'https://app.earthradio.stream/s/'+encodeURIComponent(row.stationuuid);
async function capabilities(page,{native='absent',clipboard='success'}={}){
 await page.addInitScript(({native,clipboard})=>{
  window.fixtureShareCalls=[];window.fixtureCopies=[];
  Object.defineProperty(navigator,'share',{configurable:true,value:native==='absent'?undefined:async payload=>{
   window.fixtureShareCalls.push({...payload});
   if(native!=='success')throw new DOMException('Controlled native result',native==='cancel'?'AbortError':'NotAllowedError');
  }});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:clipboard==='absent'?undefined:{async writeText(value){
   window.fixtureCopies.push(value);if(clipboard==='denied')throw new DOMException('Controlled clipboard denial','NotAllowedError');
  }}});
 },{native,clipboard});
}
async function enter(page,row=station,options={}){
 await capabilities(page,options);await setupApp(page,{navigate:false});
 await page.goto('/s/'+encodeURIComponent(row.stationuuid));
 await expect(page.locator('#btn-share')).toBeEnabled();
 await expect(page.locator('html')).toHaveAttribute('data-app-version',version);
 // The existing station normalizer strips angle brackets for player labels;
 // the generated preview separately retains the exact escaped directory text.
 const label=row===hostile?'音楽 /scriptimg id="share-injected" src=x & Radio':row.name;
 await expect(page.locator('#player-station')).toContainText(label);
}
async function noAudio(page){
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
 expect(await page.locator('#audio-player').getAttribute('src')).toBeNull();
}
async function cache(page,{expire=false}={}){
 return page.evaluate(expire=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('earthRadio');open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('cache',expire?'readwrite':'readonly'),store=tx.objectStore('cache'),read=store.get('stations.v3');let result;
   read.onsuccess=()=>{const value=read.result;result=(value?.stations||[]).map(row=>row.stationuuid);if(expire)store.put({...value,savedAt:1},'stations.v3');};
   tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};
  };
 }),expire);
}

for(const width of [320,390,1440])test(`shared station is selected without autoplay and can be forwarded before playback at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===1440?900:844});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await enter(page);await expect(page).toHaveURL(/\/#station=a1234567-1234-4abc-8abc-0123456789ab$/);await noAudio(page);
 await page.locator('#btn-share').click();await expect(page.locator('#er-share-dialog')).toBeVisible();
 await expect(page.locator('#er-share-url')).toHaveValue(publicUrl(station));await expect(page.locator('#er-share-url')).toBeFocused();
 await page.locator('[data-share-copy]').click();await expect(page.locator('#er-share-help')).toHaveText(CATALOGS.en['sharing.copied']);
 expect(await page.evaluate(()=>window.fixtureCopies)).toEqual([publicUrl(station)]);
 await page.keyboard.press('Escape');await expect(page.locator('#er-share-dialog')).toBeHidden();await expect(page.locator('#btn-share')).toBeFocused();await noAudio(page);
 const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('.player-controls button')].map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height};})}));
 expect(geometry.overflow).toBeLessThanOrEqual(1);for(const rect of geometry.buttons){expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(width);}
 expect(errors).toEqual([]);
});

test('a station outside the initial catalog survives both cached and expired-catalog reloads',async({page})=>{
 await enter(page,longTail);await expect.poll(()=>cache(page)).toContain(longTail.stationuuid);await noAudio(page);
 await page.reload();await expect(page.locator('#btn-share')).toBeEnabled();await expect(page.locator('#player-station')).toContainText(longTail.name);await noAudio(page);
 await cache(page,{expire:true});await page.reload();await expect(page.locator('#btn-share')).toBeEnabled();await expect(page.locator('#player-station')).toContainText(longTail.name);
 await expect.poll(()=>cache(page)).toContain(longTail.stationuuid);await noAudio(page);
 await openSearchView(page);await page.locator('#er-discovery-query').fill(longTail.name);await expect(page.locator('.station-card').filter({hasText:longTail.name})).toHaveCount(1);
});

for(const native of ['success','cancel','denied'])test(`native Share ${native} uses only the public station payload`,async({page})=>{
 await enter(page,station,{native});await page.locator('#btn-share').click();
 await expect.poll(()=>page.evaluate(()=>window.fixtureShareCalls.length)).toBe(1);
 expect(await page.evaluate(()=>window.fixtureShareCalls[0])).toEqual({title:station.name+' · Earth Radio',text:station.name+' · South Korea',url:publicUrl(station)});
 await expect(page.locator('#er-share-dialog'))[native==='denied'?'toBeVisible':'toBeHidden']();await noAudio(page);
});

for(const clipboard of ['absent','denied'])test(`clipboard ${clipboard} keeps a selected manual-copy link without claiming success`,async({page})=>{
 await enter(page,station,{clipboard});await page.locator('#btn-share').click();await page.locator('[data-share-copy]').click();
 await expect(page.locator('#er-share-help')).toHaveText(CATALOGS.en['sharing.manual']);await expect(page.locator('#er-share-url')).toBeFocused();
 expect(await page.locator('#er-share-url').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length)).toBe(true);await noAudio(page);
});

test('dialog keyboard focus stays local and transport shortcuts do not start audio',async({page})=>{
 await enter(page);await page.locator('#btn-share').click();
 await page.keyboard.press('Tab');await expect(page.locator('[data-share-copy]')).toBeFocused();
 await page.keyboard.press('Tab');await expect(page.locator('[data-share-close]')).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.locator('[data-share-copy]')).toBeFocused();
 await page.keyboard.press('Space');await expect(page.locator('#er-share-help')).toHaveText(CATALOGS.en['sharing.copied']);
 await page.keyboard.press('j');await page.keyboard.press('k');await noAudio(page);await expect(page.locator('#player-station')).toContainText(station.name);
 await page.keyboard.press('Escape');await expect(page.locator('#btn-share')).toBeFocused();
});

for(const locale of ['en','es','ar','ko','zh-Hans','zh-Hant'])test(`sharing fits a 320px phone in ${locale}`,async({page},testInfo)=>{
 await page.setViewportSize({width:320,height:700});await page.addInitScript(locale=>localStorage.setItem('earthRadio.ui.v1',JSON.stringify({locale,localeExplicit:true,palette:'night'})),locale);
 await enter(page);await page.locator('#btn-share').click();await expect(page.locator('#er-share-title')).toHaveText(CATALOGS[locale]['sharing.title']);
 await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');await expect(page.locator('#er-share-url')).toHaveAttribute('dir','ltr');
 const geometry=await page.locator('#er-share-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth,scroll:e.scrollHeight-e.clientHeight};});
 expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(320);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(700);expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.scroll).toBeLessThanOrEqual(1);
 if(locale==='ar')await testInfo.attach('sharing-rtl-phone',{body:await page.screenshot(),contentType:'image/png'});await noAudio(page);
});

test('generated preview retains Unicode and hostile delimiters as inert text',async({page,request})=>{
 const response=await request.get('/s/'+hostile.stationuuid);expect(response.status()).toBe(200);expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
 await enter(page,hostile);await expect(page.locator('#share-injected')).toHaveCount(0);await expect(page.locator('#er-shared-station')).toHaveCount(0);
 await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',publicUrl(hostile));await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',hostile.name+' · Earth Radio');await noAudio(page);
});

test('unknown and malformed station paths return honest errors without booting a substitute station',async({page})=>{
 for(const path of ['/s/not-a-station','/s/d1234567-1234-4abc-8abc-0123456789ab','/s/%E0%A4%A']){
  const response=await page.goto(path);expect(response.status()).toBe(404);await expect(page.locator('#audio-player')).toHaveCount(0);await expect(page.locator('h1')).toBeVisible();
 }
});

for(const prior of [false,true])test(`a shared station stays usable when the directory fails without a cache, prior station=${prior}`,async({page})=>{
 await capabilities(page);await setupApp(page,{navigate:false});
 if(prior){
  await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
  await page.evaluate(station=>new Promise((resolve,reject)=>{
   const open=indexedDB.open('earthRadio');open.onerror=()=>reject(open.error);open.onsuccess=()=>{
    const db=open.result,tx=db.transaction(['kv','cache'],'readwrite');tx.objectStore('cache').delete('stations.v3');tx.objectStore('kv').put(station,'lastPlayed');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
   };
  }),station);
 }
 // Keep the actual same-origin primary enabled, then fail it and every direct
 // catalog fallback. Asset delivery and the real shared document still succeed.
 const config=await readFile(new URL('../../site/config.js',import.meta.url),'utf8');
 await page.route(url=>url.hostname==='127.0.0.1'&&url.pathname==='/config.js',route=>route.fulfill({contentType:'text/javascript',body:config}));
 let fail=true;const failed=[];
 await page.route(url=>url.pathname.startsWith('/directory/')||url.hostname.endsWith('api.radio-browser.info')&&url.pathname.startsWith('/json/stations/'),route=>{
  if(!fail)return route.fallback();failed.push(new URL(route.request().url()).pathname);return route.fulfill({status:503,contentType:'application/json',body:'{}'});
 });
 await page.addInitScript(()=>{window.fixtureShareSettlements=[];window.addEventListener('earthradio:stations-load-settled',event=>window.fixtureShareSettlements.push(event.detail));});
 await page.goto('/s/'+longTail.stationuuid);await page.waitForFunction(()=>window.fixtureShareSettlements.length>0);
 expect(failed.length).toBeGreaterThan(0);expect(await page.evaluate(()=>window.fixtureShareSettlements[0].ok)).toBe(false);
 await expect(page.locator('#player-station')).toContainText(longTail.name);await expect(page.locator('#btn-play')).toBeEnabled();await expect(page.locator('#btn-share')).toBeEnabled();
 await expect(page.locator('#er-shared-station')).toHaveCount(0);await expect(page).toHaveURL(new RegExp('/#station='+longTail.stationuuid+'$'));await noAudio(page);
 const privateState=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('earthRadio');open.onerror=()=>reject(open.error);open.onsuccess=()=>{
  const db=open.result,tx=db.transaction('kv'),store=tx.objectStore('kv'),favorites=store.get('favorites'),recents=store.get('recents'),last=store.get('lastPlayed');
  tx.oncomplete=()=>{db.close();resolve({favorites:Object.keys(favorites.result||{}),recents:recents.result||[],lastId:last.result?.stationuuid||null});};tx.onerror=()=>reject(tx.error);
 };}));
 expect(privateState).toEqual({favorites:[],recents:[],lastId:prior?station.stationuuid:null});
 const cached=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('earthRadio');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('cache'),read=tx.objectStore('cache').get('stations.v3');read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close();};}));
 expect(cached.savedAt).toBe(0);expect(cached.directoryView).toBe(0);expect(cached.partial).toBe('shared-station');expect(cached.stations.map(row=>row.stationuuid)).toEqual([longTail.stationuuid]);expect(cached.stations[0].quality.score).toBeGreaterThan(0);
 await page.reload();await expect(page.locator('#btn-share')).toBeEnabled();await expect(page.locator('#player-station')).toContainText(longTail.name);await noAudio(page);
 await page.locator('#btn-share').click();await expect(page.locator('#er-share-url')).toHaveValue(publicUrl(longTail));await page.keyboard.press('Escape');
 // A partial link cache must never become a fresh six-hour catalog. Restoring
 // the directory on the next launch replaces it with the full ordinary cache.
 fail=false;await page.reload();await expect.poll(()=>cache(page)).toContain('e2e-seoul-0001');await expect(page.locator('#player-station')).toContainText(longTail.name);await noAudio(page);
});
