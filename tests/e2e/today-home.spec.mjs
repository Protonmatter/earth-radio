import {test,expect} from '@playwright/test';
import {setupToday} from './fixtures/today.mjs';
import {openSongLibraryView,setupApp,playFromList} from './helpers.mjs';
test.use({viewport:{width:390,height:844}});

test('long station names remain complete in accessible actions while Continue and Today fit',async({page})=>{
 await setupToday(page,{longName:true});await page.goto('/');
 const name=page.locator('#er-today-station'),play=page.locator('#er-today-place [data-today-play]');
 await expect(play).toBeEnabled();expect((await name.textContent()).length).toBeGreaterThan(140);
 await play.click();await expect.poll(()=>page.locator('#audio-player').evaluate(audio=>audio.paused)).toBe(false);
 await expect(page.locator('#er-today-continue')).toBeVisible();
 for(const heading of [name,page.locator('#er-today-continue-name')]){
  const geometry=await heading.evaluate(node=>({height:node.getBoundingClientRect().height,line:parseFloat(getComputedStyle(node).lineHeight)}));
  expect(geometry.height).toBeLessThanOrEqual(geometry.line*2+1);
 }
 const footer=await page.locator('#player-bar').boundingBox();
 for(const button of [play,page.locator('#er-today-continue [data-today-play]')]){
  expect((await button.getAttribute('aria-label')).length).toBeGreaterThan(140);
  const box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.y+box.height).toBeLessThan(footer.y);
 }
});

test('an explicit station link keeps the idle play label and selected playback aligned',async({page})=>{
 await setupToday(page);await page.goto('/#station=00000000-0000-4000-8000-000000000400');
 const play=page.locator('#btn-play');await expect(play).toHaveAccessibleName('Play Vienna Radio 1');
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);await play.click();
 await expect(page.locator('#player-station')).toHaveText('Vienna Radio 1');
 await expect.poll(()=>page.locator('#audio-player').evaluate(audio=>audio.paused)).toBe(false);
 await expect(page.locator('#audio-player')).toHaveAttribute('src',/vienna-0\.wav/);
});

