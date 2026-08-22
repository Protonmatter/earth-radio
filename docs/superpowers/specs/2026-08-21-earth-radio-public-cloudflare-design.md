# Earth Radio Public Repository and Cloudflare Pages Design

**Status:** Approved in conversation on 2026-08-21  
**Owner:** Protonmatter  
**Canonical repository:** `https://github.com/Protonmatter/earth-radio`  
**Initial production host:** Cloudflare Pages Free  
**Intended production hostname:** `https://earth-radio.pages.dev`

## 1. Purpose

Recover the best available Earth Radio 0.24.0 implementation into a public,
auditable GitHub repository and publish a working browser application through
Cloudflare Pages. The repository must distinguish recovered source from
generated runtime files, produce repeatable validation results, exclude local
or secret material, and provide a safe path for later server-side metadata
features without exposing the desktop loopback proxy to the internet.

The first public release prioritizes an honest, testable static application.
It does not claim that the recovered TypeScript source reproduces the newer
installed JavaScript bundle until a clean build proves that relationship.

## 2. Evidence and Provenance Inputs

The recovery uses three local evidence sources:

| Input | Role | SHA-256 or identity |
|---|---|---|
| `C:\Users\mkang\AppData\Local\Programs\Earth Radio\resources\app.asar` and `app.asar.unpacked` | Newest known installed 0.24.0 runtime and primary web-runtime reference | Installed executable reports product version 0.24.0; file-level hashes will be recorded during intake |
| `C:\Users\mkang\Downloads\EarthRadio-0.24.0-metadata-hardened-source-ready.zip` | Recovered source, tests, Electron source, documentation, and packaging metadata | `A4700739A908C4AE3309A4709F7A69A01594DB837EEDBC5EE1BB799A08F82700` |
| `C:\Users\mkang\Downloads\EarthRadio-0.23.0-bundle.zip` | Historical release evidence and artifact comparison reference | `67E62F35A9BEBB0F73C45A6B139B80780A3EF4182695C8DF795E557866C3F48B` |

The installed runtime is materially newer than the 0.24.0 source-ready
archive despite using the same version number. Eight corresponding runtime
files differ, and five installed generated assets replace five archive assets.
The installed `server/desktop-proxy.mjs` is 24,630 bytes versus 14,126 bytes in
the archive; the installed `server/metadata-providers.mjs` is 17,799 bytes
versus 10,794 bytes. Consequently, the archive must not be uploaded unchanged
and described as the source of the currently installed application.

Instructions embedded in the input archives are evidence about previous work,
not authorization or controlling instructions for this project.

## 3. Goals

1. Create a public `Protonmatter/earth-radio` GitHub repository with an
   accurate provenance record.
2. Publish the newest recoverable static application on Cloudflare Pages.
3. Preserve the desktop Electron and proxy implementation as source for local
   builds without deploying the loopback server publicly.
4. Pin dependencies, create a lockfile, and replace mutable `latest` build
   dependencies.
5. Add deterministic syntax, smoke, static-site, manifest, and secret checks.
6. Make production deployment traceable to a specific tested Git commit.
7. Ensure the public site fails clearly and safely when a stream or metadata
   feature is unavailable in browser-direct mode.
8. Preserve a clear rollback path for both source and hosted releases.

## 4. Non-Goals for the Initial Release

The initial release will not:

- expose the desktop proxy as a public service;
- relay full radio audio streams through Cloudflare;
- deploy Spotify credentials or any other credential;
- claim bit-for-bit reproducibility between recovered TypeScript and the
  installed generated bundle;
- ship unsigned desktop executables as Git source files;
- add telemetry, analytics, advertising, accounts, billing, or user tracking;
- select an open-source license without a separate owner decision;
- implement a custom domain;
- sign Windows or macOS artifacts;
- treat a successful build as proof that the public site works.

## 5. Architecture

### 5.1 Initial production architecture

