import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumAtlasZoom,atlasCenter} from '../site/assets/map-viewport.js';

test('minimum atlas zoom keeps the full vertical viewport inside -60 to 85 degrees',()=>{
  for(const height of [240,480,650,900,2160]){
    const zoom=minimumAtlasZoom(height),center=atlasCenter([25,5],zoom,height);
    const project=lat=>(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2*256*2**zoom;
    const y=project(center[0]);
    assert.ok(y-height/2>=project(85)-1e-6);
    assert.ok(y+height/2<=project(-60)+1e-6);
    assert.equal(center[1],5);
  }
});

test('invalid or hidden viewport inputs have explicit bounded defaults',()=>{
  for(const value of [0,-1,NaN,Infinity])assert.equal(minimumAtlasZoom(value),1);
  assert.deepEqual(atlasCenter([NaN,Infinity],2,480),atlasCenter([25,5],2,480));
});
