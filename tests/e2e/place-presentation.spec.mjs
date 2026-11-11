import {test,expect} from '@playwright/test';
import {setupToday} from './fixtures/today.mjs';
import {mkdir} from 'node:fs/promises';

test.use({viewport:{width:390,height:900}});

test('rows lead with corroborated place while an unsupported city stays country-only',async({page})=>{
 await setupToday(page);await page.goto('/#listen');
 await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 const card=page.locator('.station-card').filter({has:page.getByText('Berlin Radio 1',{exact:true})});
 await expect(card.locator('.er-station-meta-text')).toHaveText('Berlin, Germany · Jazz · 13:00');
 await expect(card).not.toContainText(/kbps|MP3|HTTPS|\bquality\b/i);
 const box=await card.locator('.station-card__play').boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
 await page.locator('#er-discovery-query').fill('LISTEN.moe');
 await expect(page.locator('.station-card[data-uuid="earth-radio:listen.moe:jpop"] .er-station-meta-text')).toHaveText('Japan');
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

for(const width of [320,390])test(`a known local clock stays visible beside a longer genre at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setupToday(page,{genre:'drum and bass'});await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 const facts=page.locator('.station-card').filter({has:page.getByText('Berlin Radio 1',{exact:true})}).locator('.er-station-meta-text');
 await expect(facts).toContainText('13:00');
 const clock=await facts.evaluate(node=>{
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let last,current;
  while((current=walker.nextNode()))if(current.data.trim())last=current;
  const range=document.createRange();range.setStart(last,last.length-5);range.setEnd(last,last.length);
  const box=range.getBoundingClientRect(),host=node.getBoundingClientRect(),body=node.closest('.station-card__body').getBoundingClientRect();
  const card=node.closest('.station-card').getBoundingClientRect();
  return{text:range.toString(),left:box.left,right:box.right,bottom:box.bottom,minimum:Math.max(host.left,body.left),maximum:Math.min(host.right,body.right),maximumBottom:card.bottom};
 });
 expect(clock.text).toBe('13:00');expect(clock.left).toBeGreaterThanOrEqual(clock.minimum-.5);expect(clock.right).toBeLessThanOrEqual(clock.maximum+.5);
 expect(clock.bottom).toBeLessThanOrEqual(clock.maximumBottom+.5);
});

test('stream choices and technical facts live in Details and retain selection and return focus',async({page})=>{
 await setupToday(page,{variant:true});await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 const card=page.locator('.station-card').filter({has:page.getByText('Berlin Radio 1',{exact:true})});
 await expect(card.locator('select[data-stream-group]')).toHaveCount(0);
 await card.locator('.er-discovery-why').click();const dialog=page.locator('#er-station-detail');await expect(dialog).toBeVisible();
 const select=dialog.getByRole('combobox',{name:'Stream quality for Berlin Radio 1'});
 await select.selectOption('00000000-0000-4000-8000-000000000999');await expect(select).toBeFocused();
 await expect(select).toHaveValue('00000000-0000-4000-8000-000000000999');
 await expect(dialog.locator('[data-detail-facts]')).toContainText('MP3');await expect(dialog.locator('[data-detail-facts]')).toContainText('128 kbps');
 await expect(dialog.locator('[data-detail-facts]')).toContainText('HTTPS');
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
 await dialog.locator('[data-detail-close]').click();await expect(dialog).toBeHidden();
 await expect(page.locator('.station-card .er-discovery-why')).toBeFocused();
});

for(const focus of ['stream','close','play'])test(`a catalog refresh preserves Details ${focus} focus and selected stream without autoplay`,async({page})=>{
 await setupToday(page,{variant:true});await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 await expect(page.locator('.station-card__name')).toHaveText(['Berlin Radio 1']);
 await page.getByRole('button',{name:'Station details: Berlin Radio 1',exact:true}).click();const dialog=page.locator('#er-station-detail');
 const select=dialog.getByRole('combobox',{name:'Stream quality for Berlin Radio 1'}),chosen='00000000-0000-4000-8000-000000000999';
 await select.selectOption(chosen);const target=focus==='stream'?select:dialog.locator(focus==='close'?'[data-detail-close]':'[data-detail-play]');
 await target.focus();await expect(target).toBeFocused();await page.evaluate(()=>window.earthRadioRuntime.refreshStations());
 await expect(dialog).toBeVisible();await expect(select).toHaveValue(chosen);await expect(target).toBeFocused();
 await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('directory diagnostics stay in Settings while map and home keep plain copy',async({page})=>{
 await setupToday(page);await page.goto('/');await expect(page.locator('#er-today-place [data-today-play]')).toBeEnabled();
 await expect(page.locator('#map-panel')).not.toContainText(/approximate|unlocated|snapshot|saved copy/i);
 await page.locator('#settings-toggle').click();const diagnostics=page.locator('#er-directory-diagnostics');
 await expect(diagnostics).toBeVisible();await diagnostics.locator('summary').click();
 await expect(diagnostics.locator('#status-line')).toBeVisible();await expect(diagnostics.locator('#er-map-count')).toBeVisible();
 await page.locator('#settings-modal .settings-header [data-close-settings]').click();
 await expect(page.locator('#er-today')).toBeVisible();await expect(page.locator('#settings-toggle')).toBeFocused();
});

for(const width of [390,1440])test(`an automatically opened account error closes to visible navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setupToday(page,{enableAuth:true});
 await page.goto('/?error=access_denied&error_description=Sign-in%20was%20cancelled');
 await expect(page.locator('.er-auth-modal')).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await page.getByRole('button',{name:'Close account dialog'}).click();
 await expect(page.locator('.er-auth-modal')).toBeHidden();
 await expect(page.locator('.er-primary-nav [data-er-primary="library"]')).toBeFocused();
 await expect(page.locator('html')).toHaveAttribute('data-er-dest','today');
});

for(const locale of ['en','es','ar','ko','zh-Hans','zh-Hant'])for(const palette of ['paper','night'])test(`place facts and Details remain usable in ${locale} ${palette}`,async({page},testInfo)=>{
 await page.setViewportSize({width:320,height:900});await setupToday(page,{variant:true});
 await page.addInitScript(({locale,palette})=>localStorage.setItem('earthRadio.ui.v1',JSON.stringify({locale,localeExplicit:true,palette})),{locale,palette});
 await page.goto('/#listen');await expect(page.locator('html')).toHaveAttribute('lang',locale);
 await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 const card=page.locator('.station-card').filter({has:page.getByText('Berlin Radio 1',{exact:true})});
 await expect(card.locator('.er-place-time')).toBeVisible();await expect(card.locator('.er-station-meta-text')).not.toContainText('place.');
 await card.locator('.er-discovery-why').click();const dialog=page.locator('#er-station-detail');await expect(dialog).toBeVisible();
 await expect(dialog).not.toContainText('place.');const select=dialog.locator('select[data-stream-group]');await expect(select).toBeVisible();
 const bounds=await select.boundingBox();expect(bounds.height).toBeGreaterThanOrEqual(44);expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(locale==='en'||locale==='ar'){
  await mkdir('.build/place-first/screenshots',{recursive:true});
  await page.screenshot({path:`.build/place-first/screenshots/details-${testInfo.project.name}-${locale}-${palette}-320.png`});
 }
 await dialog.locator('[data-detail-close]').click();await expect(card.locator('.er-discovery-why')).toBeFocused();
});

test('the RTL Details heading does not overlap its close control',async({page})=>{
 await page.setViewportSize({width:320,height:900});await setupToday(page);
 await page.addInitScript(()=>localStorage.setItem('earthRadio.ui.v1',JSON.stringify({locale:'ar',localeExplicit:true,palette:'night'})));
 await page.goto('/#listen');await page.locator('#er-discovery-query').fill('Berlin Radio 1');
 await page.locator('.station-card').filter({has:page.getByText('Berlin Radio 1',{exact:true})}).locator('.er-discovery-why').click();
 const overlap=await page.locator('#er-station-detail').evaluate(dialog=>{
  const label=dialog.querySelector('.er-detail-eyebrow'),close=dialog.querySelector('[data-detail-close]').getBoundingClientRect();
  const range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
  return Math.max(0,Math.min(close.right,text.right)-Math.max(close.left,text.left))*Math.max(0,Math.min(close.bottom,text.bottom)-Math.max(close.top,text.top));
 });expect(overlap).toBe(0);
});
