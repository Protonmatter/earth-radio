import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchDirectoryForPublication} from '../scripts/build-directory-snapshot.mjs';

const first=Array.from({length:10000},(_,i)=>({stationuuid:'station-'+i}));
const result=(status,body)=>({statusCode:status,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(body))});
test('producer pages bulk data with bounded requests instead of one oversized upstream response',async()=>{
  const offsets=[];
  const data=await fetchDirectoryForPublication({requestImpl:async raw=>{
    const url=new URL(raw);if(url.pathname==='/json/servers')return result(200,[{name:'de1.api.radio-browser.info'}]);
    if(Number(url.searchParams.get('limit'))>10000)return result(502,{error:'upstream response too large'});
    const offset=Number(url.searchParams.get('offset'));offsets.push(offset);return result(200,offset===0?first:[{stationuuid:'last'}]);
  }});
  assert.deepEqual(offsets,[0,10000]);assert.equal(data.rows.length,10001);
});

test('producer rejects repeated pages and preserves a failed generation',async()=>{
  await assert.rejects(fetchDirectoryForPublication({requestImpl:async raw=>new URL(raw).pathname==='/json/servers'?result(200,[{name:'de1.api.radio-browser.info'}]):result(200,first)}),/repeat|pagination|limit/i);
});
test('partial page overlap cannot masquerade as a complete directory',async()=>{
  await assert.rejects(fetchDirectoryForPublication({requestImpl:async raw=>{
    const url=new URL(raw);if(url.pathname==='/json/servers')return result(200,[{name:'de1.api.radio-browser.info'}]);
    return result(200,url.searchParams.get('offset')==='0'?first:first.slice(-1000));
  }}),/duplicate/);
});

test('failed discovered mirrors try another validated seed within the same deadline',async()=>{
  const attempted=[];
  const data=await fetchDirectoryForPublication({requestImpl:async raw=>{
    const url=new URL(raw);if(url.pathname==='/json/servers')return result(200,[{name:'de1.api.radio-browser.info'}]);
    attempted.push(url.hostname);return url.hostname.startsWith('de1.')?result(503,{error:'outage'}):result(200,first.slice(0,1000));
  }});
  assert.equal(data.rows.length,1000);assert.deepEqual(attempted,['de1.api.radio-browser.info','de2.api.radio-browser.info']);
});