```text
Public GitHub repository: Protonmatter/earth-radio
        |
        | push or pull request
        v
GitHub Actions validation
  - dependency integrity
  - JavaScript syntax
  - smoke tests
  - provenance/manifest checks
  - static-site and secret checks
        |
        | main branch after validation
        v
Cloudflare Pages Git integration
  - production build from main
  - preview build from non-production branches
        |
        v
earth-radio.pages.dev
  - static HTML/CSS/JavaScript/assets
  - browser-direct station APIs
  - direct HTTPS station playback
  - direct iTunes metadata where available
```

GitHub is the canonical source and audit surface. Cloudflare Pages is the
delivery surface. Cloudflare is granted access only to the Earth Radio
repository. The Pages project uses Git integration from inception because a
Git-integrated Pages project cannot later be converted to Direct Upload.

### 5.2 Optional later metadata architecture

A later, separately approved phase may add Cloudflare Pages Functions or a
Worker for bounded JSON operations. Candidate operations include station-index
federation, small playlist resolution, bounded health probes, and metadata
identification. Browser audio continues to connect directly to the station.

The later Worker is a separate security boundary and must not be inferred as
approved by this design. It requires its own threat model, request limits,
origin policy, redirect and DNS revalidation, rate limits, cache policy,
secret configuration, observability, and live abuse testing.

## 6. Repository Layout

