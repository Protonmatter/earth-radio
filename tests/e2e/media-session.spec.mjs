import {test,expect} from '@playwright/test';
import {setupApp} from './helpers.mjs';
import {readFile} from 'node:fs/promises';
import {installNativeMediaCapture as nativeActions,readNativeMediaFields as metadata} from './fixtures/media-session.mjs';

const broadcast={found:true,source:'icy',platform:'icy',artist:'IU',title:'Blueming',raw:'IU - Blueming'};
async function playKnown(page,{feed=broadcast,beforePlay=async()=>{}}={}){
 await nativeActions(page);await setupApp(page,{sameOriginNowPlaying:feed});await beforePlay();
 expect(await page.evaluate(()=>window.fixtureNativeMediaApi)).toBe(true);
 await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
 await page.getByRole('button',{name:'Play: E2E Seoul Pop',exact:true}).click();
 await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect(page.locator('#player-track')).toContainText('Blueming',{timeout:25000});
}

test('station-only native metadata uses corroborated place instead of a raw country field',async({page})=>{
 await nativeActions(page);await setupApp(page);
 await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
 await page.getByRole('button',{name:'Play: E2E Seoul Pop',exact:true}).click();
 await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect.poll(()=>metadata(page)).toEqual({title:'E2E Seoul Pop',artist:'Seoul, South Korea',album:'Earth Radio'});
});

test('native artwork contains real 96,256,512 pixel PNGs produced from the controlled cover',async({page})=>{
 const cspErrors=[];page.on('console',message=>{if(message.type()==='error'&&/violates.*Content Security Policy/i.test(message.text()))cspErrors.push(message.text().replace(/data:image\/[^'"\s]+/g,'[DATA_IMAGE]'));});
 // A first-party image is only a synthetic cover fixture, not an artist match.
 const cover=await readFile(new URL('../../site/branding/earth-radio-app-icon-512.png',import.meta.url));
 const artworkUrl='https://cdn.listen.moe/media-session-cover.png';
 await playKnown(page,{feed:{...broadcast,artworkUrl},beforePlay:()=>page.route(artworkUrl,route=>route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:cover}))});
 await expect.poll(()=>page.evaluate(()=>navigator.mediaSession.metadata?.artwork.map(x=>x.sizes))).toEqual(['96x96','256x256','512x512']);
 const actual=await page.evaluate(async()=>Promise.all(navigator.mediaSession.metadata.artwork.map(async item=>{
  if(!item.src.startsWith('data:image/png;base64,'))throw Error('Native cover must use bounded local PNG output');
  // Decode as an image: img-src admits local PNG data, while connect-src
  // deliberately does not permit using fetch() for data URLs.
  const image=new Image();image.src=item.src;await image.decode();
  return{sizes:item.sizes,width:image.naturalWidth,height:image.naturalHeight,type:item.type};
 })));
 expect(actual).toEqual([96,256,512].map(size=>({sizes:`${size}x${size}`,width:size,height:size,type:'image/png'})));
 expect(cspErrors).toEqual([]);
});

test('Stop aborts a held cover fetch and a late response cannot restore native metadata',async({page})=>{
 const artworkUrl='https://cdn.listen.moe/media-session-cover.png',cover=await readFile(new URL('../../site/branding/earth-radio-app-icon-512.png',import.meta.url));
 let release;const pending=new Promise(resolve=>{release=resolve;});
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);window.fixtureCoverFetch={started:false,settled:false,aborted:false};
  window.fetch=(input,options)=>{
   if(String(input).includes('/media-session-cover.png')){
    window.fixtureCoverFetch.started=true;options?.signal?.addEventListener('abort',()=>{window.fixtureCoverFetch.aborted=true;},{once:true});
    return original(input,options).finally(()=>{window.fixtureCoverFetch.settled=true;});
   }return original(input,options);
  };
 });
 try{
  await playKnown(page,{feed:{...broadcast,artworkUrl},beforePlay:()=>page.route(artworkUrl,async route=>{await pending;await route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:cover});})});
  await page.waitForFunction(()=>window.fixtureCoverFetch.started);
  expect(await page.evaluate(()=>window.fixtureCoverFetch.aborted)).toBe(false);
  await page.evaluate(()=>window.fixtureNativeMediaHandlers.stop());
  await page.waitForFunction(()=>window.fixtureCoverFetch.aborted&&window.fixtureCoverFetch.settled);
  release();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  expect(await metadata(page)).toBeNull();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
 }finally{release();}
});

