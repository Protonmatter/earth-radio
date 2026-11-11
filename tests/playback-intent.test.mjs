import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackIntent} from '../site/assets/playback-intent.js';

function fixture(){
  let time=0;const timers=[],expired=[];
  const intent=createPlaybackIntent({now:()=>time,setTimer:(fn,ms)=>{const task={fn,at:time+ms,live:true};timers.push(task);return task;},clearTimer:task=>{task.live=false;},onExpire:station=>expired.push(station.stationuuid)});
  return{intent,expired,timers,advance(to){time=to;let count=0;for(;;){const task=timers.find(t=>t.live&&t.at<=time);if(!task)break;assert.ok(count++<20);task.live=false;task.fn();}}};
}
const a={stationuuid:'a'},b={stationuuid:'b'};
test('manual selection never grants cross-program skipping and has one absolute sibling budget',()=>{
  const f=fixture(),token=f.intent.begin('program',a);assert.equal(f.intent.canAutoSkip(),false);
  f.advance(6000);assert.equal(f.intent.canRecover('program'),true);assert.equal(f.intent.begin('program',b,{recovery:true}),token);
  f.advance(7499);assert.equal(f.intent.isCurrent(token),true);f.advance(7500);
  assert.deepEqual(f.expired,['b']);assert.equal(f.intent.canRecover('program'),false);assert.equal(f.intent.playing('program'),false);
});
test('recovery cannot cross a program boundary or replace a newer selection',()=>{
  const f=fixture(),first=f.intent.begin('first',a);assert.equal(f.intent.begin('other',b,{recovery:true}),null);
  const next=f.intent.begin('other',b);assert.equal(f.intent.isCurrent(first),false);assert.equal(f.intent.isCurrent(next),true);assert.equal(f.intent.playing('first'),false);
  f.advance(7500);assert.deepEqual(f.expired,['b']);
});
test('confirmed playback ends connection timeout and a later recovery gets a fresh bounded budget',()=>{
  const f=fixture();f.intent.begin('program',a);f.advance(3000);assert.equal(f.intent.playing('program'),true);
  f.advance(20000);assert.deepEqual(f.expired,[]);assert.equal(f.intent.canRecover('program'),true);
  f.advance(27499);assert.deepEqual(f.expired,[]);f.advance(27500);assert.deepEqual(f.expired,['a']);
});
test('World Scan authority persists across siblings but not failure, cancellation or a manual selection',()=>{
  const f=fixture();f.intent.begin('program',a,{intent:'world-scan'});assert.equal(f.intent.canAutoSkip(),true);
  f.intent.begin('program',b,{recovery:true});assert.equal(f.intent.canAutoSkip(),true);f.intent.fail('program');assert.equal(f.intent.canAutoSkip(),false);
  f.intent.begin('program',a,{intent:'world-scan'});f.intent.cancel();assert.equal(f.intent.canAutoSkip(),false);
  f.intent.begin('program',a);assert.equal(f.intent.canAutoSkip(),false);f.intent.cancel();
});
test('a cancelled or failed selection ignores late timer callbacks and explicit retry starts a new attempt',()=>{
  const f=fixture(),first=f.intent.begin('program',a),old=f.timers[0];f.intent.cancel();old.fn();assert.deepEqual(f.expired,[]);
  f.intent.begin('program',a);f.intent.fail('program');assert.equal(f.intent.isCurrent(first),false);assert.equal(f.intent.canRecover('program'),false);
  const retry=f.intent.begin('program',a);assert.equal(f.intent.isCurrent(retry),true);f.advance(7500);assert.deepEqual(f.expired,['a']);
});
test('malformed selection and unknown intent cannot acquire scan authority',()=>{
  const f=fixture();assert.equal(f.intent.begin('',a),null);assert.equal(f.intent.begin('program',null),null);
  f.intent.begin('program',a,{intent:'scan-typo'});assert.equal(f.intent.canAutoSkip(),false);f.intent.cancel();
  assert.throws(()=>createPlaybackIntent({budgetMs:Infinity}),RangeError);
});