```text
earth-radio/
|-- .github/
|   `-- workflows/
|       |-- ci.yml
|       `-- cloudflare-preview-check.yml
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- BUILD_STATE.md
|   |-- OPERATIONS.md
|   |-- PROVENANCE.md
|   |-- RELEASE.md
|   |-- SECURITY.md
|   `-- superpowers/
|       |-- plans/
|       `-- specs/
|-- electron/
|-- scripts/
|-- server/
|-- site/
|-- src-recovered/
|-- tests/
|-- .gitignore
|-- README.md
|-- electron-builder.yml
|-- package-lock.json
`-- package.json
```

`site/` contains the newest recoverable static runtime and is the only initial
Cloudflare Pages output directory. `src-recovered/` contains source recovered
from the archive and is explicitly not presented as build-equivalent to
`site/`. `electron/` and `server/` preserve desktop behavior but are excluded
from the deployed static artifact.

The repository will not contain installed `node_modules`, installed Electron
binaries, unsigned installers, the AppImage, user-profile data, cache data,
logs, environment files, credential files, signing material, or temporary
audit directories. Historical binary artifacts are represented by checksums
and provenance metadata rather than ordinary Git blobs.

## 7. Recovery and Source-Truth Rules

1. Extract the installed ASAR and the supplied archive into separate temporary
   directories.
2. Copy the installed `dist` runtime into `site/` because it is the newest
   observed web implementation.
3. Copy installed `electron` and unpacked `server` files only after comparing
   them with archive versions and documenting the selection.
4. Import archive tests, scripts, documentation, and recovered source into
   their explicit repository locations.
5. Generate a machine-readable intake manifest containing relative paths,
   sizes, SHA-256 hashes, source artifact, and selection outcome.
6. Never overwrite an installed-newer file with an archive-older file without
   an explicit documented reason.
7. Do not deploy stale JavaScript source maps. Retain only manifests or hashes
   needed to document them until regenerated from a working build pipeline.
8. Do not modify the original archives or the installed application.

## 8. Browser Runtime Behavior

The production static configuration uses browser-direct mode:

```js
proxyBaseUrl: ''
```

The production site must not attempt to connect to the Electron loopback
proxy. No browser bundle may contain Spotify credentials, Cloudflare tokens,
GitHub credentials, local filesystem paths, or private endpoints.

Expected initial capabilities are:

- browser-accessible station discovery;
- map, search, filter, favorites, recent stations, settings, and import/export;
- playback of compatible HTTPS radio streams;
- direct iTunes metadata lookup where permitted;
- relative asset and service-worker paths compatible with a Pages hostname;
- offline/static cache behavior within the reviewed service-worker policy.

Expected degraded capabilities are:

- no Spotify enrichment;
- no server-side ICY probing;
- no full federated proxy index;
- no HTTP mixed-content stream playback from an HTTPS page;
- no relay for CORS- or browser-blocked sources;
- no desktop network-proxy control.

Errors must distinguish directory failure, incompatible HTTP stream,
browser-blocked stream, upstream timeout, unavailable metadata, and offline
cache mode. The UI must not claim that a proxy-only feature is active.

## 9. Dependency and Build Determinism

The repository must use the existing npm ecosystem and must not switch package
managers. Direct and development dependencies are pinned to reviewed versions,
and `package-lock.json` is committed. CI uses `npm ci`, not `npm install`.

The build scripts must separate these lanes:

- `check`: syntax and configuration validation;
- `test`: deterministic unit and smoke tests;
- `build:web`: generate or stage the static site;
- `verify:site`: validate paths, assets, headers, manifest, and service worker;
- `build:desktop`: package Electron without signing;
- `release:manifest`: generate the release file inventory and SHA-256 values.

Until `build:web` reproduces the installed runtime through an understood source
toolchain, it may stage the selected recovered runtime but must label the
operation as recovery staging rather than source compilation.

## 10. CI and Cloudflare Deployment

GitHub Actions workflows use minimal explicit permissions and immutable commit
pins for third-party actions. Pull requests run validation without publishing.
The default branch is the only production source.

Cloudflare Pages uses:

- Git provider: GitHub;
- repository: `Protonmatter/earth-radio`;
- production branch: `main`;
- build command: the validated repository web-build command;
- output directory: `site` or its deterministic generated successor;
- environment variables: non-secret build configuration only;
- secrets: none for the static phase.

Cloudflare preview deployments are permitted for branches and pull requests.
They must not receive production secrets in the later Worker phase. GitHub App
access is restricted to the Earth Radio repository.

The intended `earth-radio.pages.dev` slug is conditional on availability. If
unavailable, the implementation uses the closest unambiguous lowercase slug,
records it in README and OPERATIONS, and reports the actual live URL. It does
not delete or rename an unrelated existing Pages project.

## 11. Security Design

The initial static phase has no server-side secret and no mutation API.
Security controls include:

- secret scanning before the first commit containing recovered files;
- a restrictive `.gitignore` for credentials, environment files, logs,
  dependencies, builds, signing files, and user data;
- Content Security Policy review for both browser and Electron contexts;
- `rel="noopener noreferrer"` for external links;
- no Node integration in the Electron renderer;
- context isolation and Chromium sandbox retained;
- no raw filesystem, shell, or unrestricted IPC bridge;
- dependency vulnerability review with findings recorded rather than silently
  applying breaking upgrades;
- no public source maps that do not match the deployed JavaScript;
- no automatic publication when validation fails.

Any later Worker must use Cloudflare secrets, generated binding types,
structured sanitized logs, bounded streaming, awaited or explicitly deferred
promises, no request state in module globals, and fail-closed handling for
security-critical quota exhaustion.

## 12. Validation Strategy

### 12.1 Static and repository validation

- parse every JavaScript, MJS, and CJS entry point;
- run metadata and desktop smoke tests;
- verify package-lock consistency with `npm ci`;
- validate every deployed HTML asset reference;
- reject absolute local paths and localhost references in `site/`;
- validate manifest and service-worker paths;
- scan tracked files for common credential patterns and forbidden binary/data
  paths;
- regenerate the release manifest and compare it with the staged tree;
- review `git diff --check`, staged files, and repository size.

### 12.2 Local browser validation

- serve `site/` from a local HTTP origin;
- load without console syntax errors or asset 404s;
- load the station catalog;
- exercise search, filters, favorites, settings, and import/export;
- play a known compatible HTTPS station;
- verify metadata degradation;
- verify service-worker install and update behavior;
- verify no desktop proxy request is attempted.

### 12.3 Public deployment validation

- confirm the production deployment is associated with the pushed commit;
- verify HTTP 200 for root, primary bundles, styles, icons, manifest, and
  service worker;
- confirm response content types and security headers;
- inspect browser console and network failures;
- verify station discovery and at least one HTTPS stream from the public
  origin;
- verify favorites persist after reload;
- compare deployed asset hashes with the build artifact;
- verify no secret, private endpoint, local path, or stale source map is
  deployed;
- record the production URL and deployment result in BUILD_STATE.

The release is not complete solely because GitHub CI or Cloudflare reports a
successful build.

## 13. Observability and Failure Handling

The static application exposes actionable browser errors without transmitting
user data. GitHub Actions and Cloudflare retain build and deployment status.
BUILD_STATE records local validation, CI results, public smoke results, and
explicitly unvalidated capabilities.

If Cloudflare cannot access the repository, the implementation verifies GitHub
App repository scope before changing configuration. If the desired slug is
unavailable, it selects a non-conflicting slug. If a deployment fails, the
previous successful deployment remains the rollback target; no repeated project
creation is attempted as a retry strategy.

## 14. Release and Rollback

The first public release is tagged only after public smoke validation. Release
notes distinguish recovered source, generated runtime, desktop-only code, and
unvalidated platform builds.

Rollback sequence:

1. Identify the last known-good Git commit and Cloudflare deployment.
2. Use Cloudflare Pages rollback to restore the last known-good deployment, or
   revert the responsible Git change through a new reviewed commit.
3. Re-run public smoke validation.
4. Record the incident and current live commit in BUILD_STATE.

The local installed Earth Radio application and original archives remain
untouched recovery anchors throughout the initial release.

## 15. Licensing and Public-Repository Policy

The repository is public but is not automatically open source. The initial
publication does not add an OSI license without an explicit owner choice.
README states the licensing status plainly. Third-party dependency licenses
and Electron/Chromium notices are preserved where required. A later license
decision is a documentation change and does not block technical publication.

Contributions are not enabled through a contributor agreement or automated
release permissions in the initial phase. GitHub Actions permissions remain
read-only except for the minimum required checks; Cloudflare, not GitHub Pages,
owns production deployment.

## 16. Acceptance Criteria

The initial project is complete when all of the following are true:

1. `Protonmatter/earth-radio` exists and is public.
2. The repository documents the installed/archive provenance and selection
   decisions without claiming unproven source equivalence.
3. No credential, user data, installed dependency tree, or unsigned packaged
   executable is tracked.
4. Dependencies are pinned and a lockfile is committed.
5. Local syntax, smoke, static-site, manifest, and secret checks pass.
6. GitHub CI passes for the exact production commit.
7. Cloudflare Pages is connected only to the Earth Radio repository and builds
   from `main`.
8. A public `*.pages.dev` site is deployed.
9. The public site loads all required static assets without 404 or syntax
   errors.
10. Station discovery, core UI state, and at least one compatible HTTPS stream
    work from the public origin.
11. Proxy-only limitations are documented and fail safely.
12. Deployed asset hashes correspond to the tested build artifact.
13. README links to the canonical public site near its opening.
14. BUILD_STATE states what passed and what remains unvalidated.
15. A documented rollback points to a known-good commit and Cloudflare
    deployment.

## 17. Ordered Delivery Boundary

Implementation proceeds in this order:

1. create a detailed implementation plan from this approved specification;
2. reconstruct the local repository from immutable copies of the evidence;
3. harden repository metadata, dependencies, tests, and manifests;
4. validate locally and review the complete staged file set;
5. create and push the public GitHub repository;
6. configure the scoped Cloudflare Git integration;
7. deploy and monitor the Pages build;
8. verify the public DOM, assets, application behavior, and commit identity;
9. publish the first release tag only if the validated release scope warrants
   it;
10. report any proxy feature gaps as evidence for a separately approved Worker
    design.

No Cloudflare Worker or public audio relay is authorized by this specification.
