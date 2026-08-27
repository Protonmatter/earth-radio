# Supabase operations

Earth Radio uses the dedicated Supabase project `ueomkorngpgvthqioqns` in AWS `us-east-1`.
The browser receives only the project URL and publishable key. Never put a secret key,
database password, provider client secret, or Apple signing key in the repository.

## Auth workflow

The public site is a static Cloudflare Pages app, so it uses the [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), not the implicit fragment flow. After GitHub or a magic-link verify, Auth redirects to the Site URL with `?code=`. The browser exchanges that code plus the locally stored verifier at `/auth/v1/token?grant_type=pkce`.

Official PKCE notes that extra query parameters on `redirect_to` (`sb_flow_id` / `er_auth_flow`) are experimental overlapping-flow support. This client follows the default: `redirect_to` is the exact Site URL. The verifier is mirrored to `localStorage`, `sessionStorage`, and a first-party `SameSite=Lax` cookie so a GitHub bounce can still complete the exchange when `localStorage` is empty. If a callback URL still names a missing flow, that callback fails without consuming a different pending verifier.

[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) in `supabase/config.toml` are exact production and local paths. Do not add `https://earth-radio.pages.dev/**` or preview `*.earth-radio.pages.dev` globs. After changing those values, update the hosted URL configuration in the dashboard to match; CI does not push Auth config with a hosted access token.

Production authentication is enabled only on `https://earth-radio.pages.dev`. Local development can inject a runtime auth configuration before `config.js`. Cloudflare preview origins stay excluded.

## Data contract

The migrations under `supabase/migrations` create private profile, preference, favorite,
recent-station, country, and generic configuration tables. Every table has forced RLS.
Authenticated users can access only rows whose `user_id` equals `auth.uid()`. Anonymous
access is revoked. Configuration writes are restricted to the three synchronized document
keys (`favorites`, `recents`, and `preferences`) and must use
`upsert_user_config_document`, which performs compare-and-swap revision checks and keeps
deletion tombstones. Per-key size limits accommodate the recovered model's 1,000 full favorite
summaries while keeping recents and preferences substantially smaller.

The web client syncs the existing IndexedDB `favorites`, `recents`, and `prefs` records to
the generic configuration documents `favorites`, `recents`, and `preferences`. First-device
data is uploaded. Remote-only changes are downloaded. Concurrent favorites and recents are
merged by station; concurrent preferences keep the current device's explicitly stored fields.

## Apply and verify

Link a local Supabase CLI to project `ueomkorngpgvthqioqns`, then use the normal migration
workflow:

```sh
supabase link --project-ref ueomkorngpgvthqioqns
supabase db push
supabase test db
```

GitHub Actions follows the [automated testing](https://supabase.com/docs/guides/deployment/ci/testing) and [local testing overview](https://supabase.com/docs/guides/local-development/testing/overview) guides. Local Auth emails are captured by [Mailpit](https://supabase.com/docs/guides/local-development/cli/testing-and-linting#testing-auth-emails):

```sh
supabase db start
supabase test db
supabase start -x studio,imgproxy,logflare,vector,supavisor
AUTH_INTEGRATION=1 node --test tests/auth-local-gotrue.test.mjs
```

The SQL test suite is transaction-scoped and rolls back its two synthetic users. In the
hosted SQL editor, run `supabase/tests/rls_policies.sql`; a clean run ends with `ok 23` and
no pgTAP diagnostics. After any policy or function change, rerun the Supabase Security
Advisor and confirm that no new errors appear.

The PKCE job talks only to the local stack (GoTrue, PostgREST, Mailpit). It does not use
`SUPABASE_ACCESS_TOKEN` or the hosted project. Unique email addresses keep application-level
tests isolated, as the testing overview requires.

## Authentication providers

All providers use this callback URL:

`https://ueomkorngpgvthqioqns.supabase.co/auth/v1/callback`

GitHub is registered and enabled. Google, Apple, and Microsoft remain disabled in both
Supabase and `site/config.js` until their provider-side credentials are registered. Provider
secrets belong only in the Supabase dashboard. Enable each provider in `site/config.js` only
after a complete sign-in and account-linking smoke test. Local `config.toml` keeps every
external provider disabled so CI never needs those secrets.

Manual identity linking is enabled. A signed-in user can link another enabled provider from
the account dialog. Do not automatically link identities based solely on an unverified email.

## Rollback

Disable `site/config.js` `auth.enabled` to stop new browser auth and sync without deleting
user data. On the next load, the account overlay archives the active local namespace and detaches
the shared working keys before it exits. Disable an individual provider in both the client configuration and Supabase before
revoking its provider credentials. Database rollback should use a new forward migration;
never delete auth or user tables as an emergency rollback.
