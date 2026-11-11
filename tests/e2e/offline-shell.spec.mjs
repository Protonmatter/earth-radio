import {test,expect} from '@playwright/test';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';
test('installed shell reloads offline without redirected index or eager map precache',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.route('**/directory/snapshot',route=>route.fulfill({json:FIXTURE_STATIONS}));
    await page.route('**/index.html',route=>route.fulfill({status:308,headers:{location:'/'}}));
    await page.goto('/');await expect(page.locator('#er-today')).toBeVisible();await expect(page.locator('#er-today-city')).toHaveText(/\S+/);
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
    const cached=await page.evaluate(async()=>{const names=await caches.keys(),shell=await caches.open(names.find(name=>name.startsWith('earth-radio-shell-')));return(await shell.keys()).map(request=>new URL(request.url).pathname);});
    expect(cached).not.toContain('/index.html');expect(cached.some(name=>/map-(?:detail|terrain|roads)-/.test(name))).toBe(false);
    for(const name of ['today-ui.js','today-ui.css','today-core.js','program-components.js','place-core.js','curated-places.js'])expect(cached).toContain('/assets/'+name);
    await context.setOffline(true);await page.reload();await expect(page.locator('#er-today')).toBeVisible();await expect(page.locator('#er-today-city')).toHaveText(/\S+/);
    await expect(page.locator('#er-today-onair button').first()).toBeVisible();
    await page.goto('/#listen');await expect(page.locator('.station-card').first()).toBeVisible();
    await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
    const unknown=await page.goto('/places/offline-route-fixture-missing');
    expect(unknown.status()).toBe(404);await expect(page.locator('[data-earth-radio-not-found]')).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color','rgb(245, 241, 233)');
    await expect(page.getByRole('link',{name:'Return home'})).toBeVisible();
    expect(await page.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    const privacy=await page.goto('/privacy');expect(privacy.status()).toBe(200);
    await expect(page.getByRole('heading',{level:1})).toContainText(/privacy/i);
    await page.goto('/?route=offline-fixture');await expect(page.locator('#er-today')).toBeVisible();await expect(page.locator('#er-today-city')).toHaveText(/\S+/);
    await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  }finally{await context.close();}
});
