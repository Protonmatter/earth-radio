import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
test('installed shell reloads offline without redirected index or eager map precache',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.route('**/directory/snapshot',route=>route.fulfill({json:FIXTURE_STATIONS}));
    await page.route('**/index.html',route=>route.fulfill({status:308,headers:{location:'/'}}));
    await page.goto('/');await expect(page.locator('.station-card').first()).toBeVisible();
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
    const cached=await page.evaluate(async()=>{const names=await caches.keys(),shell=await caches.open(names.find(name=>name.startsWith('earth-radio-shell-')));return(await shell.keys()).map(request=>new URL(request.url).pathname);});
    expect(cached).not.toContain('/index.html');expect(cached.some(name=>/map-(?:detail|terrain|roads)-/.test(name))).toBe(false);
    await context.setOffline(true);await page.reload();await expect(page.locator('.station-card').first()).toBeVisible();
    await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  }finally{await context.close();}
});
