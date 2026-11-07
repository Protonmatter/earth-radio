// Electron does not await async before-quit listeners. Hold normal quit until
// encrypted updates/deletions finish, then allow exactly one resumed quit.
export function createQuitGate({ finish, quit, onFailure, timeoutMs = 15000 }) {
  let finished = false, pending = false;
  return event => {
    if (finished) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    let timer;
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Secure shutdown timed out.')), timeoutMs);
    });
    void Promise.race([Promise.resolve().then(finish), deadline]).then(() => {
      finished = true;
      quit();
    }).catch(() => {
      // No forced exit on a locked/failed vault. Keep the app alive so the user
      // can unlock and retry Quit; an OS force-termination is outside this gate.
      pending = false;
      onFailure();
    }).finally(() => clearTimeout(timer));
  };
}

export function claimDesktopInstance(app, focusWindow) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return false; }
  app.on('second-instance', focusWindow);
  return true;
}
