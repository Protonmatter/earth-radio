import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {setupApp} from './helpers.mjs';
import {installNativeMediaCapture,readNativeMediaFields} from './fixtures/media-session.mjs';

test('the actual player remains usable across native Media Session capability differences',async({page,baseURL},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installNativeMediaCapture(page);await setupApp(page,{navigate:false});
  const station={stationuuid:'00000000-0000-4000-8000-000000000606',name:'Compatibility radio',countrycode:'DE',country:'Germany',state:'Berlin',geo_lat:52.52,geo_long:13.405,
    url:baseURL+'/__test-media-session.wav',url_resolved:baseURL+'/__test-media-session.wav',codec:'WAV',bitrate:128,lastcheckok:1,clickcount:1000,tags:'jazz'};
  await page.route(url=>url.hostname.endsWith('api.radio-browser.info')&&/\/json\/stations\/(?:topclick|search)/.test(url.pathname),route=>{
    const code=new URL(route.request().url()).searchParams.get('countrycode');return route.fulfill({json:!code||code==='DE'?[station]:[]});
  });
  await page.goto('/#listen');const secure=page.locator('#er-discovery input[name="secureOnly"]');if(await secure.isChecked())await secure.uncheck();
  await page.locator('#er-discovery-query').fill('Compatibility radio');await page.getByRole('button',{name:'Play: Compatibility radio',exact:true}).click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await expect.poll(()=>page.locator('#audio-player').evaluate(audio=>audio.currentTime)).toBeGreaterThan(0.05);
  await expect(page).toHaveTitle('Compatibility radio · Earth Radio');
  const capabilities=await page.evaluate(()=>({nativeMediaApi:window.fixtureNativeMediaApi,bitmap:typeof createImageBitmap,secure:isSecureContext,registrations:window.fixtureNativeMediaRegistration}));
  await testInfo.attach('native-media-capabilities',{body:JSON.stringify(capabilities),contentType:'application/json'});
  // Successful CI reports are not uploaded; retain the non-sensitive native
  // results in the job log as well, without inferring platform support.
  console.log('Native Media Session capabilities: '+JSON.stringify({project:testInfo.project.name,platform:process.platform,...capabilities}));
  if(capabilities.nativeMediaApi){
    await expect.poll(()=>readNativeMediaFields(page)).toEqual({title:'Compatibility radio',artist:'Berlin, Germany',album:'Earth Radio'});
    // Missing observation is a failure. An individually unsupported action must
    // have an actual recorded native exception, never a silent conditional skip.
    for(const action of ['play','pause','stop','previoustrack','nexttrack']){
      const registration=capabilities.registrations[action];expect(registration,action+' must be attempted').toBeTruthy();
      if(registration.registered)expect(await page.evaluate(action=>typeof window.fixtureNativeMediaHandlers[action],action)).toBe('function');
      else expect(registration.errorName).toMatch(/^(?:NotSupportedError|TypeError)$/);
    }
    expect(capabilities.registrations.play.registered).toBe(true);expect(capabilities.registrations.pause.registered).toBe(true);
  }
  await page.locator('#btn-play').click();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await expect(page).toHaveTitle('Compatibility radio · Earth Radio');
  await page.locator('#btn-play').click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  if(capabilities.nativeMediaApi){
    await page.evaluate(()=>window.fixtureNativeMediaHandlers.pause());await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
    await page.evaluate(()=>window.fixtureNativeMediaHandlers.play());await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
    if(capabilities.registrations.stop.registered){
      await page.evaluate(()=>window.fixtureNativeMediaHandlers.stop());await expect.poll(()=>readNativeMediaFields(page)).toBeNull();
      await expect(page).toHaveTitle('Earth Radio');
      await page.locator('#btn-play').click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
    }
  }
  expect(errors).toEqual([]);
});

test('the actual browser bitmap/canvas pipeline produces truthful PNG sizes',async({page})=>{
  await setupApp(page);const source=await readFile(new URL('../../site/branding/earth-radio-app-icon-512.png',import.meta.url));
  await page.route('https://cdn.listen.moe/compatibility-cover.png',route=>route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:source}));
  const sizes=await page.evaluate(async()=>{
    const {createMediaArtworkLoader}=await import('/assets/media-session-artwork.js?v='+document.documentElement.dataset.appVersion),loader=createMediaArtworkLoader();
    try{
      const artwork=await loader.load('https://cdn.listen.moe/compatibility-cover.png');if(!artwork)throw Error('Supported browser raster pipeline unavailable');
      return await Promise.all(artwork.map(async value=>{const image=new Image();image.src=value.src;await image.decode();return{width:image.naturalWidth,height:image.naturalHeight,sizes:value.sizes};}));
    }finally{loader.dispose();}
  });
  expect(sizes).toEqual([96,256,512].map(size=>({width:size,height:size,sizes:`${size}x${size}`})));
});
