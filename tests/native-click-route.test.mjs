import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isRadioBrowserUuid} from '../site/assets/station-clicks.js';
import {createDesktopProxy} from '../server/desktop-proxy.mjs';

const source=await readFile(new URL('../server/desktop-proxy.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function route('),source.indexOf('function applyCors('));
const valid='00000000-0000-4000-8000-000000000201';
function fixture(){
  const calls=[];
  const context={URL,isRadioBrowserUuid,handleMetadataApi:async()=>false,applyCors:()=>true,
    sendJson:(_res,status,body)=>({status,body}),recordClick:async id=>{calls.push(id);return{ok:true};}};
  vm.runInNewContext(code,context);
  return{calls,request:value=>context.route({method:'GET',url:'/owned/api/stations/click/'+value},{},'/owned')};
}
test('the actual native click route rejects malformed and synthetic IDs without rewriting them or using upstream IO',async()=>{
  const f=fixture();
  for(const id of ['earth-radio%3Alisten.moe%3Ajpop','not-a-uuid',valid+'%21','%2F'+valid,'%FF','%']){
    const result=await f.request(id);assert.equal(result.status,400,id);assert.equal(f.calls.length,0);
  }
});
test('the actual native click route preserves a valid directory UUID',async()=>{
  const f=fixture(),result=await f.request(valid);assert.equal(result.status,200);assert.deepEqual(f.calls,[valid]);
});
test('the running capability proxy returns HTTP 400 for invalid counter targets',async()=>{
  const proxy=await createDesktopProxy();
  try{
    for(const id of ['earth-radio%3Alisten.moe%3Ajpop',valid+'%21','%FF']){
      const response=await fetch(proxy.baseUrl+'/api/stations/click/'+id,{headers:{Origin:'null'}});
      assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid station uuid'});
    }
  }finally{proxy.server.closeAllConnections();await proxy.close();}
});
