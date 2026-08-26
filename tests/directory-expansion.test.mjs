import assert from 'node:assert/strict';
import test from 'node:test';

const scriptUrl = new URL('../site/assets/directory-expansion.js', import.meta.url);

test('an unrelated load cannot settle an owned refresh or leave a stale terminal result', async () => {
  const originalGlobals = {
    CustomEvent: globalThis.CustomEvent,
    HTMLInputElement: globalThis.HTMLInputElement,
    document: globalThis.document,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
    window: globalThis.window
  };
  const nativeSetTimeout = globalThis.setTimeout;
  const localValues = new Map([
    ['earth-radio-country-index-v1', JSON.stringify({
      savedAt: Date.now(),
      list: [
        { name: 'Japan', code: 'JP', stationcount: 2 },
        { name: 'Brazil', code: 'BR', stationcount: 1 }
      ]
    })]
  ]);
  const runtimeWindow = new EventTarget();
  runtimeWindow.RADIO_CONFIG = { featuredCountryCodes: ['US'] };
  const runtimeDocument = new EventTarget();
  runtimeDocument.readyState = 'complete';

  let activeRefreshes = 0;
  let peakRefreshes = 0;
  let terminalCodes = [];
  const requestCodes = [];
  const runPhysicalRefresh = () => new Promise(resolve => {
      const codes = [...runtimeWindow.RADIO_CONFIG.featuredCountryCodes];
      requestCodes.push(codes);
      activeRefreshes += 1;
      peakRefreshes = Math.max(peakRefreshes, activeRefreshes);
      const delay = requestCodes.length === 1 ? 40 : 0;
      nativeSetTimeout(() => {
        terminalCodes = codes;
        activeRefreshes -= 1;
        runtimeWindow.dispatchEvent(new CustomEvent('earthradio:stations-load-settled', {
          detail: { ok: true }
        }));
        resolve({ ok: true });
      }, delay);
  });
  const refreshButton = {
    click() {
      void runPhysicalRefresh();
    }
  };
  runtimeDocument.getElementById = id => id === 'refresh-stations' ? refreshButton : null;

  try {
    globalThis.CustomEvent ??= class CustomEvent extends Event {
      constructor(type, options = {}) {
        super(type, options);
        this.detail = options.detail;
      }
    };
    globalThis.HTMLInputElement = class HTMLInputElement {};
    globalThis.document = runtimeDocument;
    globalThis.fetch = async () => { throw new Error('cached country index should avoid fetch'); };
    globalThis.localStorage = {
      getItem: key => localValues.get(key) ?? null,
      removeItem: key => localValues.delete(key),
      setItem: (key, value) => localValues.set(key, String(value))
    };
    globalThis.requestAnimationFrame = callback => callback(0);
    // Compress the inherited stale-bundle fallback so the regression exposes its
    // overlap without making the direct Node suite wait twelve seconds.
    globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
      callback,
      Math.min(Number(delay) || 0, 5),
      ...args
    );
    globalThis.window = runtimeWindow;

    // Boot/manual load A is already active before the directory overlay owns a
    // refresh. The runtime API serializes calls behind it and returns the specific
    // drain promise; the legacy global settle event is deliberately also emitted.
    activeRefreshes = 1;
    peakRefreshes = 1;
    const unrelatedLoad = new Promise(resolve => nativeSetTimeout(() => {
      terminalCodes = ['US'];
      activeRefreshes -= 1;
      runtimeWindow.dispatchEvent(new CustomEvent('earthradio:stations-load-settled', {
        detail: { ok: true }
      }));
      resolve();
    }, 10));
    let runtimeTail = unrelatedLoad;
    runtimeWindow.earthRadioRuntime = Object.freeze({
      refreshStations() {
        const owned = runtimeTail.then(() => runPhysicalRefresh());
        runtimeTail = owned.catch(() => {});
        return owned;
      }
    });

    await import(`${scriptUrl.href}?race=${Date.now()}`);
    const japan = await runtimeWindow.earthRadioDirectory.expand('Japan');
    await new Promise(resolve => nativeSetTimeout(resolve, 20));
    const brazil = await runtimeWindow.earthRadioDirectory.expand('Brazil');
    assert.equal(japan.code, 'JP');
    assert.equal(brazil.code, 'BR');

    await new Promise(resolve => nativeSetTimeout(resolve, 80));

    assert.equal(peakRefreshes, 1, 'a second forced refresh started before the delayed first refresh settled');
    assert.deepEqual(requestCodes, [
      ['US', 'JP'],
      ['US', 'JP', 'BR']
    ]);
    assert.deepEqual(terminalCodes, ['US', 'JP', 'BR']);
  } finally {
    for (const [name, value] of Object.entries(originalGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('a country whose forced refresh failed is retried on re-selection', async () => {
  const originalGlobals = {
    CustomEvent: globalThis.CustomEvent,
    HTMLInputElement: globalThis.HTMLInputElement,
    document: globalThis.document,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
    window: globalThis.window
  };
  const nativeSetTimeout = globalThis.setTimeout;
  const localValues = new Map([
    ['earth-radio-country-index-v1', JSON.stringify({
      savedAt: Date.now(),
      list: [{ name: 'Japan', code: 'JP', stationcount: 2 }]
    })]
  ]);
  const runtimeWindow = new EventTarget();
  runtimeWindow.RADIO_CONFIG = { featuredCountryCodes: ['US'] };
  const runtimeDocument = new EventTarget();
  runtimeDocument.readyState = 'complete';
  runtimeDocument.getElementById = () => null;

  const outcomes = [{ ok: false }, { ok: true }];
  let refreshes = 0;
  try {
    globalThis.CustomEvent ??= class CustomEvent extends Event {
      constructor(type, options = {}) {
        super(type, options);
        this.detail = options.detail;
      }
    };
    globalThis.HTMLInputElement = class HTMLInputElement {};
    globalThis.document = runtimeDocument;
    globalThis.fetch = async () => { throw new Error('cached country index should avoid fetch'); };
    globalThis.localStorage = {
      getItem: key => localValues.get(key) ?? null,
      removeItem: key => localValues.delete(key),
      setItem: (key, value) => localValues.set(key, String(value))
    };
    globalThis.requestAnimationFrame = callback => callback(0);
    globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
      callback,
      Math.min(Number(delay) || 0, 5),
      ...args
    );
    globalThis.window = runtimeWindow;
    runtimeWindow.earthRadioRuntime = Object.freeze({
      refreshStations() {
        refreshes += 1;
        // First forced load fails outright (the runtime would fall back to the
        // pre-expansion cache); the retry succeeds.
        return Promise.resolve(outcomes[Math.min(refreshes - 1, outcomes.length - 1)]);
      }
    });

    await import(`${scriptUrl.href}?retry=${Date.now()}`);
    const first = await runtimeWindow.earthRadioDirectory.expand('Japan');
    assert.equal(first.expanded, true);
    await new Promise(resolve => nativeSetTimeout(resolve, 30));
    assert.equal(refreshes, 1);

    // The code is applied but its stations never arrived: re-selection must retry
    // the load instead of reporting the country as covered.
    const second = await runtimeWindow.earthRadioDirectory.expand('Japan');
    assert.equal(second.expanded, false);
    assert.equal(second.reason, 'retrying incomplete load');
    await new Promise(resolve => nativeSetTimeout(resolve, 30));
    assert.equal(refreshes, 2);

    // After the successful retry the country counts as covered again.
    const third = await runtimeWindow.earthRadioDirectory.expand('Japan');
    assert.equal(third.reason, 'already covered');
    assert.equal(refreshes, 2);
  } finally {
    for (const [name, value] of Object.entries(originalGlobals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
