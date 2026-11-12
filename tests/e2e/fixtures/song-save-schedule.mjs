// Hold native success events before the library can begin its write transaction.
// Install only after the isolated guest library is ready; no account data is read.
export async function holdSongStorageOpen(page) {
  await page.evaluate(() => {
    const nativeOpen = IDBFactory.prototype.open;
    const gate = { active: true, pending: [], held: 0 };
    IDBFactory.prototype.open = function (...args) {
      const request = Reflect.apply(nativeOpen, this, args);
      if (args[0] === 'earthRadio') request.addEventListener('success', event => {
        if (!gate.active) return;
        event.stopImmediatePropagation();
        gate.held++;
        gate.pending.push(() => request.dispatchEvent(new Event('success')));
      }, true);
      return request;
    };
    window.__erSongSaveGate = {
      held: () => gate.held,
      release() {
        gate.active = false;
        IDBFactory.prototype.open = nativeOpen;
        for (const complete of gate.pending.splice(0)) complete();
      }
    };
  });
}

export const heldSongStorageOpens = page => page.evaluate(() => window.__erSongSaveGate.held());
export const releaseSongStorageOpen = page => page.evaluate(() => window.__erSongSaveGate?.release());
