// Real IndexedDB in a fresh test-only database. Synthetic owners never touch
// the app's earthRadio database or any original user profile.
export async function installPassportHarness(page) {
  await page.evaluate(async () => {
    const core = await import('/assets/passport-core.js');
    const songCore = await import('/assets/song-library-core.js');
    const { createSongLibraryStore } = await import('/assets/song-library-store.js');
    const { createPassportStore } = await import('/assets/passport-store.js');
    const dbName = 'passport-store-test-' + crypto.randomUUID(), copies = new Map();
    let owner = { ready: true, accountId: null, version: 1 }, storageFails = false;
    const storage = { getItem: key => copies.get(key) ?? null,
      setItem: (key, value) => { if (storageFails) throw new DOMException('Fixture quota', 'QuotaExceededError'); copies.set(key, value); },
      removeItem: key => copies.delete(key) };
    const nativeOpen = () => indexedDB.open(dbName, 1), normalIdb = { open: nativeOpen };
    const gate = { mode: null, threshold: 0, pending: null, started: null, resolve: null }, replay = new WeakSet();
    const passportIdb = { open() {
      const request = nativeOpen();
      request.addEventListener('success', event => {
        if (!gate.mode || replay.has(request)) return;
        event.stopImmediatePropagation();
        const release = () => { replay.add(request); request.dispatchEvent(new Event('success')); };
        if (gate.mode === 'next') { gate.mode = null; gate.pending = release; gate.resolve(); return; }
        const tx = request.result.transaction('kv', 'readonly'), read = tx.objectStore('kv').get(core.passportNamespaceKey(namespace()));
        tx.oncomplete = () => {
          if ((read.result?.generation || 0) >= gate.threshold) { gate.mode = null; gate.pending = release; gate.resolve(); }
          else release();
        };
      }, true);
      return request;
    } };
    const namespace = () => owner.accountId ? 'account:' + encodeURIComponent(owner.accountId) : 'default';
    const songs = createSongLibraryStore({ indexedDBImpl: normalIdb, storage, getAccount: () => owner });
    const passport = createPassportStore({ indexedDBImpl: passportIdb, storage, getAccount: () => owner });
    async function raw(operations, key) {
      const db = await new Promise((resolve, reject) => { const open = nativeOpen(); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', operations ? 'readwrite' : 'readonly'), store = tx.objectStore('kv'); let result;
        if (operations) for (const [name, target, value] of operations) name === 'put' ? store.put(value, target) : store.delete(target);
        else { const read = store.get(key); read.onsuccess = () => { result = read.result; }; }
        tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
      }); } finally { db.close(); }
    }
    const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
    async function rejects(operation, code, label) {
      let caught; try { await operation(); } catch (error) { caught = error; }
      check(caught?.code === code, label + ' (' + (caught?.code || 'no rejection') + ')');
    }
    const fence = async () => { const snapshot = await passport.read(); return { ownerVersion: snapshot.ownerVersion,
      historyEpoch: snapshot.historyEpoch, settingsVersion: snapshot.settingsVersion }; };
    async function setOwner(id, ready = true) {
      await raw([['put', 'account:active', id]]); owner = { ready, accountId: id, version: owner.version + 1 };
    }
    async function readyBoth() { await songs.ensureSyncBaseline(owner.accountId); await passport.ensureSyncBaseline(owner.accountId); }
    async function record(code, expected = null) {
      return passport.mutate(doc => core.recordPassportPlace(doc, { countrycode: code, confidence: 'country' }, 20_000), expected || await fence());
    }
    async function policy(enabled) { return songs.mutate(doc => songCore.setSongHistoryEnabled(doc, enabled), owner.version); }
    async function clear() { return songs.mutate(doc => songCore.clearSongHistory(doc, 1000), owner.version); }
    async function oldClientClear() {
      const key = songCore.songNamespaceKey(namespace()), before = await raw(null, key), floor = await raw(null, key + ':privacy');
      const doc = songCore.clearSongHistory(songCore.decodeSongEnvelope(before, namespace())?.value || songCore.emptySongLibrary(), 2000);
      const next = songCore.encodeSongEnvelope(namespace(), Math.max(before?.generation || 0, floor || 0) + 1, doc, 2000);
      await raw([['put', key, next], ['put', key + ':privacy', next.generation]]);
    }
    function hold(mode, threshold = 0) {
      if (gate.mode || gate.pending) throw Error('Only one fixture gate at a time');
      gate.mode = mode; gate.threshold = threshold; gate.started = new Promise(resolve => { gate.resolve = resolve; });
      return gate.started;
    }
    function release() { const pending = gate.pending; gate.pending = null; if (!pending) throw Error('No held native callback'); pending(); }
    await songs.read(); await passport.read();
    window.__passportTest = { core, songCore, songs, passport, createPassportStore, copies, check, rejects, checks, raw, namespace,
      fence, record, setOwner, readyBoth, policy, clear, oldClientClear, hold, release,
      pauseOwner() { owner = { ...owner, ready: false, version: owner.version + 1 }; },
      owner: () => ({ ...owner }), setStorageFailure(value) { storageFails = value; },
      key: () => core.passportNamespaceKey(namespace()), songKey: () => songCore.songNamespaceKey(namespace()),
      backups() { return [':backup', ':previous'].map(suffix => { const raw = copies.get(core.passportNamespaceKey(namespace()) + suffix); return raw ? core.decodePassportEnvelope(JSON.parse(raw), namespace()) : null; }); },
      dispose() { passport.dispose(); songs.dispose(); }
    };
  });
}
