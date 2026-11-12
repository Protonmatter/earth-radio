import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installNativeMediaCapture} from './e2e/fixtures/media-session.mjs';

// Exercise the observer, not a product API substitute: native DOM wrappers can
// be renewed while sharing a prototype. Product e2e still uses real native APIs.
function wrapperFixture({rejectStop=false}={}){
  const calls=[];
  class NativeSession{
    setActionHandler(action,handler){
      if(rejectStop&&action==='stop')throw new DOMException('Fixture action unsupported','NotSupportedError');
      calls.push({action,handler,receiver:this});
    }
  }
  const scope={navigator:{get mediaSession(){return new NativeSession();}},MediaMetadata:class{}};scope.window=scope;
  return{scope,calls,page:{addInitScript:async fn=>vm.runInNewContext('('+fn.toString()+')()',scope)}};
}

test('native callback observer survives renewed wrapper instances without replacing the API',async()=>{
  const f=wrapperFixture();await installNativeMediaCapture(f.page);
  for(const action of ['play','pause','stop','previoustrack','nexttrack']){
    const session=f.scope.navigator.mediaSession,handler=()=>{};session.setActionHandler(action,handler);
    assert.equal(f.scope.fixtureNativeMediaHandlers[action],handler,action);
    assert.equal(f.calls.at(-1).receiver,session);assert.equal(f.calls.at(-1).handler,handler);
  }
  assert.equal(f.scope.fixtureNativeMediaApi,true);assert.equal(f.calls.length,5);
});

test('native callback observer records a rejected action and rethrows without hiding later registrations',async()=>{
  const f=wrapperFixture({rejectStop:true});await installNativeMediaCapture(f.page);
  assert.throws(()=>f.scope.navigator.mediaSession.setActionHandler('stop',()=>{}),{name:'NotSupportedError'});
  const next=()=>{};f.scope.navigator.mediaSession.setActionHandler('nexttrack',next);
  assert.equal(f.scope.fixtureNativeMediaHandlers.stop,undefined);assert.equal(f.scope.fixtureNativeMediaHandlers.nexttrack,next);
  assert.equal(f.scope.fixtureNativeMediaRegistration.stop.registered,false);assert.equal(f.scope.fixtureNativeMediaRegistration.stop.errorName,'NotSupportedError');
  assert.equal(f.scope.fixtureNativeMediaRegistration.nexttrack.registered,true);assert.equal(f.calls.length,1);
});
