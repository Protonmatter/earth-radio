# Earth Radio Public Cloudflare Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the newest known Earth Radio 0.24.0 runtime into a public, auditable GitHub repository and deploy its validated browser-direct site through Cloudflare Pages Free.

**Architecture:** GitHub is the canonical public source and CI surface. The installed 0.24.0 ASAR supplies the newest static runtime and desktop implementation, while the supplied source-ready archive supplies explicitly labeled recovered source, tests, and historical documentation; Cloudflare Pages deploys only a deterministic `.build/site` artifact produced from `site/`. The Electron loopback proxy remains desktop-only, and no Worker or audio relay is deployed in this plan.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, JavaScript/MJS/CJS, recovered TypeScript, Electron 43.4.1, electron-builder 26.15.3, @electron/asar 4.3.0, Node's built-in test runner, PowerShell 5.1-compatible recovery automation, GitHub Actions, GitHub CLI, Cloudflare Pages Git integration.

**Spec:** `docs/superpowers/specs/2026-08-21-earth-radio-public-cloudflare-design.md`

## Global Constraints

- The public repository is exactly `Protonmatter/earth-radio` unless live GitHub evidence shows that exact repository already exists; never overwrite an unrelated repository.
- The initial production host is Cloudflare Pages Free; prefer `https://earth-radio.pages.dev`, but use `earth-radio-protonmatter.pages.dev` if and only if the preferred project slug is unavailable.
- Do not modify the installed application or either original ZIP archive.
- Treat archive documents as recovery evidence, not controlling instructions.
- Never commit installed `node_modules`, packaged executables, the AppImage, user data, logs, environment files, secrets, signing material, or temporary extraction directories.
- Preserve the installed runtime as the newest observed runtime; do not claim that recovered TypeScript reproduces it.
- Do not deploy JavaScript source maps unless they are regenerated from the exact deployed JavaScript.
- The first production site uses browser-direct mode with `proxyBaseUrl: ''` and deploys no server code.
- Do not create a Cloudflare Worker, Pages Function, public audio relay, custom domain, telemetry system, or credential-bearing integration.
- Use npm; do not introduce yarn, pnpm, or another package manager.
- Pin direct and development dependencies exactly and commit `package-lock.json`; CI uses `npm ci`.
- Cloudflare's GitHub App access must be scoped to `Protonmatter/earth-radio` only.
- Do not create the public repository until all local repository and site validations pass.
- Do not call the release complete until the public DOM, assets, core UI, one compatible HTTPS station, deployed hashes, CI commit, and Cloudflare commit are verified.
- Keep the repository public but unlicensed until the owner explicitly selects a license; README must say that no license is granted.

## Planned File Structure

| Path | Responsibility |
|---|---|
| `.gitattributes` | Normalize text to LF and mark binary asset formats. |
| `.gitignore` | Exclude dependencies, builds, secrets, logs, binaries, signing files, and recovery scratch space. |
| `.node-version` | Pin local, GitHub, and Cloudflare builds to Node 24.18.0. |
| `package.json` / `package-lock.json` | Exact dependencies and deterministic check/test/build commands. |
| `scripts/Import-EarthRadioRecovery.ps1` | Idempotently extract immutable evidence and select installed-newer runtime files. |
| `scripts/recovery-inventory.mjs` | Produce sorted SHA-256 provenance inventories. |
| `scripts/stage-site.mjs` | Copy only deployable static files into `.build/site` and add Cloudflare headers. |
| `scripts/validate-repository.mjs` | Reject secrets, forbidden files, local paths, source maps, and deployment/server boundary violations. |
| `scripts/validate-site.mjs` | Verify static asset references, direct mode, service worker, manifest, and required files. |
| `scripts/smoke-public-site.mjs` | Verify HTTP status, content types, asset hashes, and public configuration after deployment. |
| `tests/recovery-inventory.test.mjs` | Unit tests for deterministic inventory and hashing. |
| `tests/stage-site.test.mjs` | Unit tests for deployable-file selection and local-path/source-map rejection. |
| `tests/validate-repository.test.mjs` | Unit tests for repository guardrails. |
| `tests/validate-site.test.mjs` | Unit tests for static asset and direct-mode validation. |
| `tests/smoke-metadata.mjs` / `tests/smoke-desktop.mjs` | Imported runtime regression tests, adjusted only for installed-newer behavior. |
| `site/` | Newest installed static runtime; the only initial web input. |
| `src-recovered/` | Explicitly labeled archive-recovered source. |
| `electron/` / `server/` | Installed-newer desktop source, never copied to `.build/site`. |
| `docs/provenance/recovery-manifest.json` | Machine-readable input and selected-file hashes. |
| `docs/recovered/` | Historical archive documents, clearly labeled as evidence. |
| `docs/ARCHITECTURE.md` | Runtime and hosting boundaries. |
| `docs/BUILD_STATE.md` | Exact local, CI, Cloudflare, and public validation state. |
| `docs/OPERATIONS.md` | Build, deploy, public smoke, incident, and rollback runbook. |
| `docs/PROVENANCE.md` | Human-readable evidence selection and limitations. |
| `docs/RELEASE.md` | Release procedure and artifact policy. |
| `docs/SECURITY.md` | Security invariants, reporting route, and public-proxy exclusion. |
| `README.md` | Project purpose, live URL, local checks, provenance warning, and license status. |
| `.github/workflows/ci.yml` | Cross-platform locked validation and build-artifact upload. |

