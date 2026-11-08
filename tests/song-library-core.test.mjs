import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSong, songId, songServiceLinks, emptySongLibrary, normalizeSongLibrary,
  setSongLiked, recordHeardSong, recordHeardSongs, clearSongHistory, removeSong, setSongHistoryEnabled,
  mergeSongLibraries, mergeSongLibrariesThreeWay, libraryEntries, ListeningSession,
  exportSongLibrary, importSongLibrary, encodeSongEnvelope, decodeSongEnvelope,
  songNamespaceKey, songSyncStateKey
} from '../site/assets/song-library-core.js';

const track = (id = '1'.repeat(64)) => ({ id, title: 'A measured melody', artist: 'Test Artist',
  stationUuid: 'fixture-station', stationName: 'Fixture Radio', catalogMatched: false });

test('queued observations are idempotent, bulk bounded and cannot restore cleared history', () => {
  const observations = Array.from({ length: 200 }, (_, i) => ({ song: track((i + 1).toString(16).padStart(64, '0')), at: i + 1, historyEpoch: 0 }));
  const saved = recordHeardSongs(emptySongLibrary(), observations);
  assert.equal(libraryEntries(saved).length, 200);
  assert.deepEqual(recordHeardSongs(saved, observations), saved);
  const cleared = clearSongHistory(saved, 500);
  assert.deepEqual(recordHeardSongs(cleared, observations), cleared);
  assert.deepEqual(recordHeardSongs(setSongHistoryEnabled(saved, false), observations), setSongHistoryEnabled(saved, false));
});

test('song normalization requires an artist/title and never accepts unsafe catalog/artwork links', () => {
  assert.equal(normalizeSong({ title: 'Station facts' }), null);
  assert.equal(normalizeSong({ title: '', artist: 'Artist' }), null);
  const song = normalizeSong({ ...track(), album: 'An album', artworkUrl: 'https://127.0.0.1/private',
    links: { spotify: 'javascript:alert(1)' }, ignored: 'never persisted' });
  assert.equal(song.album, 'An album'); assert.equal(song.artworkUrl, '');
  assert.equal(Object.hasOwn(song, 'ignored'), false);
  assert.deepEqual(song.links, {});
});

test('song IDs normalize Unicode/case/whitespace but preserve artist identity', async () => {
  assert.equal(await songId({ title: '  HELLO  ', artist: 'Ｂｅｙｏｎｃｅ́' }), await songId({ title: 'hello', artist: 'Beyoncé' }));
  assert.notEqual(await songId(track()), await songId({ ...track(), artist: 'Another artist' }));
  assert.match(await songId(track()), /^[a-f0-9]{64}$/);
});

test('all four music services have honest searches; only verified known track URLs become exact links', () => {
  const search = songServiceLinks({ ...track(), title: '라망', artist: '아이유' });
  assert.deepEqual(search.map(x => x.service), ['Spotify', 'Apple Music', 'Tidal', 'YouTube Music']);
  assert.ok(search.every(x => x.kind === 'search' && new URL(x.href).protocol === 'https:'));
  assert.ok(search.every(x => decodeURIComponent(x.href).includes('아이유')));
  const linked = songServiceLinks({ ...track(), catalogMatched: true,
    links: { spotify: 'https://open.spotify.com/track/01234567890123456789ab?si=discard',
      appleMusic: 'https://music.apple.com/us/album/example/123?i=456&uo=4', tidal: 'https://tidal.com.evil.example/track/123' } });
  assert.equal(linked[0].kind, 'track'); assert.equal(new URL(linked[0].href).search, '');
  assert.equal(linked[1].kind, 'track'); assert.equal(new URL(linked[1].href).search, '?i=456');
  assert.equal(linked[2].kind, 'search');
  assert.ok(songServiceLinks({ ...track(), links: { spotify: linked[0].href } }).every(x => x.kind === 'search'));
});

test('hearing and liking are distinct; likes survive a history clear', () => {
  const initial = emptySongLibrary();
  const liked = setSongLiked(initial, track(), true, 1000);
  assert.equal(libraryEntries(liked, 'liked').length, 1);
  assert.equal(libraryEntries(liked, 'recent').length, 0);
  const heard = recordHeardSong(liked, track(), 2000);
  const cleared = clearSongHistory(heard, 3000);
  assert.equal(libraryEntries(cleared, 'recent').length, 0);
  assert.equal(libraryEntries(cleared, 'liked').length, 1);
  assert.equal(libraryEntries(initial, 'liked').length, 0);
  assert.equal(libraryEntries(recordHeardSong(setSongHistoryEnabled(cleared, false), track(), 4000), 'recent').length, 0);
});

test('logical history epochs defeat an old offline client even with a future wall clock', () => {
  const base = recordHeardSong(emptySongLibrary(), track(), 1000);
  const cleared = clearSongHistory(base, 2000);
  const stale = recordHeardSong(base, track('2'.repeat(64)), 9000000);
  const merged = mergeSongLibraries(cleared, stale);
  assert.equal(libraryEntries(merged, 'recent').length, 0);
  assert.equal(libraryEntries(recordHeardSong(merged, track(), 2500), 'recent').length, 1);
});

