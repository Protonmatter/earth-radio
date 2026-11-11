import {test,expect} from '@playwright/test';
import {setupToday} from './fixtures/today.mjs';
import {openAtlasView,openSearchView} from './helpers.mjs';

test('an unsupported recommendation input leaves the caller and fallback controls usable',async({page})=>{
 const html='<main id="er-today"><section id="er-today-continue"><strong id="er-today-continue-name"></strong><button data-today-play></button></section><section id="er-today-place"><h1 id="er-today-city"></h1><span id="er-today-time"></span><strong id="er-today-station"></strong><button data-today-play></button><p id="er-today-unavailable"></p><button data-today-refresh>Refresh</button></section><ul id="er-today-onair"></ul><p id="er-today-air-empty"></p></main>';
 await page.route('**/today-harness',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto('/today-harness');
 const result=await page.evaluate(async()=>{
  const {installToday}=await import('/assets/today-ui.js?v=0.33.0');let plays=0,returned=false,error='';
  const ui=installToday({play:()=>plays++});
  try{ui.observe({stations:new Array(50001).fill({stationuuid:'invalid-budget',name:'Input',url:'https://example.com/live'})});returned=true;}catch(failure){error=failure.message;}
  return{plays,returned,error,disabled:document.querySelector('#er-today-place [data-today-play]').disabled,refreshHidden:document.querySelector('[data-today-refresh]').hidden};
 });
 expect(result).toEqual({plays:0,returned:true,error:'',disabled:true,refreshHidden:false});
});

test('a valid country and map expansion beyond twenty thousand keeps Today, Search and audio usable',async({page})=>{
 test.setTimeout(120000);await setupToday(page);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.RADIO_CONFIG={directorySnapshotUrl:'/directory/snapshot',featuredCountryCodes:['AT'],featuredCountryLimit:1000,auth:{enabled:false},metadataEnrichment:{enabled:false}};});
 const batch=(offset,count)=>Array.from({length:count},(_,index)=>({stationuuid:`00000000-0000-4000-8000-${String(offset+index+1).padStart(12,'0')}`,name:`Unique Signal ${offset+index+1}`,country:'Australia',countrycode:'AU',url:`https://streams.e2e.example/signal-${offset+index+1}.wav`,codec:'MP3',bitrate:128,lastcheckok:1}));
 const root=batch(0,10000);root[0]={...root[0],name:'Berlin Start',country:'Germany',countrycode:'DE',state:'Berlin',geo_lat:52.5,geo_long:13.4,clickcount:10000};
 const country=batch(10000,1000).map(row=>({...row,country:'Austria',countrycode:'AT'}));
 const mapped=batch(11000,10000).map(row=>({...row,geo_lat:-25,geo_long:133}));
 await page.route('**/directory/snapshot',route=>route.fulfill({json:root}));
 await page.route('**/directory/country/AT',route=>route.fulfill({json:country}));
 await page.route(url=>url.hostname.endsWith('api.radio-browser.info')&&url.searchParams.get('has_geo_info')==='true',route=>route.fulfill({json:mapped}));
 await page.goto('/');const play=page.locator('#er-today-place [data-today-play]');
 await expect(page.locator('#grid-count')).toContainText('11002',{timeout:20000});
 await expect(play).toHaveAccessibleName('Play Berlin Start');
 await play.click();await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
 const source=await page.locator('#audio-player').getAttribute('src');
 await openAtlasView(page);await page.locator('#er-map-search').click();
 await expect(page.locator('#er-map-search')).toBeEnabled();
 await expect(page.locator('#er-map-directory-status')).not.toContainText('Could not');
 await page.locator('#er-map-area').click();
 await expect(page.locator('#grid-count')).toContainText('21002',{timeout:20000});
 expect(errors).toEqual([]);
 await page.locator('.er-primary-nav [data-er-primary="atlas"]').click();await expect(play).toBeEnabled();
 await expect(page.locator('#er-today-city')).toHaveText('Berlin');
 await openSearchView(page);await page.locator('#er-discovery-query').fill('Unique Signal 21000');
 await expect(page.locator('.station-card__name')).toHaveText(['Unique Signal 21000']);
 await expect(page.locator('#player-station')).toHaveText('Berlin Start');
 await expect(page.locator('#audio-player')).toHaveAttribute('src',source);await expect(page.locator('#audio-player')).toHaveJSProperty('paused',false);
 expect(errors).toEqual([]);
});