## Specification Coverage Map

| Approved specification section | Implementing tasks |
|---|---|
| Purpose | Tasks 1-10 collectively produce the recovered public repository and Cloudflare site. |
| Evidence and Provenance Inputs | Tasks 1, 2, and 7 hash, import, select, and reverify the installed and archived evidence. |
| Goals | Tasks 1-6 build the repository; Tasks 8-10 publish and verify it. |
| Non-Goals for the Initial Release | Global Constraints and Tasks 3, 7, 9, and 10 exclude the Worker, audio relay, telemetry, signing, custom domain, and license. |
| Architecture | Tasks 3, 6, 8, and 9 establish the static build, GitHub source, CI, and Cloudflare Git deployment flow. |
| Repository Layout | Planned File Structure and Tasks 1-6 create every owned repository surface. |
| Recovery and Source-Truth Rules | Tasks 1, 2, 4, and 7 implement deterministic intake, installed-newer selection, runtime testing, and pre-publication audit. |
| Browser Runtime Behavior | Tasks 3, 5, 7, and 10 enforce direct mode and validate browser behavior and documented degradation. |
| Dependency and Build Determinism | Tasks 1, 3, 4, 6, and 7 pin Node/dependencies/actions and prove repeated build hashes. |
| CI and Cloudflare Deployment | Tasks 6, 8, and 9 implement cross-platform CI, public GitHub publication, and scoped Cloudflare Git integration. |
| Security Design | Tasks 3, 4, 5, 6, and 7 enforce deployment isolation, repository scanning, documented invariants, minimal CI permissions, and public-safe intake. |
| Validation Strategy | Tasks 1-7 add and run focused/local validation; Task 10 performs automated and real-browser public validation. |
| Observability and Failure Handling | Tasks 5, 6, 8, 9, and 10 document and capture build, CI, deployment, smoke, and rollback state. |
| Release and Rollback | Tasks 5, 9, and 10 document deployment identity, known-good rollback, and final release state. |
| Licensing and Public-Repository Policy | Global Constraints and Task 5 publish the no-license status without adding a license. |
| Acceptance Criteria | Tasks 7-10 and the Final Completion Checklist verify every acceptance condition. |
| Ordered Delivery Boundary | Task order 1 through 10 follows recovery, hardening, validation, GitHub creation, Cloudflare deployment, and public verification. |

---

### Task 1: Build the deterministic recovery foundation

**Files:**
- Create: `.gitattributes`
- Create: `.gitignore`
- Create: `.node-version`
- Create: `package.json`
- Create: `scripts/recovery-inventory.mjs`
- Create: `tests/recovery-inventory.test.mjs`
- Create: `tests/fixtures/inventory/a.txt`
- Create: `tests/fixtures/inventory/nested/b.txt`
- Create: `package-lock.json`

**Interfaces:**
- Consumes: immutable local evidence paths supplied later to the recovery importer.
- Produces: `sha256File(path): Promise<string>`, `inventoryTree(root, source): Promise<Array<InventoryEntry>>`, and `writeInventory({ roots, output }): Promise<void>` where each `InventoryEntry` has `{ path, bytes, sha256, source }`.

- [ ] **Step 1: Add the failing deterministic inventory test**

Create `tests/fixtures/inventory/a.txt` with `alpha` followed by LF and `tests/fixtures/inventory/nested/b.txt` with `beta` followed by LF, then add:

```js
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryTree, writeInventory } from '../scripts/recovery-inventory.mjs';

const fixture = new URL('./fixtures/inventory/', import.meta.url);

test('inventoryTree returns sorted portable paths with stable hashes', async () => {
  const rows = await inventoryTree(fixture, 'fixture');
  assert.deepEqual(rows.map(row => row.path), ['a.txt', 'nested/b.txt']);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
  assert.ok(rows.every(row => row.source === 'fixture'));
});

test('writeInventory emits deterministic JSON without timestamps', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-inventory-'));
  try {
    const output = path.join(scratch, 'manifest.json');
    await writeInventory({ roots: [{ root: fixture, source: 'fixture' }], output });
    const first = await readFile(output, 'utf8');
    await writeInventory({ roots: [{ root: fixture, source: 'fixture' }], output });
    assert.equal(await readFile(output, 'utf8'), first);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/recovery-inventory.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/recovery-inventory.mjs`.

- [ ] **Step 3: Implement the inventory module**