test('concurrent listening cannot undo an explicit unlike; merges are commutative/idempotent', () => {
  const base = setSongLiked(emptySongLibrary(), track(), true, 1000);
  const unlike = setSongLiked(base, track(), false, 2000);
  const hearing = recordHeardSong(base, track(), 3000);
  const merged = mergeSongLibrariesThreeWay(base, unlike, hearing);
  assert.equal(libraryEntries(merged, 'liked').length, 0);
  assert.equal(libraryEntries(merged, 'recent').length, 1);
  assert.deepEqual(merged, mergeSongLibrariesThreeWay(base, hearing, unlike));
  assert.deepEqual(merged, mergeSongLibraries(merged, merged));
  const removed = removeSong(merged, track().id, 4000);
  assert.equal(libraryEntries(mergeSongLibraries(removed, base), 'liked').length, 0);
  assert.equal(removed.tracks[track().id].track, null);
  assert.equal(mergeSongLibrariesThreeWay(base, hearing, undefined), undefined);
});

test('bounded retention preserves liked songs and never silently evicts a like at capacity', () => {
  let library = emptySongLibrary();
  for (let i = 1; i <= 205; i++) library = recordHeardSong(library, track(i.toString(16).padStart(64, '0')), i * 1000);
  assert.equal(libraryEntries(library, 'recent').length, 200);
  library = emptySongLibrary();
  for (let i = 1; i <= 500; i++) library = setSongLiked(library, track(i.toString(16).padStart(64, '0')), true, i * 1000);
  assert.throws(() => setSongLiked(library, track('f'.repeat(64)), true, 999000), error => error.code === 'LIBRARY_FULL');
  assert.equal(libraryEntries(library, 'liked').length, 500);
});

test('equal logical versions converge despite different wall-clock timestamps', () => {
  const a = setSongLiked(emptySongLibrary(), track(), true, 1000);
  const b = setSongLiked(emptySongLibrary(), track(), true, 2000);
  assert.deepEqual(mergeSongLibraries(a, b), mergeSongLibraries(b, a));
  const removedA = removeSong(a, track().id, 3000), removedB = removeSong(b, track().id, 4000);
  assert.deepEqual(mergeSongLibraries(removedA, removedB), mergeSongLibraries(removedB, removedA));
  const future = setSongLiked(emptySongLibrary(), track(), true, 9000000);
  const unlike = setSongLiked(future, track(), false, 1000);
  assert.equal(libraryEntries(mergeSongLibraries(future, unlike), 'liked').length, 0);
});

test('richer catalog facts survive a later broadcast feed but the last heard station stays accurate', () => {
  const liked = setSongLiked(emptySongLibrary(), { ...track(), album: 'Verified album', catalogMatched: true }, true, 1000);
  const heard = recordHeardSong(liked, { ...track(), stationUuid: 'second', stationName: 'Second Radio' }, 2000);
  const row = libraryEntries(heard, 'recent')[0];
  assert.equal(row.track.album, 'Verified album'); assert.equal(row.stationName, 'Second Radio');
});

test('15 seconds of advancing playback qualifies once; pause, buffering and seek jumps do not', () => {
  const session = new ListeningSession({ minimumSeconds: 15 }); session.setTrack(track());
  assert.equal(session.sample({ mediaTime: 0, now: 0, playing: true }), null);
  assert.equal(session.sample({ mediaTime: 100, now: 100, playing: true }), null);
  for (let i = 1; i <= 10; i++) assert.equal(session.sample({ mediaTime: 100 + i, now: 100 + i * 1000, playing: true }), null);
  assert.equal(session.sample({ mediaTime: 110, now: 20000, playing: false }), null);
  assert.equal(session.sample({ mediaTime: 110, now: 30000, playing: true }), null);
  let qualified = null;
  for (let i = 1; i <= 5; i++) qualified = session.sample({ mediaTime: 110 + i, now: 30000 + i * 1000, playing: true });
  assert.equal(qualified.id, track().id);
  assert.equal(session.sample({ mediaTime: 116, now: 36000, playing: true }), null);
  session.setTrack(track('2'.repeat(64)));
  assert.equal(session.sample({ mediaTime: 116, now: 37000, playing: true }), null);
  assert.equal(session.sample({ mediaTime: 116, now: 90000, playing: true }), null);
});

test('background playback can qualify without animation frames and an identity change resets dwell', () => {
  const session = new ListeningSession(); session.setTrack(track());
  session.sample({ mediaTime: 0, now: 0, playing: true });
  assert.ok(session.sample({ mediaTime: 30, now: 30000, playing: true }));
  session.setTrack({ ...track(), stationUuid: 'another-station' });
  assert.equal(session.sample({ mediaTime: 35, now: 35000, playing: true }), null);
  session.setTrack(null);
  assert.equal(session.sample({ mediaTime: 90, now: 90000, playing: true }), null);
});

test('portable exports/imports contain only library data and reject malformed/future documents', () => {
  const library = setSongLiked(emptySongLibrary(), track(), true, 1000);
  const exported = exportSongLibrary(library, 2000);
  assert.deepEqual(importSongLibrary(exported), library);
  assert.doesNotMatch(exported, /account:|access_token|refresh_token/);
  assert.throws(() => importSongLibrary('{broken'), /JSON|library/i);
  assert.throws(() => normalizeSongLibrary({ version: 2, tracks: {} }), /version/i);
});

test('namespace-bound backup integrity cannot restore a different account or tampered data', () => {
  const library = setSongLiked(emptySongLibrary(), track(), true, 1000);
  const envelope = encodeSongEnvelope('account:user-a', 2, library, 2000);
  assert.deepEqual(decodeSongEnvelope(envelope, 'account:user-a').value, library);
  assert.equal(decodeSongEnvelope(envelope, 'account:user-b'), null);
  assert.equal(decodeSongEnvelope({ ...envelope, generation: 3 }, 'account:user-a'), null);
  assert.notEqual(songNamespaceKey('account:user-a'), songNamespaceKey('account:user-b'));
  assert.notEqual(songSyncStateKey('account:user-a'), songNamespaceKey('account:user-a'));
});
