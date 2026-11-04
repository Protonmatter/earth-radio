# Public and desktop authentication design

The user requested public registration/login with Google, GitHub or email, account
sign-in/sync in Windows/macOS, and end-to-end qualification. Implementation choices
are delegated under the existing request to implement and make design decisions.

## Current evidence

The hosted project is healthy; signups, Google, GitHub and email are enabled and
email confirmation is required. The hosted SMTP switch is off. Public email therefore
needs a real sender service. Resend is the selected provider; sender-domain ownership
and a live test inbox still require confirmation. Google audience status remains to
be inspected. No hosted settings were changed during discovery.

Desktop currently disables auth on file origins, blocks renderer navigation and
exposes only a small context-isolated bridge. Web auth already implements Supabase
PKCE and account-scoped favorites/recents/preferences synchronization. Six hosted
tables have forced RLS. The existing authenticated SECURITY DEFINER configuration
RPC and disabled leaked-password warning are known; no password login is introduced.

## Approaches

1. Embedded provider window: rejected because providers restrict embedded agents and
   it would expand renderer navigation/credential exposure.
2. Custom URL protocol: workable for installed apps, but introduces OS registration,
   portable-build differences and scheme-interception considerations.
3. System browser plus a temporary IPv4 loopback callback: selected. It works for
   Windows setup/portable and macOS without protocol registration. PKCE, a random
   one-time callback path and an active-attempt generation bind the return.

This follows [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252): open only loopback,
bind before authorization, and close after response/cancellation/timeout. Provider
credentials remain at Supabase; native clients contain only existing public config.

## Boundaries and implementation decisions

- Move the existing public deployment auth data into one shared deployment module;
  preserve runtime-injected browser test configuration. No private credential enters Git.
- Keep authorization, access/refresh tokens and token exchange in Electron main.
  Reuse the existing PKCE client through a narrowly injected redirect resolver.
- Store session material with Electron's asynchronous safeStorage API in an atomic,
  encrypted file below the app's userData directory. Flow verifiers remain in memory.
  Encryption unavailability must never fall back to plaintext persistence.
- Browser callbacks bind to 127.0.0.1 on an ephemeral port and a random path below
  `/earth-radio-auth/callback/`. Require the exact Host, GET, active nonce and bounded
  URL/query input. Invalid unrelated requests do not consume the live attempt.
- Register only `http://127.0.0.1:*/earth-radio-auth/callback/*` as the native redirect
  pattern, retaining the exact production web root. Preview origins stay excluded.
- Consume callbacks once, reject replays, cancel superseded attempts, cap pending
  sign-in lifetime, and close listeners on app shutdown. Never log callback URLs/codes.
- Provider authorization opens only through the system browser. Google/GitHub options
  are owned by main; renderer input cannot choose redirect destinations or scopes.
- The preload exposes a token-free auth client interface. Main validates the owned
  top-level frame and exact trusted file document for every auth IPC operation.
- IPC returns only account/session display metadata. Remote data calls are restricted
  to the existing config-document read and upsert RPC, three document keys and body
  limits. No generic authenticated-fetch or arbitrary RPC bridge is exposed.
- Reuse the existing renderer sync engine and account namespace transitions. Logout
  clears the encrypted session and returns to signed-out local data. Never auto-link
  accounts based on unverified email.
- Native email uses the same verified magic-link PKCE flow. The app stays open while
  the user opens the link on that device. Restart/cancellation requires a fresh attempt.
- Preserve sandbox, context isolation, CSP, guarded proxy, existing profiles and all
  private quota bindings. No new project dependency or analytics is planned.

safeStorage and redirect details are checked against the installed Electron API and
[Electron documentation](https://www.electronjs.org/docs/latest/api/safe-storage), and
the [Supabase redirect policy](https://supabase.com/docs/guides/auth/redirect-urls).

## Hosted configuration and external prerequisites

Read provider/audience/SMTP settings before changes. Keep email confirmation on,
preserve OAuth scopes and RLS, and make only bounded changes required for public
signup and the native return path. Resend public sending needs a verified sender
domain; a sandbox/test sender is not public signup qualification. Billing, new
account terms, private credential entry and provider consent are handed to the user
where required. Do not create fake user identities or email unrelated recipients.

## Evidence required

Unit/adversarial tests cover IPC, callback validation/replay, pending attempts,
encrypted persistence/failure, and cross-account races. Local GoTrue/Mailpit tests
exercise real email/code exchange and RLS with disposable users. A real sandboxed
renderer invokes main IPC on Windows and native macOS runners, including encrypted
restart and token-free payload checks. Test two clients syncing favorites, recents
and preferences; test logout, account switch, expired session and offline recovery.

Live evidence must separately show public provider audience/email delivery and new
outside-team signup, with approved user-controlled identities. Existing sessions or
fixtures alone cannot qualify that claim. Windows live provider return flows and
cross-client sync are tested interactively; macOS runner checks are distinguished
from physical Mac browser consent/audio/device coverage. Publish updated artifacts
only after review and the supported checks pass. Older v0.25.1 assets remain immutable.
