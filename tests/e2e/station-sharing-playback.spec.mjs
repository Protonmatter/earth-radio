import {test,expect} from '@playwright/test';
import {setupApp} from './helpers.mjs';
import {SHARING_STATIONS} from './fixtures/sharing.mjs';
import {installNativeMediaCapture} from './fixtures/media-session.mjs';

const station=SHARING_STATIONS[0];
async function open(page){
 await page.addInitScript(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
 await setupApp(page,{navigate:false,sameOriginNowPlaying:{found:true,source:'icy',platform:'icy',artist:'IU',title:'Blueming',raw:'IU - Blueming'}});
 await page.goto('/s/'+station.stationuuid);await expect(page.locator('#btn-share')).toBeEnabled();
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
 await page.locator('#btn-play').click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 await expect(page).toHaveTitle('Blueming · Earth Radio',{timeout:25000});
}

test('sharing from Now Playing preserves audio and parent focus; paused and stopped titles remain truthful',async({page})=>{
 await installNativeMediaCapture(page);await open(page);
 const source=await page.locator('#audio-player').getAttribute('src');
 await page.locator('#er-open-nowplaying').click();const share=page.locator('.er-nowplaying-secondary [data-share-station]');await share.click();
 await expect(page.locator('#er-share-dialog')).toBeVisible();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
 await page.keyboard.press('Escape');await expect(page.locator('#er-share-dialog')).toBeHidden();await expect(page.locator('#er-nowplaying')).toBeVisible();await expect(share).toBeFocused();
 expect(await page.locator('#audio-player').getAttribute('src')).toBe(source);await expect(page).toHaveTitle('Blueming · Earth Radio');
 await page.locator('#er-nowplaying-dismiss').click();await page.locator('#btn-play').click();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);await expect(page).toHaveTitle('Blueming · Earth Radio');
 await page.evaluate(()=>window.fixtureNativeMediaHandlers.stop());await expect(page).toHaveTitle('Earth Radio');
 expect(await page.locator('#audio-player').getAttribute('src')).toBeNull();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('the browser title follows real playback when the native Media Session API is absent',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'mediaSession',{configurable:true,value:undefined}));await open(page);
 await page.locator('#btn-play').click();await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);await expect(page).toHaveTitle('Blueming · Earth Radio');
});