test('reloading Library retains its view while the existing station route stays shareable',async({page},testInfo)=>{
 // Real navigation timing is part of this contract. Keep the fake-clock day
 // rollover fixture in its own tests; it replaces Performance's timing entries.
 await setupApp(page);await playFromList(page,'E2E Seoul Pop');
 await expect.poll(()=>page.locator('#audio-player').evaluate(audio=>audio.paused)).toBe(false);
 await openSongLibraryView(page);const hash=new URL(page.url()).hash;expect(hash).toContain('station=');
 const readState=()=>page.evaluate(()=>({destination:document.documentElement.dataset.erDest,stored:JSON.parse(localStorage.getItem('earthRadio.ui.v1')),navigation:performance.getEntriesByType('navigation').map(entry=>entry.type),hash:location.hash}));
 const before=await readState();
 await page.reload();await expect(page.locator('#er-you .er-song-library')).toBeVisible().catch(async error=>{await testInfo.attach('library-reload-state',{body:JSON.stringify({before,after:await readState()}),contentType:'application/json'});throw error;});expect(new URL(page.url()).hash).toBe(hash);
 expect((await readState()).navigation).toContain('reload');
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('Today is the first viewport with one named play action and three primary destinations',async({page})=>{
 await setupToday(page);await page.goto('/');
 await expect(page.locator('#er-today')).toBeVisible();
 await expect(page.locator('#er-today-place h1')).toHaveText('Berlin');
 const play=page.locator('#er-today-place [data-today-play]');
 await expect(play).toBeEnabled();await expect(play).toHaveAccessibleName(/Play Berlin Radio/);
 const box=await play.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.y+box.height).toBeLessThan((await page.locator('#player-bar').boundingBox()).y);
 await expect(page.locator('.er-primary-nav button:visible')).toHaveCount(3);
 expect(await page.locator('audio').evaluate(audio=>audio.paused)).toBe(true);
 const id=await play.getAttribute('data-station-id');await play.click();
 await expect.poll(()=>page.locator('audio').evaluate(audio=>audio.paused)).toBe(false);
 await expect(page).toHaveURL(new RegExp('station='+id));
 await expect(play).toHaveAccessibleName(/Pause Berlin Radio/);
 await play.click();await expect.poll(()=>page.locator('audio').evaluate(audio=>audio.paused)).toBe(true);
});

test('failed Today selection and its retry stay within the named program',async({page})=>{
 await setupToday(page,{variant:true});const attempts=[];
 await page.route(url=>url.hostname==='streams.e2e.example',route=>{attempts.push(new URL(route.request().url()).pathname);return route.abort();});
 await page.goto('/');const play=page.locator('#er-today-place [data-today-play]');await expect(play).toBeEnabled();
 const id=await play.getAttribute('data-station-id');await play.click();
 await expect(page.locator('.er-playback-failure')).toBeVisible({timeout:10000});
 const first=attempts.length;expect(first).toBeGreaterThan(0);expect(attempts.every(path=>path.startsWith('/berlin-'))).toBe(true);
 await expect(play).toHaveAttribute('data-station-id',id);await play.click();
 await expect.poll(()=>attempts.length).toBeGreaterThan(first);
 await expect(page.locator('.er-playback-failure')).toBeVisible({timeout:10000});
 expect(attempts.every(path=>path.startsWith('/berlin-'))).toBe(true);
 // The existing owner reports the attempted sibling UUID. Both variants belong
 // to the named program; its actual identity must not be rewritten to the hero.
 await expect(page).toHaveURL(new RegExp('station=(?:'+id+'|00000000-0000-4000-8000-000000000999)'));
 await expect(page.locator('#player-station')).toHaveText('Berlin Radio 1');
});

test('a returning launch shows Continue and Today together without autoplay',async({page})=>{
 await setupToday(page);await page.goto('/');
 const play=page.locator('#er-today-place [data-today-play]');await expect(play).toBeEnabled();
 const id=await play.getAttribute('data-station-id');await play.click();
 await expect.poll(()=>page.locator('audio').evaluate(audio=>audio.paused)).toBe(false);
 await expect.poll(()=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('earthRadio',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('kv','readonly'),get=tx.objectStore('kv').get('lastPlayed');get.onsuccess=()=>resolve(get.result?.stationuuid||null);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};
 }))).toBe(id);
 await page.goto('/');
 const resume=page.locator('#er-today-continue [data-today-play]');
 await expect(resume).toBeVisible();await expect(resume).toHaveAttribute('data-station-id',id);
 expect(await page.locator('audio').evaluate(audio=>audio.paused)).toBe(true);
 const controls=await Promise.all([resume,play].map(locator=>locator.boundingBox()));
 const footer=await page.locator('#player-bar').boundingBox();
 for(const control of controls){expect(control.height).toBeGreaterThanOrEqual(44);expect(control.y+control.height).toBeLessThan(footer.y);}
 await resume.click();await expect(page).toHaveURL(new RegExp('station='+id));
});

test('foreground UTC rollover changes the recommendation without changing current audio identity',async({page})=>{
 await setupToday(page);await page.goto('/');
 const play=page.locator('#er-today-place [data-today-play]');await expect(play).toBeEnabled();await play.click();
 await expect.poll(()=>page.locator('audio').evaluate(audio=>audio.paused)).toBe(false);
 const before=await page.locator('audio').getAttribute('src'),hash=new URL(page.url()).hash;
 await page.clock.setFixedTime(new Date('2026-11-12T00:00:10Z'));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.locator('#er-today-place h1')).toHaveText('Vienna');
 await expect(page.locator('audio')).toHaveAttribute('src',before);expect(new URL(page.url()).hash).toBe(hash);
 expect(await page.locator('audio').evaluate(audio=>audio.paused)).toBe(false);
});
