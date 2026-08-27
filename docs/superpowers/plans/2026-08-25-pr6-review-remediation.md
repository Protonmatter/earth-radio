# PR #6 Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 14 unresolved PR #6 review threads without removing any feature, then prove the exact final head is safe to merge.

**Architecture:** Harden outbound URL fetching at two runtime-specific shared boundaries: DNS-pinned Node requests and manual-redirect Cloudflare requests. Add explicit browser/runtime events for selected-station identity and directory-refresh completion, replace content-based recovery inference with an IndexedDB generation marker, and serialize browser state transitions through small exported helpers that can be tested directly.

**Tech Stack:** Node.js 24 ESM, Cloudflare Pages Functions/Workers runtime, browser ES modules, IndexedDB, `node:test`, Playwright 1.62, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-pr6-review-remediation-design.md`

## Global Constraints

- Preserve every live-metadata, HLS, fingerprint, recovery, localization, and directory-expansion capability already present in PR #6.
- Use test-first red/green cycles for every behavior change; record the expected failing assertion before editing production code.
- Revalidate every redirect target and retain a single absolute deadline across all hops and HLS subrequests.
- Never treat empty favorites, recents, or `lastPlayed` as proof of data loss.
- Keep `src-recovered/main.ts`, the installed hashed runtime bundle, provenance overlays, `RELEASE_MANIFEST.json`, and `sha256sums.txt` consistent.
- Do not resolve GitHub review threads until final-head CI and independent review complete.

---

### Task 1: Node public-request redirect and wall-clock boundary

**Files:**
- Modify: `server/net-guard.mjs:11-119`
- Modify: `server/fingerprint-providers.mjs:8-166`
- Modify: `server/platform-nowplaying.mjs:7-64`
- Modify: `server/desktop-proxy.mjs` at all direct `requestLimited` callers
- Create: `tests/net-guard.test.mjs`
- Modify: `tests/live-metadata.test.mjs`
- Modify: `package.json` test script

**Interfaces:**
- Produces: `requestPublic(rawUrl, options) -> Promise<{ statusCode, headers, body, text, truncated, finalUrl }>`.
- Produces: `requestLimited(target, { deadlineAt, headers, maxBytes, stopWhen })`; `deadlineAt` is an absolute epoch millisecond value.
- Preserves: `resolvePublicTarget`, `createPinnedLookup`, `isPrivateIp`, and the existing partial-read result shape.
- Consumes: Node `http`, `https`, and DNS-pinned targets from `resolvePublicTarget`.

- [ ] **Step 1: Write failing redirect and deadline tests**

Add table-driven tests whose hand-written expectations catch the two real breaks:

```js
test('requestPublic follows a public redirect and revalidates its destination', async () => {
  const calls = [];
  const responses = new Map([
    ['https://radio.example/start', { statusCode: 302, headers: { location: '/audio' }, body: Buffer.alloc(0) }],
    ['https://radio.example/audio', { statusCode: 200, headers: { 'content-type': 'audio/mpeg' }, body: Buffer.from('audio') }]
  ]);
  const result = await requestPublic('https://radio.example/start', {
    resolveTarget: async href => ({ href, url: new URL(href), hostname: 'radio.example', address: '1.1.1.1', family: 4 }),
    requestOnce: async target => { calls.push(target.href); return responses.get(target.href); }
  });
  assert.deepEqual(calls, ['https://radio.example/start', 'https://radio.example/audio']);
  assert.equal(result.finalUrl, 'https://radio.example/audio');
});

test('requestPublic rejects a redirect to a private target before requesting it', async () => {
  let requests = 0;
  await assert.rejects(
    requestPublic('https://radio.example/start', {
      resolveTarget: async href => {
        if (href.includes('127.0.0.1')) throw new Error('private stream IPs are blocked');
        return { href, url: new URL(href), hostname: 'radio.example', address: '1.1.1.1', family: 4 };
      },
      requestOnce: async () => {
        requests += 1;
        return { statusCode: 302, headers: { location: 'http://127.0.0.1/admin' }, body: Buffer.alloc(0) };
      }
    }),
    /private stream IPs are blocked/
  );
  assert.equal(requests, 1);
});

