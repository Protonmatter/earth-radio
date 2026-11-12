import test from 'node:test';import assert from 'node:assert/strict';
import {directorySnapshotStale,directorySnapshotStatus} from '../site/assets/directory-status.js';
test('snapshot age is the same for a cold native response and an IndexedDB copy',()=>{
  const now=Date.now(),old={generatedAt:new Date(now-7200001).toISOString()};
  assert.equal(directorySnapshotStale(old,now),true);assert.equal(directorySnapshotStale({generatedAt:new Date(now-7200000).toISOString()},now),false);
  for(const cached of [true,false])assert.match(directorySnapshotStatus({directorySnapshot:old,cached,stale:false},123),/Saved copy/);
});
test('fresh status shows its timestamp without claiming a live provider request',()=>{
  const result=directorySnapshotStatus({directorySnapshot:{generatedAt:new Date().toISOString()},stale:false},123);
  assert.match(result,/123 stations · Snapshot/);assert.doesNotMatch(result,/Saved copy|live/);
});
test('unknown legacy generation falls back to the existing source status',()=>{
  assert.equal(directorySnapshotStatus({},123),null);assert.equal(directorySnapshotStale(null),false);
});

test('a shared-only fallback never claims the full catalog is ready or freshly cached',()=>{
  for(const cached of [false,true])assert.equal(directorySnapshotStatus({partial:'shared-station',cached,stale:cached,directorySnapshot:{generatedAt:new Date().toISOString()}},1),'This station is ready. The directory is unavailable; refresh to browse more.');
});
