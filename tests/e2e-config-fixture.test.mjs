import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {setupApp} from './e2e/helpers.mjs';

async function configWhenBackendResets(enableAuth){
  const routes=[];let payload,fetches=0;
  const page={addInitScript:async()=>{},route:async(pattern,handler)=>routes.push({pattern,handler})};
  await setupApp(page,{navigate:false,enableAuth});
  const target=new URL('http://127.0.0.1:4173/config.js?v=fixture'),row=routes.findLast(row=>typeof row.pattern==='function'?row.pattern(target):row.pattern==='**/config.js*');assert.equal(typeof row?.handler,'function');
  await row.handler({fetch:async()=>{fetches++;throw Object.assign(Error('Fixture loopback connection reset'),{code:'ECONNRESET'});},fulfill:async value=>{payload=value;}});
  return{payload,fetches,matcher:row.pattern};
}
function evaluateConfig(body,existing){
  // Static imports and the final account-overlay import are exercised by real
  // browsers. Here execute the actual config object with isolated public stubs.
  const source=body.split(/\r?\n/).filter(line=>!/^\s*(?:import\b|void import\()/.test(line)).join('\n');
  const window={location:{origin:'http://127.0.0.1:4173'},...(existing?{RADIO_CONFIG:existing}:{})};
  vm.runInNewContext(source,{window,AUTH_DEPLOYMENT:{},isWebAuthOrigin:()=>false,isDesktopAuthAvailable:()=>false});
  return window.RADIO_CONFIG;
}

for(const enableAuth of [false,true])test(`hermetic config still configures the app when loopback resets, auth=${enableAuth}`,async()=>{
  const{payload,fetches}=await configWhenBackendResets(enableAuth);
  assert.equal(fetches,0);assert.equal(payload.status,200);assert.match(payload.headers['content-type'],/^text\/javascript/);assert.equal(payload.headers['cache-control'],'no-store');
  const config=evaluateConfig(payload.body);assert.equal(config.directorySnapshotUrl,'');assert.equal(config.auth.enabled,enableAuth);
  assert.equal(config.proxyBaseUrl,'');assert.equal(config.stationLimit,3000);assert.equal(config.metadataEnrichment.enabled,true);
  assert.equal(config.auth.providers.google,true);assert.equal(config.auth.providers.github,true);
  assert.match(payload.body,/void import\('\.\/assets\/auth-ui\.js\?v=/);
});

test('hermetic config preserves explicitly injected app settings without contacting the backend',async()=>{
  const{payload}=await configWhenBackendResets(true),injected={directorySnapshotUrl:'/directory/snapshot',auth:{enabled:false},fixtureMarker:'preserve'};
  assert.equal(evaluateConfig(payload.body,injected),injected);assert.equal(injected.auth.enabled,false);assert.equal(injected.directorySnapshotUrl,'/directory/snapshot');
});

test('hermetic config cannot mask nested missing paths or a foreign-origin script request',async()=>{
  const{matcher}=await configWhenBackendResets(false);assert.equal(typeof matcher,'function');
  assert.equal(matcher(new URL('http://127.0.0.1:4174/config.js?v=fixture')),true);
  for(const url of ['http://127.0.0.1:4173/s/id/config.js','http://127.0.0.1:4173/config.js-missing','https://example.com/config.js','https://127.0.0.1/config.js','http://fixture:invalid@127.0.0.1/config.js'])assert.equal(matcher(new URL(url)),false,url);
});
