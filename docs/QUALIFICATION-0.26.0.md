# Earth Radio 0.26.0 qualification

This record preserves the candidate and live qualification evidence. See the
[release record](RELEASE-0.26.0.md) and linked GitHub release for final distribution,
checksums, exact build sources and production parity. Windows installer follow-up:
**2026-11-05**.
The application payload qualified here is commit
`570bac4366731055940246e575e351072c932194`, package/runtime **0.26.0**, Electron
**43.8.7**, runtime asset `index-8fd01303.js`, and service-worker generation **v56**.
Subsequent documentation-only commits do not create new desktop payload evidence.

[PR #20](https://github.com/Protonmatter/earth-radio/pull/20) merged as `7998245`.
Production deployment `af9d0bf7-492e-4aea-86bd-23ab737a1f46` served the same application
payload with all 47 public files verified. Published v0.25.1 assets remain immutable.

## Automated and hosted evidence

The [CI run](https://github.com/Protonmatter/earth-radio/actions/runs/41968740464)
and [Supabase run](https://github.com/Protonmatter/earth-radio/actions/runs/41968740479)
passed for the application-source cut above. Together with the Pages deployment,
all nine PR checks succeeded. Use the current PR checks for later commit status.

- Local `npm run verify`: 415 tests passed, three platform-policy skips; the
  source cut verified 237 deterministic file hashes. Later documentation adds
  source inventory entries, rather than changing the already qualified payload.
- All 53 Chromium browser cases and the full 42-scenario rendered matrix passed.
- Native Windows ARM64 locally and Windows x64/macOS ARM64/x64 in CI exercised
  the sandbox, owned-frame IPC, PKCE loopback, real OS encryption, encrypted
  restart, sync, sign-out persistence-failure recovery, account switch, normal
  quit and single-profile ownership. Native provider HTTP is synthetic.
- Separate local GoTrue/Mailpit/PostgREST integration exercised real email PKCE,
  config sync and database RLS. It did not send internet email.
- A locked `npm ci` completed and `npm audit --audit-level=moderate` reported
  zero known advisories, including development dependencies. This is a dated
  advisory check, not a claim that the application has no vulnerabilities.
- All 47 public files on the immutable
  [Pages preview](https://559994d5.earth-radio.pages.dev/) matched staged sizes
  and SHA-256 hashes. CSP, HSTS and service-worker cache headers were checked.
  Pages' same-origin HTML canonical redirects were allowed; `_headers` was
  verified through applied response policy rather than as a public file.

## Windows installer lab

The lab rebuilt a baseline from tag **v0.25.1** and the candidate application
source above. It changed the application ID, product label and installer GUID
to an isolated qualification identity, disabled shortcuts, and used explicit
installation and profile directories under the ignored qualification workspace.
The production NSIS settings, archive-compatibility hook and accepted local
signer were retained. No certificate was installed into the trusted Root store.

The original local **Earth Radio 0.24.0** installation was not upgraded. Its
executable SHA-256 and uninstall registration were captured before the lab and
checked after each installer operation. They remained unchanged.

| Check | Verified result |
| --- | --- |
| Baseline source/package parity | 59 application source files matched the v0.25.1 fixture |
| Baseline persistence | Imported one Classic Vinyl HD favorite and 55% volume through the normal UI; both survived a full restart and normal JSON export |
| 0.25.1 to 0.26.0 upgrade | Installer exit code 0; isolated registration changed to 0.26.0 |
| Upgraded payload parity | All 66 application source files and all 86 installed payload files matched the candidate fixture; the only additional installed file was its expected uninstaller |
| Upgraded user data | The normal export preserved the complete favorite and preference objects, including 55% volume |
| Installed account capability | The actual upgraded application displayed native browser-return instructions and Google/GitHub controls; no live provider sign-in was performed in this lab |
| Upgrade uninstall | Exit code 0; lab executable and registration removed; separate profile preserved |
| Clean candidate install | Exit code 0; all 86 installed payload files matched |
| Fresh-profile startup | Loaded the live directory, exposed Sign in, and exported empty favorites/recents with the default 80% volume |
| Final uninstall | Exit code 0; lab executable and registration removed; both isolated profiles and verification exports retained |
| Original installation | Executable hash and registration unchanged; no lab windows remained |

The first baseline verification helper assumed that NSIS writes an optional
`InstallLocation` registry value. The installer had already passed the helper's
exit-code check, but the helper then failed on that missing value. Verification
was corrected to validate the exact uninstall and display-icon paths. The
completed installation was inspected and its payload verified without blindly
rerunning it. This was a qualification-helper defect, not an installer failure.

Local, ignored evidence is under `.build/qualification/installer-026/`:
`qualification.json`, the bounded desktop plan, per-operation receipts,
source/payload hashes, supported exports and an installed-account screenshot.
Those local paths are evidence locations, not scripts guaranteed to exist in a
fresh clone. No credentials or personal listening data belong in committed
qualification evidence.

This qualifies the bounded installer mechanics and guest-data migration with
an isolated application identity. It does **not** establish an upgrade of the
published identity over the original installation, every existing user profile,
machine-wide installation, or a physical Mac upgrade.

## Desktop artifact and live account evidence

The current Windows ARM64 installer/portable use Electron 43.8.7, accepted local
Authenticode signatures and timestamps. They do not have public publisher trust.
The actual portable restored the previously authorized live GitHub session and
reached **Synced** in an explicit isolated profile. Earlier source/portable tests
completed the owner's Google/GitHub callbacks, encrypted restart/logout and live
web/desktop favorite and preference round trips. Existing-user recovery is not
fresh outside-team signup evidence.

Native Apple Silicon and Intel CI built separate unnotarized DMGs from the source
cut above. Their receipts verify ad-hoc signatures, DMG integrity/read-only mount,
architecture/version, all 66 application source files, and bounded packaged
startup. Downloaded sizes and SHA-256 hashes matched locally. The declared minimum
is macOS 12; the CI runtime was macOS 15. Physical provider consent, audio playback
and upgrades on macOS 12 are not inferred from those checks.

The local delivery receipt and four-file checksums are
`.build/auth-qualification/delivery-readiness.json` and
`.build/auth-qualification/SHA256SUMS-0.26.0-READINESS.txt`. Windows was built at
`268b9b4`; the intervening source commit changed only a browser test and release
manifests, and all packaged application source files match the qualified cut.
These are candidate artifacts, not a new public GitHub release.

## Sender infrastructure follow-up (2026-11-06)

The owner registered `earthradio.stream` for three years. Cloudflare's completed
checkout and public registry readback independently confirmed registration on
November 6, 2026 and expiration on November 6, 2029. Cloudflare and Google public
resolvers returned `megan.ns.cloudflare.com` and `yahir.ns.cloudflare.com`.

Registrar status is Active, WHOIS redaction is enabled and transfers are locked.
DNSSEC activation was requested through the registrar. The first check found public
DNSKEY records while parent DS publication was pending. By 22:10 UTC, Cloudflare and
Google public resolvers each returned authenticated, successful DS, DNSKEY and DKIM
TXT answers: six checks passed. Cloudflare managed the DS publication; no manual DS
value was invented or submitted.

The Resend account is connected and `auth.earthradio.stream` is Verified in North
Virginia (`us-east-1`). Open/click tracking and receiving are disabled. The initially
empty Cloudflare zone now contains exactly the provider-generated DKIM TXT, two
DNS-only sending CNAMEs and optional DMARC monitoring TXT. All four values matched
through Cloudflare and Google public resolvers: eight checks passed. Resend then
reported the domain and three required records Verified.

A sending-only key restricted to this domain was saved in Windows Credential Manager
and encrypted readback passed. Supabase custom SMTP was saved and retained enabled
state after reload. The credential value, private registrant contacts
and payment data are excluded from repository evidence. This domain setup does not
move the website or change its approved auth return URLs.

## Live email and restart follow-up (2026-11-06)

A new owner-authorized external Gmail alias received the production confirmation
message in the Inbox. SPF, DKIM and DMARC passed. Redemption created a confirmed
email identity, consumed the callback and reached Synced. A browser reload restored
the session; read-only backend checks confirmed the account and three configuration
documents. A saved favorite and 55% volume synced to the Windows ARM64 client after
a real email PKCE callback returned through the approved loopback route.

The native callback passed its one-time verifier check and token exchange (HTTP 200).
Changing native volume to 61% updated the backend revision and the web client's normal
JSON export. After a normal quit, the same isolated native profile was relaunched
without diagnostic fetch hooks. Its encrypted session restored the same account,
favorite and 61% volume, and the account dialog reached Synced without a new email.
The restarted QA app was then closed normally. Local nonsecret receipts and UI
captures are retained under `.build/auth-qualification/`; tokens, verifiers and mail
links are excluded.

An earlier attempt used an older message in Gmail's cached conversation after a
newer request had canceled that attempt. Refreshing and selecting the newest link
completed the flow; no production code change was needed. The qualification harness
also explicitly isolated both Electron userData and sessionData. Neither adjustment
changed the installed application or the original user's profile.

After testing, the original Earth Radio login was restored through GitHub. The
account displayed GitHub linked and Synced; reload restored its original 74% volume.
The original cloud documents remained present. GitHub account credentials, security
settings and permissions were not changed. The test email identity is retained.

## Open acceptance gates

- **Delivery breadth:** the new external Gmail email account passed signup,
  confirmation, web/native sync and encrypted native restart. Other mailbox providers
  and fresh outside-team Google/GitHub identities remain untested. Confirmation stays
  enabled; existing-owner OAuth success is not fresh outsider OAuth evidence.
- **Physical device coverage:** installed iOS/iPadOS account returns and a physical
  Mac provider/upgrade path remain unqualified. Native CI and earlier Home Screen
  playback/map feedback do not substitute for those account checks.
- **Distribution identity:** final source/artifact identities and publication status
  are recorded in the [release record](RELEASE-0.26.0.md) and release provenance.

See [account operations](AUTHENTICATION.md) for sender setup, retry behavior and
rollback, [dependency security](SECURITY.md#dependency-security) for patched
versions/overrides, and [installation](INSTALLATION.md) for current public downloads
and iPhone/iPad Home Screen instructions. Old tags and published assets must not
be replaced to deliver this candidate.