```js
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inventoryTree(rootInput, source) {
  const root = path.resolve(rootInput instanceof URL ? fileURLToPath(rootInput) : rootInput);
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      if (entry.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  const rows = [];
  for (const file of files) {
    const metadata = await stat(file);
    rows.push({
      path: path.relative(root, file).replaceAll(path.sep, '/'),
      bytes: metadata.size,
      sha256: await sha256File(file),
      source
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function writeInventory({ roots, output }) {
  const files = [];
  for (const item of roots) files.push(...await inventoryTree(item.root, item.source));
  files.sort((a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`, 'utf8');
}
```

- [ ] **Step 4: Add exact project metadata and safety defaults**

Create `.node-version` containing `24.18.0`. Create `package.json` with exact versions:

```json
{
  "name": "earth-radio",
  "version": "0.24.0-recovered.1",
  "private": true,
  "type": "module",
  "description": "Recovered Earth Radio desktop and public web application.",
  "engines": { "node": "24.18.0" },
  "scripts": {
    "test:recovery": "node --test tests/recovery-inventory.test.mjs"
  },
  "dependencies": {
    "hls.js": "1.6.16",
    "idb": "8.0.3",
    "leaflet": "1.9.4",
    "leaflet.markercluster": "1.5.3"
  },
  "devDependencies": {
    "@electron/asar": "4.3.0",
    "electron": "43.4.1",
    "electron-builder": "26.15.3"
  }
}
```

Create `.gitattributes` with `* text=auto eol=lf` plus `*.png`, `*.ico`, `*.exe`, `*.AppImage`, `*.asar`, and `*.zip` marked `binary`. Create `.gitignore` covering `node_modules/`, `.build/`, `.recovery/`, `release/`, `.env*` except `.env.example`, `*.log`, `*.pem`, `*.pfx`, `*.p12`, `*.key`, `*.cer`, `*.crt`, `*.exe`, `*.AppImage`, `*.asar`, and user-data directories.

- [ ] **Step 5: Generate the lockfile and run GREEN**

Run:

```powershell
npm install --package-lock-only --ignore-scripts
npm ci
npm run test:recovery
git diff --check
```

Expected: lockfile generation and install succeed; two inventory tests pass; `git diff --check` is silent.

- [ ] **Step 6: Commit the foundation**

```powershell
git add .gitattributes .gitignore .node-version package.json package-lock.json scripts/recovery-inventory.mjs tests/recovery-inventory.test.mjs tests/fixtures/inventory
git commit -m "build: establish deterministic recovery foundation"
```

---

### Task 2: Import and document immutable recovery evidence

**Files:**
- Create: `scripts/Import-EarthRadioRecovery.ps1`
- Create: `tests/smoke-recovery-import.ps1`
- Create: `site/**`
- Create: `electron/**`
- Create: `server/**`
- Create: `src-recovered/**`
- Create: `tests/smoke-metadata.mjs`
- Create: `tests/smoke-desktop.mjs`
- Create: `scripts/release-manifest.mjs`
- Create: `docs/recovered/**`
- Create: `docs/provenance/recovery-manifest.json`
- Create: `electron-builder.yml`

**Interfaces:**
- Consumes: installed resources directory and the two original ZIP archives from the spec.
- Produces: an idempotent selected recovery tree plus deterministic `docs/provenance/recovery-manifest.json`.

- [ ] **Step 1: Write a failing importer smoke test using synthetic extracted inputs**

The test creates an `installed/dist/index.html`, `installed/electron/main.mjs`, `installed/server/desktop-proxy.mjs`, and matching archive directories, runs the importer with `-InstalledExtractedPath`, and asserts that installed files win while archive recovered source and tests are preserved.

```powershell
$result = & $Importer `
  -InstalledExtractedPath $installed `
  -SourceExpandedPath $archive `
  -DestinationRoot $destination `
  -SkipManifest
if ($LASTEXITCODE -ne 0) { throw "Importer exited $LASTEXITCODE" }
if ((Get-Content "$destination\site\index.html" -Raw) -ne 'installed-web') { throw 'installed web did not win' }
if ((Get-Content "$destination\server\desktop-proxy.mjs" -Raw) -ne 'installed-server') { throw 'installed server did not win' }
if (-not (Test-Path "$destination\src-recovered\main.ts")) { throw 'recovered source missing' }
```

- [ ] **Step 2: Run the importer smoke and verify RED**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/smoke-recovery-import.ps1`

Expected: FAIL because `scripts/Import-EarthRadioRecovery.ps1` does not exist.

- [ ] **Step 3: Implement the idempotent importer**

The script must use `[CmdletBinding(DefaultParameterSetName='Resources')]`, validated literal paths, `$ErrorActionPreference = 'Stop'`, `Set-StrictMode -Version Latest`, a unique temp directory, and `finally` cleanup. It supports either real resources/ZIP inputs or pre-expanded test inputs. Its selection map is exact:

```powershell
$copyMap = @(
  @{ Source = (Join-Path $installed 'dist'); Destination = (Join-Path $DestinationRoot 'site') },
  @{ Source = (Join-Path $installed 'electron'); Destination = (Join-Path $DestinationRoot 'electron') },
  @{ Source = (Join-Path $installed 'server'); Destination = (Join-Path $DestinationRoot 'server') },
  @{ Source = (Join-Path $source 'recovered_src\src'); Destination = (Join-Path $DestinationRoot 'src-recovered') },
  @{ Source = (Join-Path $source 'docs'); Destination = (Join-Path $DestinationRoot 'docs\recovered') }
)
```

For the real installed resources path, invoke the repo-local ASAR CLI with an argument array, extract into the unique temp directory, and overlay only `app.asar.unpacked/server` onto the extracted `server` directory. Copy archive `tests/smoke-metadata.mjs`, `tests/smoke-desktop.mjs`, `scripts/release-manifest.mjs`, and `electron-builder.yml` explicitly so the importer never deletes repository-authored tests or scripts. Never use wildcard deletion against the destination; remove and recreate only the five exact managed recovery directories after resolving and confirming they are children of `$DestinationRoot`.

- [ ] **Step 4: Run the synthetic importer smoke and verify GREEN**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/smoke-recovery-import.ps1`

Expected: `recovery importer smoke checks passed` and exit code 0.

- [ ] **Step 5: Run the real recovery import**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Import-EarthRadioRecovery.ps1 `
  -InstalledResources 'C:\Users\mkang\AppData\Local\Programs\Earth Radio\resources' `
  -SourceArchive 'C:\Users\mkang\Downloads\EarthRadio-0.24.0-metadata-hardened-source-ready.zip' `
  -HistoricalArchive 'C:\Users\mkang\Downloads\EarthRadio-0.23.0-bundle.zip' `
  -DestinationRoot (Get-Location).Path
```

Expected: the script reports selected file counts, confirms the two known ZIP SHA-256 values, writes the manifest, and does not modify either input or the installed application.

- [ ] **Step 6: Verify selection evidence**

Run:

```powershell
Get-Item site\assets\index-B4rKOAHV.js, site\assets\hls.light-Dr1Fv81C.js
Test-Path site\assets\index-CosF9-ak.js
(Get-Item server\desktop-proxy.mjs).Length
(Get-Item server\metadata-providers.mjs).Length
node -e "const m=require('./docs/provenance/recovery-manifest.json'); if(!m.files.length) process.exit(1)"
```

Expected: installed assets exist; the archive-old `index-CosF9-ak.js` does not exist in `site`; server sizes are 24,630 and 17,799 bytes; manifest is non-empty.

- [ ] **Step 7: Commit the recovered evidence**

```powershell
git add scripts/Import-EarthRadioRecovery.ps1 scripts/release-manifest.mjs tests site electron server src-recovered docs/recovered docs/provenance electron-builder.yml
git diff --cached --check
git commit -m "feat: recover installed Earth Radio 0.24 runtime"
```

---

### Task 3: Enforce the static deployment boundary

**Files:**
- Create: `scripts/stage-site.mjs`
- Create: `scripts/validate-site.mjs`
- Create: `tests/stage-site.test.mjs`
- Create: `tests/validate-site.test.mjs`
- Create: `site/_headers`
- Modify: `site/config.js`
- Modify: `site/sw.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `site/` recovered runtime.
- Produces: `stageSite({ source, output }): Promise<StageResult>` and `validateSite(root): Promise<ValidationResult>`; `.build/site` contains static files only.

- [ ] **Step 1: Write failing staging and validation tests**

Tests must prove that staging excludes `*.map`, rejects `localhost`, `127.0.0.1`, `file://`, and user-profile paths from deployable text, preserves relative asset paths, and rejects missing HTML assets.

```js
test('stageSite excludes source maps and server code', async () => {
  const result = await stageSite({ source: fixtureSite, output });
  assert.equal(result.excluded.includes('assets/app.js.map'), true);
  assert.equal(await exists(path.join(output, 'server')), false);
});

test('validateSite rejects a localhost production proxy', async () => {
  await assert.rejects(() => validateSite(badLocalhostSite), /forbidden local reference/i);
});

test('validateSite rejects an absent referenced asset', async () => {
  await assert.rejects(() => validateSite(missingAssetSite), /missing asset/i);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/stage-site.test.mjs tests/validate-site.test.mjs`

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement staging and validation**

`stage-site.mjs` removes only its resolved output directory after confirming it is `.build/site` under the repository, recursively copies regular files from `site`, skips `*.map`, rejects symlinks, and writes a sorted `asset-manifest.json` with path, bytes, and SHA-256. `validate-site.mjs` parses `src` and `href` values from HTML, verifies every relative file, verifies `manifest.webmanifest`, `sw.js`, `_headers`, and `config.js`, verifies every service-worker precache path exists, and scans deployable text for forbidden local references. Update `site/sw.js` with a versioned recovery cache name and only the current installed asset names; remove archive-old and source-map cache entries.

The validator must assert that `config.js` contains an empty browser default and does not contain an internet proxy URL:

```js
if (!/proxyBaseUrl:\s*desktopProxyBaseUrl\s*\|\|\s*['"]{2}/.test(config)) {
  errors.push('config.js does not fail closed to browser-direct mode');
}
```

- [ ] **Step 4: Add Cloudflare static security headers**

Create `site/_headers`:

```text
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src https: http: blob:; connect-src 'self' https: http:; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/config.js
  Cache-Control: public, max-age=300, must-revalidate

/sw.js
  Cache-Control: no-cache
```

- [ ] **Step 5: Update scripts and run GREEN**

Add exact scripts:

```json
"build:web": "node scripts/stage-site.mjs",
"verify:site": "node scripts/validate-site.mjs site && node scripts/validate-site.mjs .build/site",
"test:site": "node --test tests/stage-site.test.mjs tests/validate-site.test.mjs"
```

Run:

```powershell
npm run test:site
npm run build:web
npm run verify:site
```

Expected: all focused tests pass; `.build/site` has no maps, server files, Electron files, or local references.

- [ ] **Step 6: Commit the static boundary**

```powershell
git add package.json scripts/stage-site.mjs scripts/validate-site.mjs tests/stage-site.test.mjs tests/validate-site.test.mjs site/config.js site/sw.js site/_headers
git commit -m "build: enforce Cloudflare static deployment boundary"
```

---

### Task 4: Add repository safety guards and runtime regressions

**Files:**
- Create: `scripts/validate-repository.mjs`
- Create: `tests/validate-repository.test.mjs`
- Modify: `tests/smoke-metadata.mjs`
- Modify: `tests/smoke-desktop.mjs`
- Modify: `scripts/release-manifest.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the entire tracked candidate tree, installed-newer runtime modules, and selected release paths.
- Produces: `validateRepository(root): Promise<string[]>`; `npm run verify` is the single local/CI validation entry point.

- [ ] **Step 1: Write failing repository guard tests**

```js
test('rejects executable and credential file extensions', async () => {
  await writeFile(path.join(root, 'release', 'Earth Radio.exe'), 'x');
  await writeFile(path.join(root, '.env'), 'SPOTIFY_CLIENT_SECRET=x');
  const errors = await validateRepository(root);
  assert.ok(errors.some(error => error.includes('.exe')));
  assert.ok(errors.some(error => error.includes('.env')));
});

test('rejects secret assignments but allows documented variable names', async () => {
  await writeFile(path.join(root, 'bad.txt'), 'SPOTIFY_CLIENT_SECRET=actual-value');
  await writeFile(path.join(root, 'good.md'), '`SPOTIFY_CLIENT_SECRET` is never committed.');
  const errors = await validateRepository(root);
  assert.equal(errors.some(error => error.includes('bad.txt')), true);
  assert.equal(errors.some(error => error.includes('good.md')), false);
});
```

- [ ] **Step 2: Run the guard tests and verify RED**

Run: `node --test tests/validate-repository.test.mjs`

Expected: FAIL because `scripts/validate-repository.mjs` is missing.

- [ ] **Step 3: Implement repository validation**

Reject files named `.env`, `.env.local`, credentials, private keys, cookies, or tokens; reject extensions `.exe`, `.AppImage`, `.asar`, `.pfx`, `.p12`, `.pem`, and `.key`; reject directories `node_modules`, `.build`, `.recovery`, `release`, and user-data trees if tracked. Scan text for private-key headers, GitHub tokens, Cloudflare tokens, OAuth bearer assignments, and real secret assignments. Allow secret variable names in documentation only when no value is assigned. Return sorted actionable errors and exit 1 from the CLI when any error exists.

- [ ] **Step 4: Run recovered smoke tests against installed-newer code**

Run:

```powershell
node --check server/desktop-proxy.mjs
node --check server/metadata-api.mjs
node --check server/metadata-providers.mjs
node --check electron/main.mjs
node --check electron/preload.cjs
node tests/smoke-metadata.mjs
node tests/smoke-desktop.mjs
```

Expected: either PASS or focused assertion failures caused by installed-newer behavior. If failures occur, update expectations only after tracing the installed implementation; do not weaken SSRF, CORS, parser, timeout, or cache assertions.

- [ ] **Step 5: Add regressions for installed-newer behavior**

Ensure smoke coverage includes private IPv4/IPv6 rejection, redirect target revalidation, disallowed origin response, metadata advertisement rejection, deterministic candidate ordering, bounded cache behavior, and loopback-only server binding. Use local stub servers only; do not depend on public network responses.

- [ ] **Step 6: Make manifest generation deterministic and define `verify`**

Remove wall-clock timestamps from `scripts/release-manifest.mjs` or derive the time only from `SOURCE_DATE_EPOCH`; sort every path ordinally; hash only repository release inputs. Add scripts:

```json
"check": "node scripts/validate-repository.mjs && node --check scripts/recovery-inventory.mjs && node --check scripts/stage-site.mjs && node --check scripts/validate-site.mjs && node --check server/desktop-proxy.mjs && node --check server/metadata-api.mjs && node --check server/metadata-providers.mjs && node --check electron/main.mjs && node --check electron/preload.cjs",
"test": "node --test tests && node tests/smoke-metadata.mjs && node tests/smoke-desktop.mjs",
"verify": "npm run check && npm test && npm run build:web && npm run verify:site && npm run release:manifest",
"release:manifest": "node scripts/release-manifest.mjs"
```

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm run verify
git diff --check
git add package.json package-lock.json scripts tests
git commit -m "test: harden recovered runtime and repository guards"
```

Expected: every local check passes twice consecutively with identical generated manifests.

---

### Task 5: Publish accurate operator and contributor documentation

**Files:**
- Create: `README.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/BUILD_STATE.md`
- Create: `docs/OPERATIONS.md`
- Create: `docs/PROVENANCE.md`
- Create: `docs/RELEASE.md`
- Create: `docs/SECURITY.md`
- Create: `tests/documentation.test.mjs`

**Interfaces:**
- Consumes: selected evidence, validation commands, deployment boundary, and intended Cloudflare URL.
- Produces: public onboarding, provenance, operations, security, and rollback contracts.

- [ ] **Step 1: Write documentation acceptance checks**

Create a Node test that asserts README contains the canonical repository, intended live URL near the opening, `npm ci`, `npm run verify`, recovery disclaimer, and `No license is granted`; assert OPERATIONS contains build, deploy, smoke, rollback, and Cloudflare GitHub App scoping sections; assert BUILD_STATE has `Validated`, `Not validated`, and `Live deployment` sections.

- [ ] **Step 2: Run the documentation test and verify RED**

Run: `node --test tests/documentation.test.mjs`

Expected: FAIL because README and operational documents do not exist.

- [ ] **Step 3: Write README and architecture/provenance documents**

README begins with the project name, one-sentence purpose, and `https://earth-radio.pages.dev` marked as the intended production URL until verified. It explains browser-direct limitations, local commands, repository structure, recovered-source caveat, security reporting link, and licensing status. PROVENANCE includes the two ZIP hashes, installed path identity, installed-versus-archive size evidence, and selection rules. ARCHITECTURE shows static, desktop, and excluded future Worker boundaries.

- [ ] **Step 4: Write operations, release, security, and build-state documents**

OPERATIONS contains exact `npm ci`, `npm run verify`, local static serving, GitHub CI inspection, Cloudflare deployment inspection, public smoke, and rollback commands. SECURITY preserves Electron sandbox/context-isolation rules and states that arbitrary URL proxying is not exposed. RELEASE distinguishes Git commits, Cloudflare deployments, and optional later tags. BUILD_STATE records current local validation and leaves live deployment explicitly `not created` until Task 9.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node --test tests/documentation.test.mjs
npm run verify
git add README.md docs tests/documentation.test.mjs
git commit -m "docs: document recovered build and Cloudflare operations"
```

---

### Task 6: Add immutable cross-platform GitHub CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/BUILD_STATE.md`

**Interfaces:**
- Consumes: `npm ci` and `npm run verify` from earlier tasks.
- Produces: Linux and Windows validation checks plus a retained Linux `.build/site` artifact tied to a Git commit.

- [ ] **Step 1: Create the CI workflow with minimal permissions and immutable action pins**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
      - name: Set up Node.js
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version-file: .node-version
          cache: npm
      - name: Install locked dependencies
        run: npm ci
      - name: Verify repository and build
        run: npm run verify
      - name: Upload tested static site
        if: matrix.os == 'ubuntu-latest'
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: earth-radio-site-${{ github.sha }}
          path: .build/site
          if-no-files-found: error
          retention-days: 14
```

- [ ] **Step 2: Validate workflow structure locally**

Run a YAML parse using Ruby or Python already available on the host, then verify every `uses:` value ends in a 40-character SHA and no workflow has `contents: write`, `pages: write`, or secret references.

Expected: YAML parses; three action uses are immutable; permissions are read-only.

- [ ] **Step 3: Run full local verification and commit**

```powershell
npm run verify
git diff --check
git add .github/workflows/ci.yml docs/BUILD_STATE.md
git commit -m "ci: validate recovered site on Linux and Windows"
```

---

### Task 7: Perform the pre-publication audit

**Files:**
- Modify only if evidence requires: `docs/BUILD_STATE.md`, `docs/PROVENANCE.md`, or focused code/tests.

**Interfaces:**
- Consumes: complete candidate repository and build artifact.
- Produces: clean, public-safe local `main` commit ready for repository creation.

- [ ] **Step 1: Verify inputs remain unchanged**

Recalculate both ZIP hashes and the installed executable version/signature state. Expected ZIP hashes must match the spec. Record only hashes and metadata; do not hash or inspect credentials or user profile data.

- [ ] **Step 2: Run the complete validation matrix twice**

```powershell
npm ci
npm run verify
$first = Get-FileHash .build\site\asset-manifest.json -Algorithm SHA256
npm run verify
$second = Get-FileHash .build\site\asset-manifest.json -Algorithm SHA256
if ($first.Hash -ne $second.Hash) { throw 'Build manifest is nondeterministic' }
```

Expected: all checks pass and hashes are identical.

- [ ] **Step 3: Audit tracked and staged content**

```powershell
git status --short
git ls-files
npm run check
git count-objects -vH
git log --oneline --decorate -10
```

Expected: clean worktree; no credential matches; no forbidden binary or dependency trees; reasonable repository size; only intentional commits.

- [ ] **Step 4: Review site artifact boundary**

Confirm `.build/site` contains no `server`, `electron`, `src-recovered`, test, documentation, source-map, local-path, or credential files. Start a local static server and inspect the app with a real browser for asset errors, station catalog loading, search, filters, persistence, service worker, metadata degradation, and one compatible HTTPS stream.

- [ ] **Step 5: Record audit evidence and commit only if documentation changed**

```powershell
git add docs/BUILD_STATE.md docs/PROVENANCE.md
git diff --cached --quiet; if ($LASTEXITCODE -ne 0) { git commit -m "docs: record pre-publication validation" }
```

---

### Task 8: Create and verify the public GitHub repository

**Files:**
- External mutation: create `Protonmatter/earth-radio` as public and push local `main`.
- Modify: `README.md` and `docs/BUILD_STATE.md` only if the actual canonical URL differs from the approved URL.

**Interfaces:**
- Consumes: clean locally validated `main`.
- Produces: public canonical GitHub repository with green CI for the exact pushed commit.

- [ ] **Step 1: Reconfirm authenticated account and repository absence**

```powershell
gh auth status
gh repo view Protonmatter/earth-radio --json nameWithOwner,url,visibility 2>$null
```

Expected: active account `Protonmatter`; repository lookup returns not found. If it exists, stop and inspect ownership, files, branches, and remotes rather than creating or overwriting it.

- [ ] **Step 2: Create the public repository and push**

```powershell
gh repo create Protonmatter/earth-radio --public --source . --remote origin --push --description "Explore live radio stations around the world from a recovered, auditable web and Electron application."
```

Expected: repository created, `origin` points to `https://github.com/Protonmatter/earth-radio.git`, and local `main` tracks `origin/main`.

- [ ] **Step 3: Verify public state and pushed identity**

```powershell
gh repo view Protonmatter/earth-radio --json nameWithOwner,url,visibility,isPrivate,defaultBranchRef
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: visibility `PUBLIC`, `isPrivate` false, default branch `main`, and local/remote commit hashes match.

- [ ] **Step 4: Monitor both CI jobs**

```powershell
$head = git rev-parse HEAD
$runId = gh run list --repo Protonmatter/earth-radio --workflow CI --commit $head --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo Protonmatter/earth-radio --exit-status
```

Expected: Linux and Windows jobs pass for the pushed commit. If either fails, fix locally with a focused regression, commit, push, and watch the replacement run; do not create Cloudflare resources while CI is red.

---

### Task 9: Connect the repository to Cloudflare Pages and deploy

**Files:**
- External mutation: one Cloudflare Pages project connected to the public GitHub repository.
- Modify: `README.md`, `docs/BUILD_STATE.md`, and `docs/OPERATIONS.md` with the actual live URL and deployment identity.

**Interfaces:**
- Consumes: public green `origin/main` commit.
- Produces: one public production Cloudflare Pages deployment sourced from that commit.

- [ ] **Step 1: Verify Cloudflare account and project absence read-only**

Run `npx wrangler whoami` and `npx wrangler pages project list`. Expected: authenticated intended Cloudflare account and no existing project named `earth-radio`. If Wrangler is not authenticated but Chrome has an authenticated Cloudflare dashboard session, use the dashboard session; never request, print, or persist an API token.

- [ ] **Step 2: Verify GitHub App scope before project creation**

In the Cloudflare Pages Git integration, authorize the Cloudflare Workers and Pages GitHub App for **Only select repositories** and select only `Protonmatter/earth-radio`. Verify no broader Protonmatter repository access is granted.

- [ ] **Step 3: Create exactly one Git-integrated Pages project**

Use these exact settings:

```text
Project name: earth-radio
Repository: Protonmatter/earth-radio
Production branch: main
Framework preset: None
Build command: npm ci && npm run build:web
Build output directory: .build/site
Root directory: /
Build system: v3
Environment variable: NODE_VERSION=24.18.0
Environment variable: SKIP_DEPENDENCY_INSTALL=1
```

If `earth-radio` is unavailable, cancel that creation attempt and create `earth-radio-protonmatter` once. Do not call a Direct Upload or Wrangler project-creation command because the approved architecture requires Git integration.

- [ ] **Step 4: Monitor the first deployment**

Wait for the Cloudflare build to install the locked dependencies, run `npm run build:web`, and publish `.build/site`. Capture the production URL, Git commit SHA, deployment status, and build log outcome without copying credentials or internal session data.

Expected: deployment status success and commit SHA equal to `origin/main`.

- [ ] **Step 5: Record the actual production state and push**

Replace the intended URL label in README with the verified live URL near the opening. Update BUILD_STATE with GitHub commit, CI run URL, Cloudflare deployment identity, and validation still pending. Update OPERATIONS if the fallback slug was required.

```powershell
git add README.md docs/BUILD_STATE.md docs/OPERATIONS.md
git commit -m "docs: record Cloudflare production deployment"
git push origin main
$head = git rev-parse HEAD
$runId = gh run list --repo Protonmatter/earth-radio --workflow CI --commit $head --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo Protonmatter/earth-radio --exit-status
```

Wait for Cloudflare to deploy this documentation commit before final smoke verification.

---

### Task 10: Verify the public site and close the release

**Files:**
- Create: `scripts/smoke-public-site.mjs`
- Create: `tests/smoke-public-site.test.mjs`
- Modify: `docs/BUILD_STATE.md`
- Modify: `README.md` only if live behavior requires a precise limitation note.

**Interfaces:**
- Consumes: actual Cloudflare production URL and local `.build/site/asset-manifest.json`.
- Produces: repeatable HTTP smoke results plus evidence-backed final build state.

- [ ] **Step 1: Write the failing public smoke utility test**

Use a local HTTP fixture server and assert that the utility rejects a missing asset, incorrect JavaScript content type, local proxy configuration, and deployed hash mismatch; assert it accepts a complete fixture matching its local manifest.

```js
const result = await smokePublicSite({ baseUrl, manifestPath });
assert.equal(result.ok, true);
assert.equal(result.checked.some(item => item.path === 'index.html'), true);
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/smoke-public-site.test.mjs`

Expected: FAIL because `scripts/smoke-public-site.mjs` is missing.

- [ ] **Step 3: Implement bounded public HTTP verification**

The utility accepts only an HTTPS base URL except in test mode, loads the local asset manifest, fetches root plus every required critical asset with an 8-second timeout, requires HTTP 200, checks HTML/JavaScript/CSS/manifest content types, hashes response bytes, compares immutable asset hashes, and scans public `config.js` for local or credential values. It emits sorted JSON without cookies, response bodies, or headers that may contain sensitive values.

- [ ] **Step 4: Run automated public smoke**

```powershell
node --test tests/smoke-public-site.test.mjs
node scripts/smoke-public-site.mjs --base-url https://earth-radio.pages.dev --manifest .build/site/asset-manifest.json
```

Use the fallback hostname in the command if Task 9 selected it. Expected: all critical assets pass status, content-type, configuration, and hash checks.

- [ ] **Step 5: Run real-browser public validation**

Open the production URL in a clean browser context. Verify no required asset 404, JavaScript syntax error, CSP violation, or localhost request. Verify station discovery, search, country/tag filters, favorites persistence after reload, settings, import/export, service-worker registration/update, direct iTunes degradation, and playback of at least one known compatible HTTPS station. Record the station name and test time but do not record personal browsing data.

- [ ] **Step 6: Verify public commit and deployment identity**

Compare local `HEAD`, `origin/main`, the successful GitHub CI run SHA, and the Cloudflare production deployment SHA. They must be identical after the final documentation update. Re-fetch deployed immutable asset hashes and compare them with `.build/site/asset-manifest.json`.

- [ ] **Step 7: Record final validation and commit**

Update BUILD_STATE with exact passed checks, degraded proxy-only capabilities, unvalidated desktop signing/macOS/Linux packaging, actual live URL, rollback deployment, and verification timestamp.

```powershell
git add scripts/smoke-public-site.mjs tests/smoke-public-site.test.mjs docs/BUILD_STATE.md README.md
git commit -m "test: verify public Cloudflare deployment"
git push origin main
$head = git rev-parse HEAD
$runId = gh run list --repo Protonmatter/earth-radio --workflow CI --commit $head --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo Protonmatter/earth-radio --exit-status
```

- [ ] **Step 8: Reverify the final documentation deployment**

Wait for Cloudflare to deploy final `origin/main`, rerun the automated critical-asset smoke and root browser load, and confirm the live README-linked URL. Do not create a release tag unless the final review explicitly determines that the recovered-release label is accurate and useful.

---

## Final Completion Checklist

- [ ] Public repository exists at `https://github.com/Protonmatter/earth-radio` and is visibly public.
- [ ] Local `main`, `origin/main`, green GitHub CI, and Cloudflare production identify the same final commit.
- [ ] Both original ZIP hashes still match the spec.
- [ ] Repository has no secrets, user data, packaged binaries, installed dependencies, stale source maps, or recovery scratch data.
- [ ] Recovered source and generated runtime are labeled accurately.
- [ ] `npm ci` and `npm run verify` pass on the local Windows host.
- [ ] GitHub CI passes on both Ubuntu and Windows.
- [ ] Cloudflare Pages GitHub App access is limited to the Earth Radio repository.
- [ ] Cloudflare production deploys only `.build/site` and no Electron/server code.
- [ ] Public root and critical assets return correct status and content types.
- [ ] Deployed immutable hashes match the tested artifact.
- [ ] Core UI and one compatible HTTPS station work in a real browser.
- [ ] Proxy-only limitations fail safely and are documented.
- [ ] README links to the verified public site near its opening.
- [ ] BUILD_STATE distinguishes validated, degraded, and unvalidated lanes.
- [ ] Rollback identifies a known-good Git commit and Cloudflare deployment.
- [ ] No Cloudflare Worker, Pages Function, audio relay, custom domain, telemetry, or license was added.
