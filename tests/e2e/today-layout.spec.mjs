import {test,expect} from '@playwright/test';
import {setupToday} from './fixtures/today.mjs';
import {setupApp} from './helpers.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
test.use({viewport:{width:390,height:844}});

for(const conflict of [false,true])test(`native component evidence survives runtime normalization, conflict=${conflict}`,async({page})=>{
 await setupToday(page);
 const rows=['Alpha','Beta'].map((name,index)=>({stationuuid:`native-${name}`,name:`Berlin ${name}`,countrycode:'DE',state:'Berlin',geo_lat:52.5,geo_long:13.4,url:`https://streams.e2e.example/${index}.wav`,codec:'MP3',bitrate:128,lastcheckok:1,clickcount:100-index,nativeProgram:{id:'native-alpha',cityId:conflict?null:'ne-1159151529'}}));
 await page.route(url=>url.hostname.endsWith('api.radio-browser.info')&&/\/json\/stations\/(?:topclick|search)/.test(url.pathname),route=>route.fulfill({json:rows}));
 await page.goto('/');
 if(conflict){await expect(page.locator('#grid-count')).toHaveText('4 stations');await expect(page.locator('#er-today-place [data-today-play]')).toBeDisabled();}
 else{await expect(page.locator('#er-today-place [data-today-play]')).toBeEnabled();await expect(page.locator('#er-today-onair')).not.toContainText('Berlin Beta');}
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('keyboard skip preserves the active geography, quality and station fragment',async({page})=>{
 await setupToday(page);await page.goto('/#countries=Germany&minQuality=30');
 await expect(page.locator('#er-discovery-active')).toContainText('Germany');
 await expect(page.locator('#er-discovery-active')).toContainText('Quality 30+');
 const filteredURL=page.url();
 await page.locator('.er-skip').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#er-workspace')).toBeFocused();
 await expect(page).toHaveURL(filteredURL);
 await expect(page.locator('#er-discovery-active')).toContainText('Germany');
 await expect(page.locator('#er-discovery-active')).toContainText('Quality 30+');
 await page.goto('/?skip-check=station#station=00000000-0000-4000-8000-000000000400');
 await expect(page.locator('#btn-play')).toHaveAttribute('aria-label',/Vienna Radio 1/);
 const stationURL=page.url();
 await page.locator('.er-skip').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#er-workspace')).toBeFocused();
 await expect(page).toHaveURL(stationURL);
 await expect(page.locator('#btn-play')).toHaveAttribute('aria-label',/Vienna Radio 1/);
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('startup controls wait for the owned runtime and Settings receives keyboard focus',async({page})=>{
 await setupToday(page);let release;const pending=new Promise(resolve=>{release=resolve;});
 await page.route('**/assets/index-*.js',async route=>{await pending;await route.fallback();});
 try{
  await page.goto('/',{waitUntil:'commit'});await expect(page.locator('#settings-toggle')).toBeDisabled();
  await expect(page.locator('#btn-play')).toBeDisabled();await expect(page.locator('#er-open-nowplaying')).toBeDisabled();
  release();await expect(page.locator('#settings-toggle')).toBeEnabled();await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.activeElement?.closest('#settings-modal')))).toBe(true);
  await page.locator('#settings-modal .settings-header [data-close-settings]').click();await expect(page.locator('#settings-toggle')).toBeFocused();
 }finally{release();}
});

for(const width of [390,1440])test(`Settings contains keyboard focus and returns to its trigger at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setupToday(page);await page.goto('/');
 const trigger=page.locator('#settings-toggle'),modal=page.locator('#settings-modal');
 await trigger.click();await expect(modal).toBeVisible();
 const first=modal.locator('.settings-header [data-close-settings]'),last=page.locator('#settings-save');
 await first.focus();await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused();
 await page.keyboard.press('Tab');await expect(first).toBeFocused();
 for(let count=0;count<24;count++){
  await page.keyboard.press('Tab');
  await expect.poll(()=>page.evaluate(()=>Boolean(document.activeElement?.closest('#settings-modal')))).toBe(true);
 }
 await page.keyboard.press('Escape');await expect(modal).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await first.click();await expect(modal).toBeHidden();await expect(trigger).toBeFocused();
});

test('saving Settings after a palette selection keeps the basemap and stored theme aligned',async({page})=>{
 await setupApp(page);await page.locator('#settings-toggle').click();
 await page.locator('#er-settings-preferences [data-er-palette="night"]').click();
 await expect(page.locator('#map')).toHaveAttribute('data-er-basemap','dark');
 await expect(page.locator('#setting-theme')).toHaveValue('dark');await page.locator('#settings-save').click();
 await expect(page.locator('#settings-modal')).toBeHidden();await expect(page.locator('#map')).toHaveAttribute('data-er-basemap','dark');
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-er-palette','night');
});

for(const width of [844,1440])test(`landscape Search keeps Library tabs out of the list and the station action exposed at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:390});await setupApp(page);
 await expect(page.locator('#grid-panel .er-library-tabs')).toBeHidden();
 await page.locator('#er-discovery-query').fill('Seoul');await expect(page.locator('.station-card__name')).toHaveText(['E2E Seoul Pop']);
 await expect.poll(()=>page.locator('.station-card__play').evaluate(button=>{
  const box=button.getBoundingClientRect(),grid=document.getElementById('station-grid').getBoundingClientRect();
  return grid.height>=76&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===button;
 })).toBe(true).catch(async error=>{
  const layout=await page.evaluate(()=>Object.fromEntries(['header.header','main.main','#grid-panel','.grid-header','#er-discovery','.er-discovery-search','.er-discovery-advanced','#er-discovery-status','#collections','#station-grid','.station-card__play','#player-bar','#er-primary-nav'].map(selector=>{const element=document.querySelector(selector),style=getComputedStyle(element);return[selector,{rect:element.getBoundingClientRect().toJSON(),display:style.display,position:style.position,flex:style.flex,height:style.height,padding:style.padding,margin:style.margin,open:element.open}];})));
  await mkdir('.build/today-home',{recursive:true});await writeFile(`.build/today-home/landscape-${width}-layout.json`,JSON.stringify(layout,null,2));throw error;
 });
});

