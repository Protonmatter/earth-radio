# Account sign-in and synchronization

The 0.26.0 candidate adds Windows/macOS account support. Google and GitHub use the
default system browser. Email uses a verified magic link. Favorites, recent stations
and preferences use the existing per-user Supabase configuration documents and RLS.
Listening does not require an account.

## Current qualification boundary (2026-11-04)

The hosted project allows public signups, manual identity linking and confirmed email.
Google's Earth Radio project is **External / In production**, with only OpenID, profile
and email scopes and no configured sensitive/restricted scopes. GitHub is enabled with
the Supabase callback. These configuration checks do not prove a fresh outsider signup.

**Public email is blocked:** custom SMTP is off, and the owner confirmed that there is
no sender domain yet. Resend was selected, but no domain was purchased, sender verified,
new provider account accepted, credential created or SMTP setting changed. Supabase's
default mailer is not a public email delivery service. Do not remove email confirmation
or advertise arbitrary-address email registration as qualified.

Windows ARM64 source qualification exercised the real Electron sandbox/preload/main
IPC, loopback PKCE callback, DPAPI-backed asynchronous safeStorage encryption, encrypted
restart, restricted sync adapter and logout across restart. The automated fixture also
loads the real account UI, completes sign-in/sync and signs out before switching users.
Native subprocess tests verify one owner per profile and normal quit waiting for both
an encrypted update and queued logout deletion. Synthetic provider HTTP in those tests
is distinct from live provider qualification.

Live Windows Google and GitHub sign-in with the owner's existing accounts both completed
the system-browser callback and reached **Synced**. Google's encrypted session survived
an app restart; sign-out removed its local ciphertext. A UI integration failure found in
this test was reproduced: the previous navigation guard blocked the account namespace
reload. Only exact trusted-file reloads are now allowed, with other files, query-bearing
documents, remote URLs and redirects still blocked. Native Windows x64/macOS ARM64/x64
encryption/lifecycle tests and local GoTrue/Mailpit/PostgREST integration passed on
review-fix commit `105d2cf`; the expanded real-UI regression must pass on the final head.

Fresh outside-team signup, public email delivery, packaged installer interaction and a
physical Mac provider-consent test remain separate gates. The existing v0.25.1 assets
remain immutable. No publication claim is made for this candidate.

## Desktop use

1. Open **Account**, then **Continue with Google** or **Continue with GitHub**.
2. Complete the existing provider's sign-in in the default browser and return to Earth
   Radio. Keep the app open. A successful return says that sign-in completed.
3. For email (once public SMTP is qualified), request a link and open it on the same
   computer within ten minutes. Restarting the app or starting a later attempt cancels
   the earlier verifier. Use **Cancel pending sign-in** to abandon an attempt.
4. Check the account identity and **Synced** status before checking another device.
5. **Sign out** clears the local encrypted session even when remote revocation fails.
   Account namespaces prevent another user's favorites/preferences from being uploaded.

The browser callback listener binds only to an ephemeral IPv4 loopback port and a
random one-time path. No inbound firewall rule or custom protocol registration is
needed. PKCE verifiers exist in main-process memory only. Session tokens are encrypted
under `userData/auth-v1/session.enc`; the renderer receives display metadata only.
There is no plaintext fallback when the OS vault is locked/unavailable. Unlock the
keychain and restart; local radio remains usable. Windows DPAPI protects against other
OS users, not arbitrary software already running as the signed-in Windows user.

## Public email setup: Resend

The owner must acquire/control a sender domain before this can be completed. A concrete
deployment layout is `auth.<owned-domain>` with sender `Earth Radio
<signin@auth.<owned-domain>>`. Use the existing Cloudflare account for DNS if desired;
do not buy a domain or accept registration/provider terms without the owner's action.
The Pages hostname cannot serve as a domain the owner controls for email DNS.

1. Register the chosen available domain with the owner's registrar/account. Review
   the checkout price and renewal price before payment. Create/sign into the owner's
   Resend account and complete any legal/billing step personally.
2. Add the `auth` sending subdomain in Resend. Add **only the exact DNS records shown
   by Resend** to the authoritative DNS zone. Preserve existing MX and unrelated mail
   records. Wait for the domain's Verified status; retain a redacted DNS receipt.
3. Create a sending-only key restricted to that domain where the service supports it.
   Enter it locally into Supabase SMTP's password field; never paste it into chat,
   shell arguments, screenshots, GitHub, a workflow variable or repository files.
4. In Supabase Authentication → Emails → SMTP, configure host `smtp.resend.com`,
   port `465`, username `resend`, password the Resend API key, sender name `Earth Radio`,
   and the verified sender address. Keep email confirmation on and review the hosted
   Auth email rate limit against the selected sender plan. Keep link tracking off for
   authentication mail. Save only after the domain and credentials are ready.
5. With owner-confirmed external test inboxes, request a fresh signup link through the
   production UI. Verify sender alignment, delivery, the correct production or native
   return, one-time PKCE exchange, confirmed identity and persisted session. Check a
   second inbox/provider to qualify delivery outside the Supabase organization.

References: [Resend's Supabase SMTP guide](https://resend.com/docs/send-with-supabase-smtp),
[verified sender domains](https://resend.com/docs/dashboard/domains/introduction), and
[Supabase's custom SMTP boundary](https://supabase.com/docs/guides/auth/auth-smtp).

## Validation and rollback

```powershell
npm run check
npm test
npm run test:desktop-auth
npm run test:e2e
npm run test:rendered
npm run verify
```

`npm run test:desktop-auth` exits nonzero if real OS encryption, IPC isolation, PKCE,
encrypted restart, the sync adapter or logout fails. It uses a uniquely isolated
profile below `.build` and deletes that profile after success. It never opens a real
provider or accesses the installed user's profile. CI runs it on Windows x64 and native
macOS ARM64/x64; this Windows machine supplies ARM64 evidence.

Local GoTrue/PostgREST/Mailpit tests run in the existing Supabase workflow. They use
disposable local users, verify email PKCE plus config sync, and do not send public mail.
Local Windows has no Docker/Supabase CLI, so that integration must be qualified in CI.
No live access/refresh tokens, auth codes, verifiers or mail links belong in evidence.

Rollback uses the prior application/web release without deleting user tables. To stop
native callbacks, remove only the native loopback redirect entry in hosted Supabase.
The required entry is `http://127.0.0.1:*/earth-radio-auth/callback/*`; preserve the
exact production web root and exclude preview origins. To roll back SMTP, restore the
previous hosted SMTP configuration; doing so reinstates the restricted default-mailer
behavior, so public email sign-in must be treated as unavailable again. Do not rotate
keys, delete auth users or disable confirmation as an emergency workaround.
