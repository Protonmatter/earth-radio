import test from 'node:test';
import assert from 'node:assert/strict';
import {presentedRawTitle} from '../site/assets/metadata-enrichment.js';

test('marked place and clock facts never become a raw song candidate',()=>{
 for(const meta of ['Berlin, Germany · Jazz · 13:00','Seoul, South Korea · K-pop · 21:00','Berlin، ألمانيا · Jazz · ١٣:٠٠']){
  assert.equal(presentedRawTitle({station:'Local Radio',meta,stationFacts:true}), '');
 }
});

test('explicit raw input survives place-only rendering and localized headings',()=>{
 assert.equal(presentedRawTitle({station:'Local Radio',meta:'Germany',stationFacts:true,rawTitle:'아이유 - 라망',eyebrow:'재생 중'}),'아이유 - 라망');
 assert.equal(presentedRawTitle({station:'Local Radio',stationFacts:true,rawTitle:'Local Radio'}),'');
 assert.equal(presentedRawTitle({stationFacts:true,rawTitle:'x'.repeat(513)}),'');
});

test('existing now-card identity keeps precedence and legacy raw input still works',()=>{
 assert.equal(presentedRawTitle({station:'Local Radio',eyebrow:'Now playing',nowTitle:'Known Song',artistLine:'Known Artist · details',rawTitle:'Old Artist - Old Song',stationFacts:true}),'Known Artist - Known Song');
 assert.equal(presentedRawTitle({station:'Local Radio',meta:'Raw Artist - Raw Song · a station'}),'Raw Artist - Raw Song');
 assert.equal(presentedRawTitle({station:'Local Radio',meta:'Germany · 128 kbps · MP3'}),'');
});
