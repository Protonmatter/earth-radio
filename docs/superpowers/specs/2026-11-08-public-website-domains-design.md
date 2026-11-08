# Earth Radio website and app domains

The owner delegated design and implementation decisions and authorized completion;
only a new charge requires a question. The website-domain cutover was absent from
the completed email-domain setup. This change closes that gap.

## Addresses and hosting

- `earthradio.stream`: static product, downloads and installation website.
- `www.earthradio.stream`: permanent redirect to the apex website.
- `app.earthradio.stream`: existing full radio application and its Pages Functions.
- `earth-radio.pages.dev`: retain the working application, authentication and local
  browser data; do not force a redirect or move/copy session credentials.
- `auth.earthradio.stream`: retain sender DNS and SMTP configuration unchanged.

Use two Cloudflare Pages projects from this repository. The app retains project
`earth-radio`, the root build directory, existing production bindings/quota and
strict-public fetch flag. The static website uses project `earth-radio-website`,
Git root directory `website`, a dependency-free Node staging script and no Functions.
This preserves the app's static hosting/API boundary. Verify the Free plan and stop
before any paid option or new subscription. Cloudflare Pages supports monorepos
and includes custom domains on Free; no Supabase paid custom domain is needed.

## Website design

Light ivory, forest green and copper; Georgia display type and system body fonts.
Typographic-poster hero: “The world is on air.” One launch CTA. Use the existing
globe logo and actual guest-product captures; no fictional counts, testimonials,
partner logos, autoplay, placeholder photo service, tracking or external font.
Editorial feature rows, a real-player preview, clear platform download links,
iPhone/iPad installation help, origin-migration help and a final launch CTA.

Keep verified v0.29.0 download links as a working fallback. A bounded, credential-free
GitHub public-release lookup can refresh the displayed version and exact known
platform assets, accepting only stable releases and this repository's HTTPS URLs.
Unavailable/rate-limited lookup must leave the working fallback intact. Do not
describe the application itself as open source: its existing licensing is unchanged.

## Authentication and data

Allow browser auth on exactly `https://app.earthradio.stream` and the existing
`https://earth-radio.pages.dev`. Do not enable preview hosts, arbitrary subdomains,
the marketing apex or the mail-sender subdomain. Add exact app-domain roots to
the Supabase allowlist while retaining existing web and native loopback returns.
Make the new app root the Site URL only once HTTPS is active. Keep the Supabase
project/API hostname, provider credentials, identity links, RLS and SMTP intact.

The new web origin requires sign-in again. Cloud-synced records remain in the same
account. Unsynced browser data remains on the old origin; provide sync/export/import
instructions. Never transfer cookies, OAuth verifiers or session tokens across hosts.

## Verification and delivery

Use the existing locked npm dependencies. Add meaningful stable-release URL/parser,
website build/boundary and auth-origin regressions. Run lint/syntax, unit/integration,
web/website builds and reference/header validation, full station/search/HLS/browser
regressions, responsive website geometry/keyboard/link checks and native auth checks.
Use independent review before merge. Match exact-head hosted checks and production
deployments to main. Validate DNS, TLS, app/API behavior and original GitHub account
sync on the new origin; preserve the old production session and mail DNS records.

Deliver as v0.29.1, rebuilding Windows ARM64 and both macOS architectures from the
final main source. Retain accepted local Windows signing and unnotarized Mac limits.
Publish checksums/provenance only after package/source and download readback pass.
Update installation, operations, release docs and the existing Spaces page.

## Rollback

Keep prior Pages deployments and published v0.29.0 assets immutable. The old app
origin stays usable throughout. Revert only the new source/deployment and new domain
associations if needed. Retain old auth returns and all sender DNS; do not remove
account data or rotate credentials. Record the exact added records and settings.
