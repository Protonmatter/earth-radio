# Earth Radio 0.24.0 Desktop Rebuild and Signing Instructions

## Goal

This release wires the confidence-scored metadata enrichment system into the desktop build through a loopback Electron proxy.

The desktop renderer now reads a synchronous `window.earthRadio.proxyBaseUrl` from the preload bridge before `dist/config.js` initializes. That makes the app boot directly into local proxy mode instead of briefly starting in direct Radio Browser mode.

## Included implementation

```text
electron/main.mjs
electron/preload.cjs
server/desktop-proxy.mjs
server/metadata-api.mjs
server/metadata-providers.mjs
dist/assets/metadata-enrichment.js
dist/assets/metadata-enrichment.css
dist/config.js
```

## Local run

```bash
npm install
npm run smoke
npm run electron:dev
```

Optional Spotify enrichment:

```bash
SPOTIFY_CLIENT_ID=<client-id> \
SPOTIFY_CLIENT_SECRET=<client-secret> \
npm run electron:dev
```

Without Spotify credentials, the app still resolves tracks through ICY parsing and iTunes lookup.

## Desktop proxy routes

```text
GET /healthz
GET /api/stations/federated?limit=1000
GET /api/stations/top?limit=1000
GET /api/stations/click/:stationuuid
GET /api/streams/resolve?url=<encoded-url>
GET /api/streams/probe?url=<encoded-url>
GET /api/streams/nowplaying?url=<encoded-url>
GET /api/track/identify?artist=<artist>&title=<title>&providers=itunes,spotify
```

## Why this is necessary

The web renderer can query iTunes directly, but Spotify requires server-side credentials. The same local proxy also gives the desktop build a reliable place to:

- send Radio Browser station-click telemetry
- add a descriptive server-side user agent
- resolve playlist streams
- probe ICY headers
- parse ICY `StreamTitle` updates through SSE
- apply SSRF guardrails before touching arbitrary stream URLs

## Security invariants

The Electron window must keep these defaults:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
```

The preload bridge exposes only:

```ts
window.earthRadio = {
  isDesktop: true,
  proxyBaseUrl: string,
  version: string,
  getProxy(): Promise<string>,
  setProxy(url: string): Promise<string>,
  getLocalProxy(): Promise<string>
}
```

Do not expose raw Node APIs, filesystem access, shell execution, or arbitrary IPC channels to the renderer.

## Signing

This package cannot sign Windows/macOS/Linux artifacts by itself because signing credentials were not provided. Sign in CI or on a release host with the organization certificate material.

### Windows

Expected environment:

```text
CSC_LINK=<base64-or-path-to-code-signing-cert>
CSC_KEY_PASSWORD=<certificate-password>
```

Build:

```bash
npm run dist:desktop
npm run release:manifest
```

### macOS

Expected environment:

```text
APPLE_ID=<developer-apple-id>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
APPLE_TEAM_ID=<team-id>
CSC_LINK=<developer-id-application-cert>
CSC_KEY_PASSWORD=<certificate-password>
```

Build:

```bash
npm run dist:desktop
npm run release:manifest
```

### Linux

AppImage does not provide the same built-in platform signing model. Publish hashes, SBOM, release manifest, and repository tag.

## Release checklist

```text
[ ] npm install produced a committed lockfile
[ ] npm run smoke passed
[ ] npm run electron:dev manually verified local proxy mode
[ ] Spotify credentials tested, if enabled
[ ] Windows installer built and signed
[ ] macOS DMG built, signed, and notarized, if shipping macOS
[ ] Linux AppImage built
[ ] sha256sums.txt generated
[ ] RELEASE_MANIFEST.json generated
[ ] source package included with release
[ ] production build reviewed for source-map policy
```

## Known limitation

The uploaded `0.23.0` bundle did not include original Electron source or signing material. This package therefore provides safe rebuild-ready Electron source and local proxy implementation, but it does not mutate the previously shipped opaque executables.