test('native Stop invalidates a pending HLS import before source attachment or playing',async({page})=>{
 await nativeActions(page);
 await page.addInitScript(()=>{
  window.fixturePlayCalls=0;window.fixtureStationSelections=[];
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){window.fixturePlayCalls++;return Reflect.apply(play,this,args);};
  window.addEventListener('earthradio:station-selected',event=>window.fixtureStationSelections.push(event.detail));
 });
 await setupApp(page);let release,importStarted;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{importStarted=resolve;});
 await page.route('**/assets/hls.light-*.js',async route=>{
  importStarted();await pending;const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.fixtureHlsModuleEvaluated=true;\n'});
 });
 try{
  await page.locator('#er-discovery-query').fill('hls');
  await page.getByRole('button',{name:'Play: E2E HLS Source',exact:true}).click();
  await started;
  await expect.poll(()=>page.evaluate(()=>typeof window.fixtureNativeMediaHandlers.stop)).toBe('function');
  await page.evaluate(()=>window.fixtureNativeMediaHandlers.stop());release();
  await page.waitForFunction(()=>window.fixtureHlsModuleEvaluated===true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  expect(await page.evaluate(()=>window.fixturePlayCalls)).toBe(0);expect(await page.evaluate(()=>window.fixtureStationSelections)).toEqual([]);
  expect(await page.locator('#audio-player').getAttribute('src')).toBeNull();await expect(page.locator('#player-bar')).toHaveAttribute('data-playback-state','idle');
  expect(await metadata(page)).toBeNull();
 }finally{release();}
});

test('native previous/next use the current filtered list and preserve successful station identity',async({page})=>{
 await nativeActions(page);await setupApp(page);await page.locator('#er-discovery-query').fill('hls');
 await page.getByRole('button',{name:'Play: E2E HLS Mirror',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await page.evaluate(()=>window.fixtureNativeMediaHandlers.nexttrack());
 await expect(page.locator('#player-station')).toHaveText('E2E HLS Source');await expect.poll(()=>metadata(page)).toMatchObject({title:'E2E HLS Source'});
 await page.evaluate(()=>window.fixtureNativeMediaHandlers.previoustrack());
 await expect(page.locator('#player-station')).toHaveText('E2E HLS Mirror');await expect.poll(()=>metadata(page)).toMatchObject({title:'E2E HLS Mirror'});
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
});

test('missing optional Media Session leaves ordinary station playback and pause usable',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaSession',{configurable:true,value:undefined});Object.defineProperty(window,'MediaMetadata',{configurable:true,value:undefined});});
 await setupApp(page);await page.locator('#er-discovery-query').fill('E2E Seoul Pop');
 await page.getByRole('button',{name:'Play: E2E Seoul Pop',exact:true}).click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await page.locator('#btn-play').click();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);expect(errors).toEqual([]);
});

test('native MediaMetadata follows the promoted track instead of keeping the station title',async({page})=>{
 await playKnown(page);
 await expect.poll(()=>metadata(page)).toEqual({title:'Blueming',artist:'IU',album:'E2E Seoul Pop'});
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
});

test('native Stop clears media ownership and a later explicit Play can replay the same station',async({page})=>{
 await playKnown(page);
 await expect.poll(()=>page.evaluate(()=>typeof window.fixtureNativeMediaHandlers.stop)).toBe('function');
 await page.evaluate(()=>window.fixtureNativeMediaHandlers.stop());
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
 expect(await page.locator('#audio-player').getAttribute('src')).toBeNull();
 await expect.poll(()=>metadata(page)).toBeNull();
 await page.evaluate(()=>{
  const audio=document.getElementById('audio-player');
  // Negative late-event injection tests ownership; it is not physical OS input.
  for(const name of ['pause','loadstart','canplay','ended'])audio.dispatchEvent(new Event(name));
 });
 await expect(page.locator('#player-bar')).toHaveAttribute('data-playback-state','idle');
 expect(await page.evaluate(()=>navigator.mediaSession.playbackState)).toBe('none');
 await page.evaluate(()=>window.fixtureNativeMediaHandlers.play());
 await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect.poll(()=>metadata(page)).toEqual({title:'Blueming',artist:'IU',album:'E2E Seoul Pop'});
});
