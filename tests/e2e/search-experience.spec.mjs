import {test,expect} from '@playwright/test';
import {setupApp} from './helpers.mjs';
import {FIXTURE_COUNTRIES,FIXTURE_STATIONS} from './fixtures/stations.mjs';
const openSearch=async page=>{await page.getByRole('button',{name:'Search stations',exact:true}).first().click();await expect(page.locator('#er-station-query')).toBeVisible();};
async function genre(page,value='jaz'){
  const input=page.getByRole('combobox',{name:'Search genres',exact:true});
  if(!await input.isVisible())await page.locator('.er-discovery-advanced>summary').click();
  await input.fill(value);await input.press('ArrowDown');await input.press('Enter');
}

test('shared query and ranked results agree across Browse and Search',async({page})=>{
  await setupApp(page);const inline=page.getByRole('searchbox',{name:'Find a station'});
  await inline.fill('london jazz');await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  await openSearch(page);await expect(page.locator('#er-station-query')).toHaveValue('london jazz');
  await page.locator('#er-station-query').fill('seoul pop');
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Seoul Pop']);
  await expect(inline).toHaveValue('seoul pop');await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
test('rapid Enter flushes the new query before activating a station',async({page})=>{
  await setupApp(page);await page.getByRole('searchbox',{name:'Find a station'}).fill('london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);await openSearch(page);
  await page.locator('#er-station-query').fill('seoul pop');await page.locator('#er-station-query').press('Enter');
  await expect(page.locator('#player-station')).toHaveText('E2E Seoul Pop');
});
test('Escape clears a palette query before closing it and keeps the country scope',async({page})=>{
  await setupApp(page);await openSearch(page);
  await page.locator('#er-station-query').fill('seoul');
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Seoul Pop']);
  await page.locator('#er-station-query').press('Escape');
  await expect(page.locator('#er-station-query')).toBeVisible();
  await expect(page.locator('#er-station-query')).toHaveValue('');
  await page.locator('#er-station-query').press('Escape');
  await expect(page.locator('#search-modal')).toBeHidden();
});
test('clear all cancels a pending palette query instead of restoring it later',async({page})=>{
  await setupApp(page);await page.locator('#er-discovery-query').fill('london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);await openSearch(page);
  await page.locator('#er-station-query').fill('seoul');
  await page.locator('#er-search-active').getByRole('button',{name:'Clear all',exact:true}).click();
  await expect(page.locator('#er-station-query')).toHaveValue('');
  await expect(page.locator('#er-discovery-query')).toHaveValue('');
  await expect.poll(()=>page.locator('#search-results .search-result-item__name').allTextContents()).toEqual(expect.arrayContaining(['E2E Berlin Techno','E2E London Jazz','E2E Seoul Pop']));
  await expect(page.locator('#search-results')).not.toHaveAttribute('inert','');
});
test('facet menus are searchable with keyboard and removable without clearing the query',async({page})=>{
  await setupApp(page);await genre(page);await expect(page.locator('select[name="genre"]')).toHaveValue('jazz');
  await page.getByRole('searchbox',{name:'Find a station'}).fill('london');
  await expect(page.getByRole('button',{name:'Remove Genre: Jazz',exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Remove Genre: Jazz',exact:true}).first().click();
  await expect(page.locator('select[name="genre"]')).toHaveValue('');await expect(page.locator('#er-discovery-query')).toHaveValue('london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
});
test('clear search preserves the chosen facet and reset filters preserves the query',async({page})=>{
  await setupApp(page);await genre(page);const query=page.locator('#er-discovery-query');await query.fill('london');
  await page.getByRole('button',{name:'Clear search',exact:true}).first().click();
  await expect(query).toHaveValue('');await expect(page.locator('select[name="genre"]')).toHaveValue('jazz');
  await query.fill('seoul');await expect(page.locator('#er-search-recovery')).toBeVisible();
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();
  await expect(query).toHaveValue('seoul');await expect(page.locator('.station-card__name')).toHaveText(['E2E Seoul Pop']);
  await expect(page.locator('#er-search-recovery')).toBeHidden();
});
test('typos and connecting words work in the palette as they do inline',async({page})=>{
  await setupApp(page);await page.locator('#er-discovery-query').fill('jazz in london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);await openSearch(page);
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E London Jazz']);
  await page.locator('#er-station-query').fill('elecrtonic');
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Berlin Techno']);
});
test('country selection scopes both presentations and is visible and reversible',async({page})=>{
  await setupApp(page);await page.getByRole('button',{name:'Choose country',exact:true}).click();
  await page.locator('#er-country-query').fill('대한민국');await page.locator('#er-country-options [role="option"]').first().click();
  await expect(page.locator('#search-results .search-result-item__meta').first()).toContainText('Korea');
  await expect(page.locator('#er-search-active')).toContainText('South Korea');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:/Remove Country: South Korea/}).first().click();
  await expect(page.locator('#er-discovery-active')).not.toContainText('South Korea');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
test('the country picker can find and expand a country absent from the loaded sample',async({page})=>{
  await setupApp(page);
  await page.route('**/json/countries',route=>route.fulfill({json:[...FIXTURE_COUNTRIES,{name:'New Zealand',iso_3166_1:'NZ',stationcount:1}]}));
  await page.route('**/json/stations/search?**',route=>new URL(route.request().url()).searchParams.get('countrycode')==='NZ'
    ?route.fulfill({json:[{...FIXTURE_STATIONS[0],stationuuid:'e2e-nz',name:'E2E Auckland',country:'New Zealand',countrycode:'NZ',url:'https://streams.e2e.example/nz',url_resolved:'https://streams.e2e.example/nz'}]})
    :route.fallback());
  await page.getByRole('button',{name:'Choose country',exact:true}).click();
  await page.locator('#er-country-query').fill('NZ');
  await expect(page.locator('#er-country-options [data-country="New Zealand"]')).toBeVisible();
  await page.locator('#er-country-options [data-country="New Zealand"]').click();
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Auckland']);
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
test('late country-index rows cannot change the keyboard-highlighted country',async({page})=>{
  await setupApp(page);let complete;
  await page.route('**/json/countries',route=>new Promise(resolve=>{complete=()=>route.fulfill({json:[...FIXTURE_COUNTRIES,{name:'Australia',iso_3166_1:'AU',stationcount:4}]}).then(resolve);}));
  await page.getByRole('button',{name:'Choose country',exact:true}).click();
  await expect.poll(()=>Boolean(complete)).toBe(true);
  const country=page.locator('#er-country-query');
  const index=await page.locator('#er-country-options [data-country="Germany"]').evaluate(option=>[...option.parentElement.querySelectorAll('[role="option"]')].indexOf(option));
  for(let i=0;i<=index;i++)await country.press('ArrowDown');
  await expect(page.locator('#er-country-options .is-active')).toContainText('Germany');
  await complete();await expect(page.locator('#er-country-options [data-country="Australia"]')).toBeVisible();
  await expect(page.locator('#er-country-options .is-active')).toContainText('Germany');
  await country.press('Enter');
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Berlin Techno']);
  await country.press('ArrowDown');await country.fill('zzzz-no-country');
  await expect(page.locator('#er-country-options [role="option"]')).toHaveCount(0);
  await expect(country).not.toHaveAttribute('aria-activedescendant',/.+/);
});
test('facet IME composition cannot commit an intermediate option or play audio',async({page})=>{
  await setupApp(page);const input=page.getByRole('combobox',{name:'Search genres',exact:true});
  await input.dispatchEvent('compositionstart');await input.fill('jaz');
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await expect(page.locator('select[name="genre"]')).toHaveValue('');
  await input.dispatchEvent('compositionend');await input.press('ArrowDown');await input.press('Enter');
  await expect(page.locator('select[name="genre"]')).toHaveValue('jazz');await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});
test('large facet catalogs stay bounded and missing selected values remain clearable',async({page})=>{
  await setupApp(page);let large=true;
  const pool=Array.from({length:2500},(_,i)=>({...FIXTURE_STATIONS[0],stationuuid:`facet-${i}`,name:`Facet ${i}`,tags:`category${i}`,url:`https://streams.e2e.example/facet-${i}`,url_resolved:`https://streams.e2e.example/facet-${i}`}));
  await page.route('**/json/stations/topclick/**',route=>route.fulfill({json:large?pool:FIXTURE_STATIONS}));
  await page.evaluate(()=>window.earthRadioRuntime.refreshStations());
  await expect(page.locator('select[name="genre"] option[value="category2499"]')).toBeAttached();
  const input=page.getByRole('combobox',{name:'Search genres',exact:true});await input.click();
  expect(await page.locator('#er-facet-genre-list [role="option"]').count()).toBeLessThanOrEqual(24);
  await input.fill('category2499');await input.press('ArrowDown');await input.press('Enter');
  await expect(page.locator('select[name="genre"]')).toHaveValue('category2499');
  large=false;await page.evaluate(()=>window.earthRadioRuntime.refreshStations());
  await expect(page.locator('select[name="genre"] option[value="jazz"]')).toBeAttached();
  await expect(page.locator('select[name="genre"]')).toHaveValue('category2499');
  await page.getByRole('button',{name:'Remove Genre: Category2499',exact:true}).first().click();
  await expect(page.locator('.station-card').first()).toBeVisible();
});
for(const width of [320,390,768,1440])test(`search/filter controls fit ${width}px with no autoplay`,async({page})=>{
  await page.setViewportSize({width,height:width<768?568:850});await setupApp(page);await genre(page);
  const query=page.getByRole('searchbox',{name:'Find a station'});await query.fill('nothing-matches');
  await expect(page.locator('#er-search-recovery')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Reset discovery',exact:true}).click();await expect(page.locator('.station-card').first()).toBeVisible();
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
});

test('palette IME defers matching and a directory refresh preserves pending input',async({page})=>{
  await setupApp(page);await openSearch(page);
  const input=page.locator('#er-station-query');
  await input.fill('london');await input.dispatchEvent('compositionstart');
  await input.fill('seoul');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await page.evaluate(()=>window.earthRadioRuntime.refreshStations());
  await expect(input).toHaveValue('seoul');await expect(page.locator('#search-results')).toHaveAttribute('inert','');
  await expect(page.locator('#audio-player')).toHaveJSProperty('paused',true);
  await input.dispatchEvent('compositionend');
  await expect(page.locator('#search-results .search-result-item__name')).toHaveText(['E2E Seoul Pop']);
  await expect(page.locator('#search-results')).not.toHaveAttribute('inert','');
});

test('language aliases, region metadata and codec survive the runtime normalization path',async({page})=>{
  await setupApp(page);
  await page.route('**/json/stations/topclick/**',route=>route.fulfill({json:[{...FIXTURE_STATIONS.find(station=>station.countrycode==='DE'),state:'Bavaria',city:'Munich',language:'deu'}]}));
  await page.evaluate(()=>window.earthRadioRuntime.refreshStations());
  const query=page.locator('#er-discovery-query');await query.fill('munich bavaria mp3');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E Berlin Techno']);
  const language=page.getByRole('combobox',{name:'Search languages'});await language.fill('de');await language.press('ArrowDown');await language.press('Enter');
  await expect(page.locator('select[name="language"]')).toHaveValue('german');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E Berlin Techno']);
});

test('legacy quality and geography filters are exposed and resettable without losing the query',async({page})=>{
  await setupApp(page);await page.goto('/#countries=Germany&minQuality=90');
  await page.locator('#er-discovery-query').fill('seoul');
  await expect(page.locator('#er-discovery-active')).toContainText('Germany');
  await expect(page.locator('#er-discovery-active')).toContainText('Quality 90+');
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();
  await expect(page.locator('#er-discovery-query')).toHaveValue('seoul');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E Seoul Pop']);
});

test('resizing the station container keeps filtered rows readable',async({page})=>{
  await setupApp(page);await page.locator('#er-discovery-query').fill('london');
  await expect(page.locator('.station-card__name')).toHaveText(['E2E London Jazz']);
  for(const width of [390,1440,320]){
    await page.setViewportSize({width,height:844});
    await expect.poll(()=>page.locator('.station-card').first().evaluate(card=>card.getBoundingClientRect().width)).toBeGreaterThan(width<768?width-65:300);
    expect(await page.locator('.station-card__body').first().evaluate(body=>body.getBoundingClientRect().width)).toBeGreaterThan(100);
  }
});