test('Settings palette still drives the existing theme and persists after reload',async({page})=>{
 await setupToday(page);await page.goto('/');await page.locator('#settings-toggle').click();
 await expect(page.locator('#settings-modal')).toBeVisible();
 await page.locator('#er-settings-preferences [data-er-palette="night"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-er-palette','night');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.locator('#settings-modal .settings-header [data-close-settings]').click();await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-er-palette','night');await expect(page.locator('#er-today')).toBeVisible();
});

for(const width of [390,1440])test(`Search retains the existing advanced filter surface and focus return at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await setupToday(page);await page.goto('/');await page.locator('.er-primary-nav [data-er-primary="search"]').click();
 await expect(page.locator('#er-discovery-query')).toBeFocused();
 if(await page.locator('#er-discovery details').getAttribute('open')===null)await page.locator('#er-discovery details > summary').click();
 await expect(page.locator('#filters-toggle')).toBeVisible();
 await page.locator('#filters-toggle').click();await expect(page.locator('#filter-sidebar')).toHaveAttribute('aria-hidden','false');
 await page.locator('#filter-sidebar [data-close-filters]').first().click();await expect(page.locator('#filter-sidebar')).toHaveAttribute('aria-hidden','true');
 await expect(page.locator('#filters-toggle')).toBeFocused();
 if(width>=1100){
  await page.locator('#filters-toggle').click();await page.locator('.er-primary-nav [data-er-primary="search"]').click();
  await expect(page.locator('#filter-sidebar')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('#er-discovery-query')).toBeFocused();
 }
});

test('On air cards do not repeat a sibling of the Today hero program',async({page})=>{
 await setupToday(page,{variant:true});await page.goto('/');
 await expect(page.locator('#er-today-place [data-today-play]')).toBeEnabled();
 const hero=await page.locator('#er-today-station').textContent();
 await expect(page.locator('#er-today-onair')).not.toContainText(hero);
});

test('UTC refresh keeps keyboard focus on the existing On air control',async({page})=>{
 await setupToday(page);await page.goto('/');
 const play=page.locator('#er-today-onair button').first();await expect(play).toBeEnabled();await play.focus();
 await page.clock.setFixedTime(new Date('2026-11-12T00:00:10Z'));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.locator('#er-today-place h1')).toHaveText('Vienna');await expect(play).toBeFocused();
});

for(const width of [390,1440])test(`Library keeps the existing account dialog reachable with focus return at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setupApp(page,{enableAuth:true,navigate:false});await page.goto('/');
 await page.locator('.er-primary-nav [data-er-primary="library"]').click();
 await page.locator('#grid-panel [data-er-library-section="account"]').click();
 const signIn=page.locator('#er-auth-button');await expect(signIn).toBeVisible();
 await page.locator('#er-you [data-er-library-section="account"]').click();await expect(signIn).toBeVisible();
 await expect(page.locator('#er-you > .er-library-tabs [aria-pressed="true"]')).toHaveCount(1);
 await signIn.click();await expect(page.locator('.er-auth-modal')).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with GitHub'})).toBeVisible();
 await page.getByRole('button',{name:'Close account dialog'}).click();await expect(signIn).toBeFocused();
});

