# v0.30.0 live qualification — November 8, 2026

Windows native qualification passed on the published ARM64 portable build.
Physical iPhone Home Screen qualification remains open. Desktop WebKit and phone
viewport checks are supporting evidence, not a substitute for an iPhone result.

## Build and evidence boundary

The released application source is commit
`40739204d8d4c5badb29f6c32fdb52933a87a6c9`, tagged `v0.30.0`.
`EarthRadio-Portable-0.30.0-arm64.exe` is 105221032 bytes; SHA-256:
`49a1c26a0e7b66b1f7fccc452321930f08a331c7afeb5db683770711e58dd6eb`.
The portable was run with isolated, retained profiles, separate from the user's
installed app. This qualification did not install or upgrade the Windows setup
package or test a physical Mac. Existing release packaging/download receipts
remain the source for those artifact checks.

Private local evidence is under `.build/qualification-030/live-20261108/`:
sanitized account-document digests, screenshots, native launch/process receipts,
browser reports and QA results. Authentication redirects, tokens, session-file
contents and email bodies must not be copied into documentation or test reports.
Retained native profiles contain OS-encrypted session state and are not public
artifacts. Do not upload them or include them in release assets.

## Observed Windows results

| Scenario | Live result |
| --- | --- |
| Directory/search | Full live catalog loaded; `jazz in london` returned two current matching stations. Counts depend on the upstream catalog. |
| Filters/recovery | Searchable Jazz selection, HTTPS-only constraint, zero-result state and reset worked. Reset preserved the query. |
| Shared search | Browse and the keyboard search palette retained the same query/results. |
| Playback | Classic Vinyl HD entered Playing with a Pause control and current metadata; paused before authentication. Human audio fidelity was not measured. |
| GitHub | Fresh native PKCE sign-in restored the existing GitHub-only account and Synced status. |
| Bidirectional sync | Native volume change appeared in an independent production web client; the reverse change returned to native. A temporary favorite appeared on web, and its web removal returned to native. |
| GitHub restart | Normal quit and relaunch restored the existing signed-in account and 74% volume from the retained encrypted profile. |
| Google | Fresh native PKCE sign-in restored the existing Google/email account, Synced status, existing favorite and 100% volume. No identity linking or expanded grant was performed. |
| Email | One sign-in request to an existing QA email account produced an Inbox message. Its link returned through the native one-time loopback path, restored that same account and reached Synced. |
| Email restart | Normal quit and relaunch restored the signed-in email account, existing favorite and 61% volume. |

This is existing-owner/account qualification, not proof of every new-user signup,
every email provider or OAuth access for an unrelated external account. No account,
provider grant, SMTP configuration or authentication schema was changed.

All three accounts' collection values matched their recorded baselines after
teardown. Revisions increased where test writes occurred. The original GitHub web
session and liked-song entry were preserved; no global sign-out was used.

First sign-in intentionally adopts anonymous favorites/recents on a fresh profile
(the existing `planLocalAccountTransition` contract). Anonymous songs still require
explicit import. Consequently, the email QA account adopted the guest playback
entry. After the owned native client quit, a revision/content/station/time-guarded
update restored only that test account's originally empty recents document and
advanced its revision. Final readback confirmed the baseline value; other
collections were unchanged. Do not treat this existing adoption behavior as a
cross-account leak or remove unrelated history during cleanup.

## Regression fix and maintained coverage

The website's Skip to content link was skipped by default Tab navigation in
Playwright WebKit. Adding explicit `tabindex="0"` made the existing keyboard test
pass. The new `webkit-ui` project runs the existing search-experience, auth-ui and
website suites with Desktop Safari defaults and their explicit phone-width cases.
CI installs both Chromium and WebKit in the existing E2E job.

Validation: `npm run test:e2e -- --workers=3` passed **134 tests**: 103 Chromium
and 31 WebKit. The latter include 20 search, six account-dialog and five website
cases. Provider and sync fixtures exercise UI contracts; live native tests above
provide separate integration evidence. The WebKit rapid-Enter assertion checks
activation labeling, not settled playback or audible output.

An exploratory full Windows WebKit media run was stopped: the media loader did
not expose reserved fixture audio URLs to the page routing hook, although a
same-origin WAV played and the real fallback stream progressed. That matrix does
not qualify media or establish a product regression. Media fixtures remain in the
103-case Chromium suite. No player behavior was changed to hide this limitation.

The website/test/CI follow-up does not change the 80 packaged application source
files. Compare them against the release's source-file receipt before claiming
application parity. Preserve the release tag, installers, portable and checksums;
do not replace assets under an existing version for a website-only fix.

## Physical iPhone completion checklist — pending

No physical iPhone/iPad or active remote-device connection was available during
this run. Earlier successful Home Screen installation is dated evidence for an
earlier build. Record device model, iOS version, date and each result below before
marking v0.30.0 iPhone qualification complete.

1. In Safari open `https://app.earthradio.stream/`. Use Share → Add to Home
   Screen, then launch that shortcut. Confirm standalone presentation and the
   current search/filter controls. Existing shortcuts on pages.dev retain their
   own local data; sync or export it before changing origin.
2. Search `jazz in london`; choose Jazz, a country and a language through their
   searchable controls. Remove individual filter chips. Force an empty result,
   reset filters and confirm the query remains. Clear search and verify stations
   return. Repeat in portrait/landscape; check the keyboard does not trap controls.
3. Use the existing GitHub identity. Complete browser return, reopen the Home
   Screen app if Safari remains foregrounded, and confirm the original account
   and Synced. Repeat Google and email with their intended existing accounts;
   do not link identities or erase local data to make a test pass.
4. On one account, note original volume/favorite state. Change volume and add a
   temporary favorite on the phone; verify both on the signed-in Windows app.
   Reverse those changes on Windows and verify the phone returns to baseline.
5. Close/reopen the Home Screen app; confirm the same account, collection and
   settings. Play Classic Vinyl HD, lock for 30 seconds, unlock and check playback
   and controls. Record background interruption or return failures separately.
6. Restore test values and retain only screenshots without auth links/tokens.
   A failure needs its precise step and visible symptom; desktop emulation alone
   cannot close this gate.

## Reproduction and rollback

Use the repository's pinned Node/npm and existing dependencies:

```powershell
npm ci
npx playwright install --with-deps chromium webkit
npm run release:manifest
npm run verify
npm run test:e2e -- --workers=3
```

Revert the website skip-link change and WebKit config/CI changes together if a
rollback is necessary; regenerate source manifests and rerun verification before
deploying the website. No app shell-cache bump or desktop replacement is needed
for this follow-up. Runtime rollback remains documented in
[RELEASE-0.30.0.md](RELEASE-0.30.0.md). Windows retains local signing without
public publisher trust; macOS remains ad-hoc signed and unnotarized. No paid
qualification service, dependency or subscription was added.
