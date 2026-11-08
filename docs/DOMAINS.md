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

## Downloads and privacy

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