test('empty city data exposes an honest disabled action and usable Search and Library destinations',async({page})=>{
 await setupToday(page,{empty:true});await page.goto('/');
 await expect(page.locator('#er-today')).toBeVisible();
 await expect(page.locator('#er-today-place [data-today-play]')).toBeDisabled();
 await expect(page.locator('#er-today-unavailable')).toBeVisible();
 await page.locator('.er-primary-nav [data-er-primary="search"]').click();
 await expect(page.locator('#er-discovery-query')).toBeFocused();
 await page.locator('.er-primary-nav [data-er-primary="library"]').click();
 await expect(page.locator('#grid-panel .er-library-tabs')).toBeVisible();
 await page.locator('#grid-panel [data-er-library-section="music"]').click();
 await expect(page.locator('#er-you .er-song-library')).toBeVisible();
});

for(const locale of ['en','es','ar','ko','zh-Hans','zh-Hant'])for(const palette of ['paper','night'])test(`Today controls remain reachable in ${locale} ${palette}`,async({page})=>{
 await setupToday(page);
 await page.addInitScript(({locale,palette})=>localStorage.setItem('earthRadio.ui.v1',JSON.stringify({locale,localeExplicit:true,palette})),{locale,palette});
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang',locale);
 const play=page.locator('#er-today-place [data-today-play]');await expect(play).toBeEnabled();
 await expect(page.locator('#er-today')).not.toContainText('today.');
 const bounds=await play.boundingBox(),footer=await page.locator('#player-bar').boundingBox();
 expect(bounds.height).toBeGreaterThanOrEqual(44);expect(bounds.y+bounds.height).toBeLessThan(footer.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await play.focus();await expect(play).toBeFocused();
 if(locale==='en'||locale==='ar'){
  await mkdir('.build/today-home/screenshots',{recursive:true});
  await page.screenshot({path:`.build/today-home/screenshots/${locale}-${palette}-390.png`});
 }
});

for(const width of [320,768,1440])test(`Today adapts to ${width}px without hiding its named action or atlas`,async({page})=>{
 await page.setViewportSize({width,height:900});await setupToday(page);await page.goto('/');
 const play=page.locator('#er-today-place [data-today-play]');await expect(play).toBeEnabled();
 await expect(page.locator('#map-panel .leaflet-container')).toBeVisible();
 const box=await play.boundingBox(),footer=await page.locator('#player-bar').boundingBox();
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThan(footer.y);
 await page.locator('.er-skip').focus();await page.keyboard.press('Enter');await expect(page.locator('#er-workspace')).toBeFocused();
 await expect(page.locator('html')).toHaveAttribute('data-er-dest','today');
 await expect(page.locator('#er-today')).toBeVisible();
 await expect(page.locator('#er-overflow-toggle')).toBeHidden();
 await expect(page.locator('.er-header-tools .er-tablet-only:visible')).toHaveCount(0);
 if(width<768)await expect(page.locator('#map-panel .er-atlas-tools')).toBeHidden();
 if(width>=1100){
  const contrast=await page.evaluate(()=>{
   const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
   const luminance=value=>{const [r,g,b]=rgb(value);return .2126*r+.7152*g+.0722*b;};
   const foreground=luminance(getComputedStyle(document.querySelector('#er-primary-nav button')).color),background=luminance(getComputedStyle(document.querySelector('.header')).backgroundColor);
   return(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
  });expect(contrast).toBeGreaterThanOrEqual(4.5);
 }
 await mkdir('.build/today-home/screenshots',{recursive:true});await page.screenshot({path:`.build/today-home/screenshots/en-paper-${width}.png`});
});
