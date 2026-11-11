# Public website and application domains

| Address | Purpose | Pages project |
| --- | --- | --- |
| https://earthradio.stream/ | Public product, downloads and installation website | earth-radio-website |
| https://www.earthradio.stream/ | Permanent redirect to the public website | earth-radio-website |
| https://app.earthradio.stream/ | Radio app and optional account sync | earth-radio |
| https://earth-radio.pages.dev/ | Retained earlier app origin | earth-radio |

`auth.earthradio.stream` is the verified email sender, not an application host.
Preserve its DKIM, sending CNAME and other mail records. This change uses existing
Cloudflare Pages Free hosting and the existing Supabase project. It does not enable
a paid Supabase custom domain, introduce an API key, or change provider grants.

The November 8 hosted URL cutover changes Site URL from the earlier app address to
`https://app.earthradio.stream` and adds its exact root and slash return URLs. It
retains the pre-existing `https://earth-radio.pages.dev/**`, local development,
custom-scheme and random-path native loopback returns. The new app domain does not
use a wildcard. Source configuration uses exact legacy roots for local qualification;
this does not authorize widening the new origin or removing existing hosted returns.
Live GitHub return at the new origin reached Synced and loaded the existing liked
Voices record and 74% preference without linking a new identity. The original account
session remains at the earlier origin. Public DNS/TLS activation and a local resolver's
cached negative response are distinct checks; allow the negative TTL to expire before
assuming that a successful authoritative cutover is visible through every resolver.

## Build and deploy

Both projects connect to `Protonmatter/earth-radio`, production branch `main`.
The existing app project keeps its repository root, build, Functions, quota binding
and `global_fetch_strictly_public` compatibility flag.

The website project uses root directory **website**, framework **None**, build
command **node ../scripts/stage-website.mjs --cloudflare**, and output **.build**.
Node is pinned by `website/.node-version`. No dependency installation is required
by the website build. Do not copy application Functions or private bindings into it.

Local qualification: `npm run build:website`, `npm run verify:website`,
`node --test tests/website.test.mjs tests/web-origins.test.mjs`, and
`npm run test:e2e -- tests/e2e/website.spec.mjs`. The website source is included in
the repository release manifest; the staged website has a separate deterministic
SHA-256 asset manifest. Source privacy and branding resources are copied explicitly.

Associate each custom hostname in the correct Pages project before Cloudflare
creates its proxied CNAME. Confirm an Active certificate and HTTPS content before
changing the hosted Auth Site URL. Keep exact new app root/slash return URLs, the
existing pages.dev roots, and the native random-path loopback wildcard. Do not add
an apex, preview, or wildcard subdomain Auth origin. Do not change SMTP or provider
credentials. Source URL configuration is in `supabase/config.toml`.

Configure the free zone Redirect Rule **Earth Radio www to apex** with expression
`http.host eq "www.earthradio.stream"`, dynamic destination
`concat("https://earthradio.stream", http.request.uri.path)`, status **301**, and
**Preserve query string** enabled. It must not match the apex, app or sender hosts.
Pages `_redirects` supports path sources only; an absolute hostname source is ignored.
The website file records the external rule and the artifact validator rejects that
unsupported syntax. Roll back only this named rule if its exact-host routing fails.

## Public routes and crawler qualification

The app supports its root, root query-based authentication returns, existing
`#station=UUID` links and `/privacy`. Pages redirects matching `.html` filenames
to their extensionless URLs. `/api/*` and `/directory/*` retain their existing
Functions boundary. Unknown static paths return the branded top-level `404.html`
with HTTP 404; no catch-all rewrite serves the app shell. `/s/UUID` path links are
not introduced by this phase and need explicit routing/asset-base qualification
when ER-09 lands. The old hash links remain supported.

The app declares its primary `https://app.earthradio.stream/` canonical URL and
`noindex, follow`; the legacy app origin uses that same canonical. Its robots
file is plain text and permits crawling so crawlers can read the noindex rule.
The marketing homepage remains indexable with its own canonical. App
`/sitemap.xml` returns a 301 to the marketing site's XML sitemap. No hosted Auth
allowlist, provider, SMTP, DNS or account setting changes are needed.

Offline navigation is explicit too: root navigation uses the cached app shell,
privacy uses the cached canonical `/privacy` policy, and an unknown URL uses the branded cached 404
with status 404. Unknown routes never reuse an old cached soft-404 shell.
Query-bearing sign-in navigations are not persisted. Root-based error-page
assets work at nested URLs; the error stylesheet and precache share a release
query, and the version updater maintains both together. The new shell generation
is `v72-route-contract`.

Stage and validate both artifacts before publication:

