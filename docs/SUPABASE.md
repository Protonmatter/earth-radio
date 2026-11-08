# Supabase operations

Earth Radio uses the dedicated Supabase project `ueomkorngpgvthqioqns` in AWS `us-east-1`.
The browser receives only the project URL and publishable key. Never put a secret key,
database password, provider client secret, or Apple signing key in the repository.

## Auth workflow

The public site is a static Cloudflare Pages app, so it uses the [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), not the implicit fragment flow. After GitHub or a magic-link verify, Auth redirects to the Site URL with `?code=`. The browser exchanges that code plus the locally stored verifier at `/auth/v1/token?grant_type=pkce`.

Official PKCE notes that extra query parameters on `redirect_to` (`sb_flow_id` / `er_auth_flow`) are experimental overlapping-flow support. This client follows the default: `redirect_to` is the exact origin root (`https://earth-radio.pages.dev/`), and only the latest PKCE verifier is kept. Magic links opened in a new tab can still read that verifier from `localStorage` or the SameSite cookie. If a callback URL still names a missing flow, that callback fails without consuming a different pending verifier.

[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) in `supabase/config.toml` are exact production and local paths. Do not add `https://earth-radio.pages.dev/**` or preview `*.earth-radio.pages.dev` globs. After changing those values, update the hosted URL configuration in the dashboard to match; CI does not push Auth config with a hosted access token.

Browser authentication is enabled only on `https://earth-radio.pages.dev`. The 0.26.0
desktop candidate uses a main-process PKCE client with an ephemeral loopback return,
OS-encrypted session persistence and a token-free preload adapter. Local development
can inject runtime auth configuration before `config.js`. Cloudflare preview origins
stay excluded. See [account operation and email setup](AUTHENTICATION.md) for release
qualification boundaries, sender prerequisites and rollback.

## Data contract

The migrations under `supabase/migrations` create private profile, preference, favorite,
recent-station, country, and generic configuration tables. Every table has forced RLS.
Authenticated users can access only rows whose `user_id` equals `auth.uid()`. Anonymous
access is revoked. Configuration writes are restricted to the four synchronized document
keys (`favorites`, `recents`, `preferences`, and `songs`) and must use
`upsert_user_config_document`, which performs compare-and-swap revision checks and keeps
deletion tombstones. Per-key size limits accommodate the recovered model's 1,000 full favorite
summaries while keeping recents and preferences substantially smaller.

The web client syncs the existing IndexedDB `favorites`, `recents`, and `prefs` records to
the generic configuration documents `favorites`, `recents`, and `preferences`. First-device
data is uploaded. Remote-only changes are downloaded. Concurrent favorites and recents are
merged by station; concurrent preferences keep the current device's explicitly stored fields.
The private song library uses separately namespaced local records and a one-MiB server
document. Its logical clear/remove behavior and downgrade-safe account fencing are
documented in [Song library](SONG_LIBRARY.md). Song-only downloads do not reload audio.

## Apply and verify

The existing hosted project's earlier schema was provisioned outside migration-history
tracking. The song-library migration is recorded as `20261108055646_song_library`;
its source filename matches the version assigned by the migration API. Before using
CLI `db push` against that existing project, inspect `supabase migration list` and
reconcile the historical baseline against the actual schema. Do not replay the older
create-table migrations or mark them applied without verifying their effects.
The release workflow applies reviewed incremental SQL through the migration API
after its database/Auth CI jobs pass, then checks constraints, RLS, grants and advisors.

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
hosted SQL editor, run `supabase/tests/rls_policies.sql`; a clean run ends with `ok 31` and
no pgTAP diagnostics. After any policy or function change, rerun the Supabase Security
Advisor and confirm that no new errors appear.

The PKCE job talks only to the local stack (GoTrue, PostgREST, Mailpit). It does not use
`SUPABASE_ACCESS_TOKEN` or the hosted project. Unique email addresses keep application-level
tests isolated, as the testing overview requires.

## Authentication providers

All providers use this callback URL:

`https://ueomkorngpgvthqioqns.supabase.co/auth/v1/callback`

GitHub is registered and enabled. The browser requests the `user:email` scope so private
GitHub emails still populate the account dialog.

Google is registered and enabled as well: `/auth/v1/settings` reports `google: true`, which
the hosted project returns only once the provider page holds a client ID and secret. The
account overlay reads that endpoint and paints a Continue with Google button only when the
hosted provider is actually on, so enabling it in `site/config.js` alone is not enough. The
client behind it is a Google Cloud OAuth Web application with authorized JavaScript origin
`https://earth-radio.pages.dev` and the callback URL above as its redirect URI; keep those
two values in step with the deployment if either ever moves. Note that a Google app left in
Testing admits only its listed test users, which is a publishing-status setting on the Google
Cloud consent screen rather than anything Supabase or this repository controls.

Apple and Microsoft remain disabled until
their provider-side credentials are registered. Provider secrets belong only in the
Supabase dashboard. Local `config.toml` keeps every external provider disabled so CI never
needs those secrets.

Manual identity linking is enabled. A signed-in user can link another enabled provider from
the account dialog. Do not automatically link identities based solely on an unverified email.

## Rollback

Disable `site/config.js` `auth.enabled` to stop new browser auth and sync without deleting
user data. On the next load, the account overlay archives the active local namespace and detaches
the shared working keys before it exits. Disable an individual provider in both the client configuration and Supabase before
revoking its provider credentials. Database rollback should use a new forward migration;
never delete auth or user tables as an emergency rollback.