test('requestLimited enforces wall-clock timeout during trickle traffic', async () => {
  const started = Date.now();
  await assert.rejects(requestLimited(localTarget, { deadlineAt: started + 120 }), /request timeout/);
  assert.ok(Date.now() - started < 500);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/net-guard.test.mjs tests/live-metadata.test.mjs`

Expected: failures because `requestPublic` and `deadlineAt` do not exist; the original fingerprint redirect test reports `stream HTTP 302`.

- [ ] **Step 3: Implement the shared Node boundary**

Add one default user agent and the redirect walker:

```js
const DEFAULT_USER_AGENT = 'EarthRadio/0.24.0 (+https://github.com/Protonmatter/EarthRadio)';

export async function requestPublic(rawUrl, {
  deadlineAt = Date.now() + DEFAULT_TIMEOUT_MS,
  maxRedirects = 4,
  resolveTarget = resolvePublicTarget,
  requestOnce = requestLimited,
  ...options
} = {}) {
  let href = String(rawUrl);
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (visited.has(href)) throw new Error('redirect loop blocked');
    visited.add(href);
    const target = await resolveTarget(href);
    const response = await requestOnce(target, { ...options, deadlineAt });
    if (!isRedirect(response.statusCode)) return { ...response, finalUrl: target.href };
    if (hop === maxRedirects) throw new Error('redirect limit exceeded');
    const location = String(response.headers?.location || '');
    if (!location) throw new Error('redirect location missing');
    href = new URL(location, target.href).toString();
  }
  throw new Error('redirect limit exceeded');
}
```

In `requestLimited`, compute `remaining = deadlineAt - Date.now()`, reject non-positive values, install a separate `setTimeout(() => request.destroy(new Error('request timeout')), remaining)`, clear it inside the single settle function, and merge the default user agent only when the caller did not supply one.

Replace raw `requestLimited` uses that consume radio-controlled URLs with `requestPublic`. Pass the same `deadlineAt` recursively through master playlists, media playlists, and segments. Leave recognition-provider POSTs unchanged because their hosts are fixed by configuration and they already have separate abort timers.

- [ ] **Step 4: Challenge alternate paths**

Add regressions for a redirect loop, relative redirect, 302 to IPv6 loopback, public HLS playlist redirect, and user-agent presence. Extend `isPrivateIp` coverage to fail closed for reserved/documentation networks including `192.0.2.0/24`, `198.51.100.0/24`, and `203.0.113.0/24`. Inspect every `requestLimited(` occurrence with `rg -n "requestLimited\(" server` and ensure no radio-controlled URL bypasses `requestPublic`.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/net-guard.test.mjs tests/live-metadata.test.mjs && node --check server/net-guard.mjs && node --check server/fingerprint-providers.mjs && node --check server/platform-nowplaying.mjs`

Expected: all focused tests pass with no warnings.

- [ ] **Step 6: Commit**

```bash
git add server/net-guard.mjs server/fingerprint-providers.mjs server/platform-nowplaying.mjs server/desktop-proxy.mjs tests/net-guard.test.mjs tests/live-metadata.test.mjs package.json
git commit -m "fix(network): guard redirects and absolute deadlines"
```

---

### Task 2: Cloudflare public-fetch boundary and deployable strict-public configuration

**Files:**
- Create: `functions/_shared/public-fetch.js`
- Modify: `functions/api/nowplaying.js`
- Modify: `functions/api/track/fingerprint.js`
- Create: `wrangler.jsonc`
- Create: `docs/CLOUDFLARE_DEPLOYMENT.md`
- Modify: `tests/pages-functions.test.mjs`
- Modify: `tests/validate-repository.test.mjs`
- Modify: `scripts/validate-repository.mjs`

**Interfaces:**
- Produces: `validatePublicUrl(rawUrl, { forbiddenOrigins }) -> URL`.
- Produces: `fetchPublic(rawUrl, { fetchImpl, deadlineAt, maxRedirects, forbiddenOrigins, headers, method, body }) -> Promise<Response>`.
- Produces: `readBodyCapped(response, { maxBytes, stopOn }) -> Promise<Uint8Array>`.
- Preserves: Pages route response payloads and cache headers.

- [ ] **Step 1: Write failing Pages redirect-policy tests**

```js
test('Pages public fetch blocks a redirect to loopback before the second fetch', async () => {
  const calls = [];
  await assert.rejects(fetchPublic('https://radio.example/live', {
    fetchImpl: async target => {
      calls.push(String(target));
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
    },
    forbiddenOrigins: ['https://earth-radio.pages.dev']
  }), /private stream hosts are blocked/);
  assert.deepEqual(calls, ['https://radio.example/live']);
});

test('Pages public fetch blocks redirects to its own zone', async () => {
  await assert.rejects(fetchPublic('https://radio.example/live', {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://earth-radio.pages.dev/api/nowplaying' } }),
    forbiddenOrigins: ['https://earth-radio.pages.dev']
  }), /same-zone targets are blocked/);
});
```

Include literal cases for `localhost`, `127.1`, `0x7f000001`, `[::1]`, `[::ffff:127.0.0.1]`, userinfo, `.local`, `.internal`, `file:`, and a public relative redirect.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/pages-functions.test.mjs`

Expected: module-not-found for `functions/_shared/public-fetch.js` and existing handlers follow the private redirect.

- [ ] **Step 3: Implement manual redirect validation**

Implement `fetchPublic` with `redirect: 'manual'`, an absolute deadline, a visited set, four-hop maximum, and validation before every `fetchImpl` call. Normalize hostnames through `new URL()` before applying private/loopback/reserved checks; reject credentials and same-origin targets listed by the route handler. Fail closed for alternate IPv4 forms and the same reserved/documentation networks covered by the Node boundary.

Both Pages handlers pass `forbiddenOrigins: [new URL(request.url).origin]`. Replace every radio-controlled `fetch(..., { redirect: 'follow' })` with `fetchPublic`. Fixed ACRCloud, AudD, and iTunes provider destinations retain their existing provider-specific timeouts.

- [ ] **Step 4: Add strict-public configuration and repository validation**

Create:

```json
{
  "name": "earth-radio",
  "pages_build_output_dir": "./site",
  "compatibility_date": "2026-08-25",
  "compatibility_flags": ["global_fetch_strictly_public"]
}
```

Make `validate-repository.mjs` parse the file and reject a missing `global_fetch_strictly_public` flag or any `global_fetch_private_origin` flag. Remove the per-isolate `rateBuckets` limiter from the fingerprint Function so production policy has one durable source of truth. Document the production WAF rules exactly: 30 requests/minute/IP for `/api/nowplaying`, 6 requests/minute/IP for `/api/track/fingerprint`, 60-second mitigation timeout, and HTTP 429.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/pages-functions.test.mjs tests/validate-repository.test.mjs && node scripts/validate-repository.mjs`

Expected: private/same-zone redirect cases fail closed; public redirects work; config validation passes.

- [ ] **Step 6: Commit**

```bash
git add functions/_shared/public-fetch.js functions/api/nowplaying.js functions/api/track/fingerprint.js wrangler.jsonc docs/CLOUDFLARE_DEPLOYMENT.md tests/pages-functions.test.mjs tests/validate-repository.test.mjs scripts/validate-repository.mjs
git commit -m "fix(pages): enforce public redirect boundary"
```

---

### Task 3: Pages HLS sampling, country cache identity, and resolver deadline

**Files:**
- Modify: `functions/api/track/fingerprint.js:30-155`
- Modify: `functions/api/nowplaying.js:21-140`
- Modify: `functions/_shared/public-fetch.js`
- Modify: `tests/pages-functions.test.mjs`

**Interfaces:**
- Produces: `normalizeCountry(value) -> /^[A-Z]{2}$/ country or 'US'`.
- Produces: `sampleStream(streamUrl, { deadlineAt }) -> Promise<Uint8Array>` with HLS support.
- Produces: `resolveNowPlaying(streamUrl, { deadlineAt })` sharing one overall budget.

- [ ] **Step 1: Write failing HLS, cache, and deadline regressions**

Add a complete master-playlist fixture whose variant and final segment URLs are distinct. The global fetch double returns full `Response` objects for the playlist, media playlist, segment, AudD, and iTunes calls. Assert that fingerprinting receives at least 16 KiB and returns `found: true` instead of `unsupported content-type`.

Add a real cache fake implementing `match` and `put`, call the route for the same stream with `country=US` and `country=KR`, and assert two distinct stored request URLs and two country-specific catalog results.

Add a deadline test where both generic status probes consume their allotted slice but the ICY response still returns `IU - Blueming` before the browser's 12-second client budget.

- [ ] **Step 2: Run and verify RED**

Run: `node --test --test-name-pattern="HLS|country cache|shared resolver deadline" tests/pages-functions.test.mjs`

Expected: HLS reports unsupported content type, the cache has one entry, and ICY is never reached within the intended budget.

- [ ] **Step 3: Implement HLS sampling and cache identity**

Normalize the country before cache lookup:

```js
export function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'US';
}

const country = normalizeCountry(url.searchParams.get('country'));
const cacheKey = new Request(`https://cache.invalid/fingerprint?u=${encodeURIComponent(streamUrl)}&c=${country}`);
```

Use `fetchPublic` for the stream. If the URL ends in `.m3u8` or the content type contains `mpegurl`, parse the playlist, follow one deterministic master variant, take the last three media segments, and fetch each through `fetchPublic` using the original absolute deadline. Concatenate no more than `MAX_SAMPLE_BYTES`.

- [ ] **Step 4: Implement a shared now-playing deadline**

Set `deadlineAt = Date.now() + 11_000` in the route. Pass it to every platform and ICY request. Run Icecast and Shoutcast generic probes with `Promise.allSettled`, each capped by the remaining platform slice, then reserve at least 4,000 ms for ICY. Never create a fresh full timeout after the deadline has been established.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/pages-functions.test.mjs`

Expected: all original and new Pages tests pass; HLS requests show manual redirects and bounded segment count.

- [ ] **Step 6: Commit**

```bash
git add functions/api/track/fingerprint.js functions/api/nowplaying.js functions/_shared/public-fetch.js tests/pages-functions.test.mjs
git commit -m "fix(metadata): support bounded Pages HLS sampling"
```

---

### Task 4: Preserve selected stream identity through MediaSource playback

**Files:**
- Modify: `src-recovered/main.ts:346-360`
- Modify: `site/assets/index-B4rKOAHV.js` at the corresponding installed-runtime selection block
- Modify: `site/assets/metadata-enrichment.js:45-62,710-714,1291-1328`
- Modify: `tests/e2e/web-nowplaying.spec.mjs`
- Modify: `tests/live-metadata.test.mjs`
- Modify: `docs/provenance/hardening-overlays.json`

**Interfaces:**
- Produces browser event: `earthradio:station-selected`, detail `{ streamUrl: string, stationUuid: string }`.
- Consumes event in metadata overlay and stores `state.selectedStreamUrl`.
- Preserves fallback to a non-blob `audio.currentSrc`.

- [ ] **Step 1: Write the failing blob-playback regression**

In the Playwright fixture, select an HLS station, set the audio element's active source to a `blob:` URL, invoke fingerprinting, and assert the same-origin request contains the fixture's original `https://streams.example/hls/master.m3u8` URL.

Add a focused exported helper test:

```js
assert.equal(resolveStreamUrl({ currentSrc: 'blob:https://site.example/id', src: 'blob:https://site.example/id' }, 'https://streams.example/live.m3u8'), 'https://streams.example/live.m3u8');
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/live-metadata.test.mjs && npx playwright test tests/e2e/web-nowplaying.spec.mjs --config tests/e2e/playwright.config.mjs`

Expected: fingerprint action is disabled or omits the original HLS URL.

- [ ] **Step 3: Implement the explicit station-selection event**

After successful `playStation(station)`, dispatch:

```js
window.dispatchEvent(new CustomEvent('earthradio:station-selected', {
  detail: {
    streamUrl: String(station.url_resolved || station.url || ''),
    stationUuid: String(station.stationuuid || '')
  }
}));
```

Mirror the exact additive change in the installed runtime bundle and record its new byte count/hash in the provenance overlay. In `metadata-enrichment.js`, listen for the event, validate the URL as HTTP(S), store it, invalidate prior in-flight identity state, and make `currentStreamUrl()` prefer the selected URL whenever `currentSrc` is non-HTTP(S).

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/live-metadata.test.mjs && npx playwright test tests/e2e/web-nowplaying.spec.mjs --config tests/e2e/playwright.config.mjs`

Expected: blob playback polls and fingerprints the original HLS URL; switching stations invalidates the old URL.

- [ ] **Step 5: Commit**

```bash
git add src-recovered/main.ts site/assets/index-B4rKOAHV.js site/assets/metadata-enrichment.js tests/e2e/web-nowplaying.spec.mjs tests/live-metadata.test.mjs docs/provenance/hardening-overlays.json
git commit -m "fix(metadata): retain HLS station source identity"
```

---

### Task 5: Make storage recovery generation-aware

**Files:**
- Modify: `site/assets/storage-guard.js`
- Modify: `tests/e2e/reliability.spec.mjs`
- Create: `tests/storage-guard.test.mjs`
- Modify: `package.json` test script
- Modify: `site/sw.js` cache generation

**Interfaces:**
- Produces: primary key `earth-radio-storage-generation-v2` in IndexedDB `kv`.
- Produces: backup envelope `{ v: 2, generation, savedAt, checksum, payload }`.
- Produces exported pure decision: `shouldRestore({ primaryGeneration, backup, restoreAttempts })`.
- Preserves: two backup generations and maximum two reload attempts.

- [ ] **Step 1: Write failing intentional-empty and loss tests**

```js
test('valid primary generation makes intentional empty data authoritative', () => {
  assert.equal(shouldRestore({
    primaryGeneration: 'g-7',
    backup: { generation: 'g-6', data: { favorites: { old: {} } } },
    restoreAttempts: 0
  }), false);
});

test('missing primary generation restores a valid substantive backup', () => {
  assert.equal(shouldRestore({
    primaryGeneration: '',
    backup: { generation: 'g-6', data: { favorites: { saved: {} } } },
    restoreAttempts: 0
  }), true);
});
```

Add Playwright coverage that favorites are snapshotted, the last favorite is intentionally removed, the page reloads before the 20-second interval, and the favorite remains absent. Keep the existing accidental-loss scenario, but delete the primary generation marker with the records to model actual eviction.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/storage-guard.test.mjs && npx playwright test tests/e2e/reliability.spec.mjs --config tests/e2e/playwright.config.mjs`

Expected: import/export failure for `shouldRestore`; intentional empty state resurrects the old favorite.

- [ ] **Step 3: Implement the v2 generation protocol**

On startup, read user records and the primary generation in one readonly transaction. If a valid primary generation exists, never restore based on data contents. If it is missing and a valid v2 or backward-compatible v1 substantive backup exists, restore all records plus the backup generation in one `readwrite` transaction. After a healthy boot, snapshot current records to a v2 backup, rotate the previous valid backup, then write a newly generated marker to IndexedDB. A marker remains present when the user intentionally writes empty collections, so stale backup contents cannot be resurrected.

Export only the pure checksum/envelope/decision helpers; keep database handles and reload behavior private. Bump the service-worker cache name because the mutable recovery overlay must be refreshed after deployment.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/storage-guard.test.mjs && npx playwright test tests/e2e/reliability.spec.mjs --config tests/e2e/playwright.config.mjs`

Expected: intentional deletion remains deleted, simulated eviction restores, corrupt checksums do not restore, and reload attempts remain capped.

- [ ] **Step 5: Commit**

```bash
git add site/assets/storage-guard.js site/sw.js tests/storage-guard.test.mjs tests/e2e/reliability.spec.mjs package.json
git commit -m "fix(storage): distinguish deletion from primary loss"
```

---

### Task 6: Keep locale previews coherent

**Files:**
- Modify: `site/assets/responsive-ui.js:373-495,1374-1379`
- Modify: `tests/browser/scenarios.mjs`
- Modify: `tests/browser/harness-main.mjs`
- Modify: `tests/rendered-ui.test.mjs`

**Interfaces:**
- Produces: module-local `previewLocale` and `effectiveLocale()`.
- Preserves: persisted state only on Save; closing/canceling reverts to persisted locale.

- [ ] **Step 1: Add the failing Arabic preview scenario**

Add a rendered-harness action that opens Settings, changes locale to Arabic without saving, waits through the locale MutationObserver, and records `lang`, `dir`, and `data-font-profile`. Assert literals `ar`, `rtl`, and `ar`. Add a cancel scenario asserting the saved locale returns.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/rendered-ui.test.mjs`

Expected: translated text is Arabic while `lang`, `dir`, or font profile reverts to the stored locale.

- [ ] **Step 3: Implement effective preview locale**

Add:

```js
let previewLocale = null;
function effectiveLocale() {
  return previewLocale || normalizeLocale(loadUiState().locale);
}
```

When the select changes, set `previewLocale` before applying localization. Make `guardDocumentLocale()` use `effectiveLocale()`. On Save, persist the selected locale, clear `previewLocale`, and apply the persisted value. When the modal becomes hidden without Save, clear `previewLocale`, reset the select, and apply the stored locale.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/rendered-ui.test.mjs tests/responsive-ui.test.mjs`

```bash
git add site/assets/responsive-ui.js tests/browser/scenarios.mjs tests/browser/harness-main.mjs tests/rendered-ui.test.mjs
git commit -m "fix(i18n): preserve locale preview state"
```

---

### Task 7: Unify country selection and serialize directory refreshes

**Files:**
- Modify: `site/assets/responsive-ui.js:788-810,953-962,1052-1076`
- Modify: `site/assets/directory-expansion.js`
- Modify: `src-recovered/main.ts:481-533`
- Modify: `site/assets/index-B4rKOAHV.js` corresponding load block
- Modify: `tests/e2e/reliability.spec.mjs`
- Modify: `tests/browser/scenarios.mjs`
- Modify: `tests/rendered-ui.test.mjs`
- Modify: `docs/provenance/hardening-overlays.json`

**Interfaces:**
- Produces browser event: `earthradio:country-selected`, detail `{ country }`.
- Produces browser event: `earthradio:stations-load-settled`, detail `{ ok }` in a `finally` block.
- Produces: one expansion queue whose `refreshPromise` serializes runtime refreshes and coalesces pending country codes.

- [ ] **Step 1: Write failing keyboard and concurrency tests**

In the rendered harness, focus the country picker, choose Japan with ArrowDown/Enter, and assert that the expansion hook records `JP` without a pointer click.

In Playwright, start Japan expansion, immediately start Brazil expansion, delay the Japan response, and assert the terminal request/result contains both `JP` and `BR`; assert no two forced directory requests overlap.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/rendered-ui.test.mjs && npx playwright test tests/e2e/reliability.spec.mjs --config tests/e2e/playwright.config.mjs`

Expected: Enter selection does not expand; two refreshes overlap and the stale response wins.

- [ ] **Step 3: Implement semantic events and queue**

Dispatch `earthradio:country-selected` from `selectCountry()` for any non-empty country. Keep map-popup and classic checkbox inputs routed into the same `expandCountry()` function.

Dispatch `earthradio:stations-load-settled` from `loadStations()` in a `finally` block, then mirror and record the installed-bundle change. In directory expansion, add codes synchronously to config/persistence, enqueue one refresh, await the settled event, and if codes arrived while it ran, execute exactly one subsequent refresh from the latest `currentCodes()` snapshot. Do not use the old four-second busy timer.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/rendered-ui.test.mjs && npx playwright test tests/e2e/reliability.spec.mjs --config tests/e2e/playwright.config.mjs`

```bash
git add site/assets/responsive-ui.js site/assets/directory-expansion.js src-recovered/main.ts site/assets/index-B4rKOAHV.js tests/e2e/reliability.spec.mjs tests/browser/scenarios.mjs tests/rendered-ui.test.mjs docs/provenance/hardening-overlays.json
git commit -m "fix(directory): serialize semantic country expansion"
```

---

### Task 8: Release metadata, full verification, external edge controls, and review closure

**Files:**
- Modify: `docs/LIVE_METADATA.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CLOUDFLARE_DEPLOYMENT.md`
- Modify: `RELEASE_MANIFEST.json`
- Modify: `sha256sums.txt`
- Modify: `.github/workflows/ci.yml` only if new focused tests are not already reached by `npm test`
- Modify: PR #6 review threads through GitHub API after verification

**Interfaces:**
- Consumes all prior task outputs.
- Produces final release/provenance hashes, CI evidence, security review, thread replies, and merge-readiness assessment.

- [ ] **Step 1: Update documentation and deterministic metadata**

Document the redirect/public-target boundary, HLS behavior, storage-generation semantics, semantic browser events, required strict-public flag, and exact WAF rules. Run repository-native manifest commands instead of hand-editing generated hashes:

```bash
npm run build:web
npm run release:manifest
```

- [ ] **Step 2: Run focused verification**

```bash
node --test tests/net-guard.test.mjs tests/live-metadata.test.mjs tests/pages-functions.test.mjs tests/storage-guard.test.mjs tests/rendered-ui.test.mjs
npx playwright test tests/e2e/reliability.spec.mjs tests/e2e/web-nowplaying.spec.mjs --config tests/e2e/playwright.config.mjs
```

Expected: zero failures and zero unexpected skips.

- [ ] **Step 3: Run complete local verification**

```bash
npm run check
npm test
npm run verify
npm run test:e2e
```

Expected: every command exits 0; the only permissible skip is an existing platform-specific skip explicitly documented by the test.

- [ ] **Step 4: Apply and validate Cloudflare edge controls**

Deploy/confirm `global_fetch_strictly_public` for production and preview. Configure WAF rate limits exactly as specified. Exercise each route from preview until the threshold is crossed; record HTTP 429 and Cloudflare evidence that WAF-denied requests did not invoke the Pages Function. If Cloudflare account access is unavailable, mark the PR blocked rather than merge-ready.

- [ ] **Step 5: Push and verify exact-head GitHub CI**

Wait for Ubuntu verify, Windows verify, and Playwright E2E jobs on the final SHA. Read job logs and record test/pass/fail/skip counts. Do not use an earlier green run.

- [ ] **Step 6: Request independent reviews**

Dispatch one clean-context code reviewer over base `e35c3dc1bd2655b04a55c8457af49058cff67dbd` through the final head, with the approved spec as requirements. Dispatch one clean-context security reviewer focused on URL-fetch source-to-sink paths, redirect representations, same-zone behavior, deadline/resource cleanup, WAF bypass, and cross-account backup restoration. Fix any Critical or Important result through a new red/green cycle and re-run all gates.

- [ ] **Step 7: Reply to and resolve all 14 GitHub threads**

Reply inside each original thread with the fixing commit, exact regression name, and final-head CI run. Resolve only after the reply is posted. Verify the unresolved-thread count is zero.

- [ ] **Step 8: Final merge-readiness check**

Confirm GitHub reports the PR mergeable, all required checks succeed at the exact head, unresolved review threads equal zero, and both independent reviews report no remaining Critical or Important issue. Report readiness to the user; do not merge without a separate explicit merge instruction.