```powershell
npm run build:web
npm run verify:site
npm run build:website
npm run verify:website
node --test tests/public-route-contract.test.mjs tests/website.test.mjs tests/service-worker.test.mjs
npm run test:e2e -- website.spec.mjs offline-shell.spec.mjs
```

Static checks establish the required Pages inputs, not the deployed HTTP status.
Run the explicit read-only HTTP gate against the observed preview URL using
`--preview`. Replace these two example origins with the URLs from the exact
commit's Cloudflare checks:

```powershell
node scripts/validate-site.mjs .build/site --origin https://observed-app-preview.earth-radio.pages.dev --preview
node scripts/validate-website.mjs .build/website --origin https://observed-website-preview.earth-radio-website.pages.dev --preview
```

Marketing previews must retain Cloudflare's `X-Robots-Tag: noindex` protection;
their source HTML still uses the marketing canonical. Production mode rejects
that header for the marketing homepage. The receipt records the selected mode.
After preview acceptance and production rollout, omit `--preview`:

```powershell
node scripts/validate-site.mjs .build/site --origin https://app.earthradio.stream
node scripts/validate-site.mjs .build/site --origin https://earth-radio.pages.dev
node scripts/validate-website.mjs .build/website --origin https://earthradio.stream
```

Each optional `--origin` run makes five bounded GETs: home, two unknown paths,
robots and sitemap. It omits credentials, follows no redirect, caps each body at
256 KiB and each request at ten seconds, and prints only status/MIME/location
receipts. It returns 0 on acceptance or 1 on failure. Without `--origin`, the
validators perform local artifact checks only. HTTP loopback origins are allowed
for the owned test server; production and preview probes use HTTPS. These probes
do not sign in, mutate collections, request audio or increment station counters.

The maintained local server models Pages' custom-404 behavior and supports
isolated HTTP tests. The `/__website` prefix is a test namespace, with root-based
404 links mapped into that namespace; real marketing deployment is at `/`.
Hosted readback remains required because a local server cannot qualify Cloudflare.

Rollback restores the preceding complete app/website deployments together, or
reverts this routing change and publishes a fresh worker generation. Preserve
the immutable runtime/map bytes and existing identity settings. Reverting to the
prior SPA fallback also restores its known soft-404 limitation; document that
temporary limitation rather than declaring the route gate passed. Pages behavior
is documented in [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Downloads and privacy

Set zone **Caching → Configuration → Browser Cache TTL** to **Respect Existing
Headers**. The default four-hour setting overrides the app's `no-cache` worker and
short-lived mutable modules on custom domains. Live readback must show `no-cache`
for `/sw.js`, 300 seconds for versioned config and revalidation for the deployment
module. Keep fingerprinted assets immutable. Do not enable Development Mode or
disable zone-wide security to fix header delivery. The public privacy page uses
`no-transform` to preserve its audited bytes and existing email links at both
addresses; the small static website also prevents body rewrites. The setting and
[origin header behavior](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/)
are separate from Pages deployment success. Roll back an incorrect zone setting
independently, but do not restore four-hour mutable caching as an application fix.

The website uses public GitHub release metadata with a four-second/256-KiB limit.
It accepts only complete stable releases from this repository with all four desktop
artifacts, installation guide and checksums at exact repository URLs. If unavailable,
the verified v0.29.0 links remain usable. It never reads or writes app storage,
registers a service worker, embeds the app, collects analytics, or accepts credentials.
Windows local signing and macOS unnotarized status stay visible beside downloads.

## Existing data and Home Screen shortcuts

Browser storage and sessions are scoped to each origin. Existing shortcuts remain
on pages.dev. Keep that site functional. Users sign in again at the new app address
to load cloud-synced collections. Export unsynced favorites/preferences with Export,
and songs with Account → Export songs, at the earlier address before importing at
the new address. Never copy tokens, cookies or PKCE verifiers between domains.
New iPhone/iPad shortcuts must be created in Safari from **app.earthradio.stream**.
The public root is a website, not the installed radio application.

## Smoke and rollback

Check apex and app HTTPS status, canonical URL, www redirect, privacy/images/module
responses, security headers, download destinations and active app service worker.
Compare every staged file's size/hash with served bytes. Test a fresh new-origin
sign-in using the existing identity, Synced state and saved collection. Verify that
the original session remains intact at pages.dev. Check native loopback tests and
sender DNS separately. A browser fixture is not live OAuth or physical iOS evidence.

For a website regression, roll back the website Pages deployment independently.
For app failure, retain the pages.dev address and restore the previous app Pages
deployment. Restore the previous hosted Site URL if the new app origin is withdrawn;
preserve old/native redirects. Remove only the exact newly added custom hostname and
its CNAME if needed; do not delete the zone, sender records, accounts or local data.
Record before/after deployment IDs and settings in Spaces. Never replace old release
assets or rewrite their tags. Public DNS and TLS propagation can delay a cutover.
