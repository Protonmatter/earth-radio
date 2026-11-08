// Real IndexedDB commits with controlled completion delivery; all storage is disposable.
export async function reviewBackupOrdering(page) {
  return page.evaluate(async () => {
    const core = await import('/assets/song-library-core.js');
    const { createSongLibraryStore } = await import('/assets/song-library-store.js');

    async function fixture() {
      const dbName = `review-concurrent-backup-${crypto.randomUUID()}`;
      const values = new Map();
      const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
      };
      const owner = { ready: true, accountId: null, version: 1 };
      let delayNextWriteCompletion = false, release, observed;
      const completionObserved = () => new Promise(resolve => { observed = resolve; });

      // The real native transaction commits normally. Only delivery of its
      // completion callback to the first store is deferred. This models a tab
      // being suspended after commit, without holding any IndexedDB lock.
      function wrapDatabase(database) {
        return new Proxy(database, {
          get(target, key) {
            if (key === 'transaction') return (...args) => {
              const transaction = target.transaction(...args);
              return new Proxy(transaction, {
                get(inner, name) {
                  const value = Reflect.get(inner, name, inner);
                  return typeof value === 'function' ? value.bind(inner) : value;
                },
                set(inner, name, value) {
                  if (name === 'oncomplete' && args[1] === 'readwrite' && delayNextWriteCompletion) {
                    delayNextWriteCompletion = false;
                    inner.oncomplete = event => {
                      release = () => value(event);
                      observed();
                    };
                    return true;
                  }
                  return Reflect.set(inner, name, value, inner);
                }
              });
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
      const delayedImplementation = {
        open() {
          const request = indexedDB.open(dbName, 1);
          return new Proxy(request, {
            get(target, key) {
              if (key === 'result') return wrapDatabase(target.result);
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, key, value) { return Reflect.set(target, key, value, target); }
          });
        }
      };
      const first = createSongLibraryStore({ indexedDBImpl: delayedImplementation, storage, getAccount: () => owner });
      const second = createSongLibraryStore({ indexedDBImpl: { open: () => indexedDB.open(dbName, 1) }, storage, getAccount: () => owner });
      const key = core.songNamespaceKey('default');
      const x = { id: 'a'.repeat(64), artist: 'Review artist', title: 'First' };
      const y = { id: 'b'.repeat(64), artist: 'Review artist', title: 'Second' };
      const titles = value => core.libraryEntries(value, 'liked').map(entry => entry.track.title);
      async function raw(action) {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise((resolve, reject) => {
            const transaction = database.transaction('kv', 'readwrite');
            action(transaction.objectStore('kv'));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
          });
        } finally { database.close(); }
      }
      return {
        first, second, x, y, key, raw, titles,
        delayNextWrite() { delayNextWriteCompletion = true; return completionObserved(); },
        release() { const resume = release; release = undefined; resume?.(); },
        backups() {
          return [':backup', ':previous'].map(suffix => {
            const decoded = core.decodeSongEnvelope(JSON.parse(values.get(key + suffix) || 'null'), 'default');
            return { generation: decoded?.generation ?? 0, titles: titles(decoded?.value) };
          });
        },
        dispose() { this.release(); first.dispose(); second.dispose(); }
      };
    }

    const ordering = await fixture();
    let delayedRemoval;
    let orderingResult;
    try {
      await ordering.first.mutate(value => core.setSongLiked(core.setSongLiked(value, ordering.x, true, 10), ordering.y, true, 11));
      const committed = ordering.delayNextWrite();
      delayedRemoval = ordering.first.mutate(value => core.removeSong(value, ordering.x.id, 20));
      await committed;
      await ordering.second.mutate(value => core.removeSong(value, ordering.y.id, 30));
      const primaryBefore = ordering.titles((await ordering.second.read()).value);
      ordering.release();
      await delayedRemoval;
      const backups = ordering.backups();
      await ordering.raw(store => store.put({ broken: true }, ordering.key));
      const recovered = ordering.titles((await ordering.second.read()).value);
      orderingResult = { primaryBefore, backups, recovered };
    } finally { ordering.dispose(); await delayedRemoval; }

    const crash = await fixture();
    let unfinishedRemoval;
    let crashResult;
    try {
      await crash.first.mutate(value => core.setSongLiked(value, crash.x, true, 10));
      const committed = crash.delayNextWrite();
      unfinishedRemoval = crash.first.mutate(value => core.removeSong(value, crash.x.id, 20));
      await committed;
      // The destructive primary commit succeeded, but no backup publication ran.
      const staleBackups = crash.backups();
      await crash.raw(store => store.put({ broken: true }, crash.key));
      let errorCode;
      try { await crash.second.read(); } catch (error) { errorCode = error.code; }
      crash.release();
      await unfinishedRemoval;
      // A missing primary must also never recover the old, pre-removal copy.
      await crash.raw(store => store.delete(crash.key));
      const missingRead = await crash.second.read();
      await crash.second.mutate(value => core.setSongLiked(value, crash.y, true, 30));
      const nextRead = await crash.second.read();
      crashResult = { staleBackups, errorCode, missingTitles: crash.titles(missingRead.value), nextGeneration: nextRead.generation, nextTitles: crash.titles(nextRead.value) };
    } finally { crash.dispose(); await unfinishedRemoval; }

    return { ordering: orderingResult, crashGap: crashResult };
  });
}
