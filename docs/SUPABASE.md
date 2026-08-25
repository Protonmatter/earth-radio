# Supabase operations

Earth Radio uses the dedicated Supabase project `ueomkorngpgvthqioqns` in AWS `us-east-1`.
The browser receives only the project URL and publishable key. Never put a secret key,
database password, provider client secret, or Apple signing key in the repository.

## Data contract

The migrations under `supabase/migrations` create private profile, preference, favorite,
recent-station, country, and generic configuration tables. Every table has forced RLS.
Authenticated users can access only rows whose `user_id` equals `auth.uid()`. Anonymous
access is revoked. Generic configuration writes must use
`upsert_user_config_document`, which performs compare-and-swap revision checks and keeps
deletion tombstones.

The web client syncs the existing IndexedDB `favorites`, `recents`, and `prefs` records to
the generic configuration documents `favorites`, `recents`, and `preferences`. First-device
data is uploaded. Remote-only changes are downloaded. Concurrent favorites and recents are
merged by station; concurrent preferences keep the current device's explicitly stored fields.
Production authentication is enabled only on `https://earth-radio.pages.dev`. Local development
can inject a runtime auth configuration before `config.js`; the explicit localhost callback remains
in the Supabase redirect allowlist. Cloudflare preview origins are excluded from both production
configuration and the redirect allowlist.

## Apply and verify

Link a local Supabase CLI to project `ueomkorngpgvthqioqns`, then use the normal migration
workflow:

```sh
supabase link --project-ref ueomkorngpgvthqioqns
supabase db push
supabase test db
```

The SQL test suite is transaction-scoped and rolls back its two synthetic users. In the
hosted SQL editor, run `supabase/tests/rls_policies.sql`; a clean run ends with `ok 20` and
no pgTAP diagnostics. After any policy or function change, rerun the Supabase Security
Advisor and confirm that no new errors appear.

## Authentication providers

All providers use this callback URL:

`https://ueomkorngpgvthqioqns.supabase.co/auth/v1/callback`

GitHub is registered and enabled. Google, Apple, and Microsoft remain disabled in both
Supabase and `site/config.js` until their provider-side credentials are registered. Provider
secrets belong only in the Supabase dashboard. Enable each provider in `site/config.js` only
after a complete sign-in and account-linking smoke test.

Manual identity linking is enabled. A signed-in user can link another enabled provider from
the account dialog. Do not automatically link identities based solely on an unverified email.

## Rollback

Disable `site/config.js` `auth.enabled` to stop new browser auth and sync without deleting
user data. Disable an individual provider in both the client configuration and Supabase before
revoking its provider credentials. Database rollback should use a new forward migration;
never delete auth or user tables as an emergency rollback.
