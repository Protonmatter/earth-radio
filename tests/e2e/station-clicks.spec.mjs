import {test,expect} from '@playwright/test';
import {silentWav} from './helpers.mjs';
import {FIXTURE_STATIONS} from './fixtures/stations.mjs';

const id='00000000-0000-4000-8000-000000000201',otherId='00000000-0000-4000-8000-000000000202';
async function setup(page,{fail=false,hang=false}={}){
  const clicks=[],held=[],rows=[{...FIXTURE_STATIONS[0],stationuuid:id,name:'Counter fixture one',url:'https://streams.e2e.example/counter-one',url_resolved:'https://streams.e2e.example/counter-one'},
    {...FIXTURE_STATIONS[0],stationuuid:otherId,name:'Counter fixture two',url:'https://streams.e2e.example/counter-two',url_resolved:'https://streams.e2e.example/counter-two'}];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/directory/snapshot')return route.fulfill({json:rows});
    if(url.hostname.endsWith('api.radio-browser.info')){
      if(url.pathname.startsWith('/json/url/'))clicks.push(decodeURIComponent(url.pathname.split('/').at(-1)));
      return route.fulfill({json:url.pathname==='/json/servers'?[{name:'de1.api.radio-browser.info'}]:{ok:true}});
    }
    if(url.hostname==='streams.e2e.example'){
      if(url.pathname==='/counter-one'&&hang){held.push(route);return;}
      if(url.pathname==='/counter-one'&&fail)return route.abort('failed');
      if(url.pathname.startsWith('/counter-'))return route.fulfill({contentType:'audio/wav',body:silentWav(120)});
      return route.fulfill({status:404,body:'No metadata'});
    }
    if(url.hostname==='listen.moe')return route.fulfill({contentType:'audio/wav',body:silentWav(120)});
    return url.hostname==='127.0.0.1'?route.continue():route.abort();
  });
  await page.goto('/#listen');await page.getByRole('searchbox',{name:'Find a station'}).fill('Counter fixture');
  await expect(page.locator('.station-card__name')).toHaveCount(2);
  return{clicks,held,release:()=>Promise.allSettled(held.splice(0).map(route=>route.abort()))};
}
const play=(page,name)=>page.getByRole('button',{name:'Play: '+name,exact:true}).click();

test('failed station attempts produce no click report',async({page})=>{
  const state=await setup(page,{fail:true});await play(page,'Counter fixture one');
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible({timeout:8000});
  expect(state.clicks).toEqual([]);
});

test('replay, pause/resume and repeated playing events report one UUID per document session',async({page})=>{
  const state=await setup(page);await play(page,'Counter fixture one');
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);await expect.poll(()=>state.clicks.length).toBe(1);
  await play(page,'Counter fixture one');await page.locator('#btn-play').click();await page.locator('#btn-play').click();
  await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await page.evaluate(()=>document.getElementById('audio-player').dispatchEvent(new Event('playing')));
  await page.waitForTimeout(400);expect(state.clicks).toEqual([id]);
  await play(page,'Counter fixture two');await expect.poll(()=>state.clicks.length).toBe(2);
  expect(state.clicks).toEqual([id,otherId]);
});

test('synthetic direct-provider IDs never reach the Radio Browser click endpoint',async({page})=>{
  const state=await setup(page);await page.getByRole('searchbox',{name:'Find a station'}).fill('LISTEN.moe Jpop');
  await play(page,'LISTEN.moe');await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
  await page.waitForTimeout(500);expect(state.clicks).toEqual([]);
});

test('canplay and a superseded pending choice never count as confirmed playback',async({page})=>{
  const state=await setup(page,{hang:true});await play(page,'Counter fixture one');
  await expect.poll(()=>state.held.length).toBeGreaterThan(0);
  try{
    await page.evaluate(()=>document.getElementById('audio-player').dispatchEvent(new Event('canplay')));
    await page.evaluate(()=>document.getElementById('audio-player').dispatchEvent(new Event('playing')));
    await page.waitForTimeout(200);expect(state.clicks).toEqual([]);
    await play(page,'Counter fixture two');await expect(page.locator('#player-bar')).toHaveClass(/is-playing/);
    await state.release();await page.waitForTimeout(300);expect(state.clicks).toEqual([otherId]);
  }finally{await state.release();}
});
