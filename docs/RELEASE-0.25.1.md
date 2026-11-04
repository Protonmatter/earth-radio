# Earth Radio 0.25.1 — safe-area correction and Git delivery

This patch follows the [qualified 0.25.0 release](RELEASE-0.25.0.md). The user
explicitly authorized committing/pushing the release, passing CI and merging
into main so GitHub and production agree. Delivery is tracked in
[pull request #17](https://github.com/Protonmatter/earth-radio/pull/17).

## CI defect and correction

Windows CI twice captured a phone header with a 47px top inset, 56px total height
and a poisoned `--er-header:9px`. `syncChromeMetrics()` subtracts the inset to
measure content depth; accepting a transient small measurement let the header's
own min-height reuse it and latch the clipped layout. Runner screenshots showed
the controls partly hidden. This was an application measurement defect, not a
reason to disable or weaken the rendered assertions.

`responsive-ui.js` now floors measured header content depth at the existing 56px
CSS design baseline. The existing half-viewport guard still ignores full-height
desktop rails. Navigation measurement and public interfaces remain unchanged.
A deterministic rendered scenario injects the observed 9px value: before the fix
the header stayed 56px and failed; afterward it recovers to 103px, with all visible
header controls below the 47px safe area and inside the header. The matrix also
asserts that containment for the existing phone/standalone scenarios.

CI now retains failed rendered evidence for seven days and includes safe-area
values/chrome measurements in assertion diagnostics. These artifacts use only
the existing offline fixture profile. No product telemetry or dependency was added.

## Artifact identity and delivery

- Package/runtime: **0.25.1**; content-fingerprinted runtime `index-ff42f3f1.js`.
- Service-worker generation: **v52**, `earth-radio-shell-v52-safe-area-0-25-1`.
- Maintained overlays revalidate and are reloaded into the new shell cache.
- The private quota Worker/configuration remains the qualified 0.25.0 implementation.
- Setup and portable builds are rebuilt with the same user-approved local signer
  and timestamps. Public Windows trust remains deferred; neither Root store is changed.

The initial PR and diagnostic commits did not merge because Windows CI failed.
The corrected head must pass Linux/Windows verification, browser e2e, database
and Auth workflows before merge. GitHub's exact PR/main check results are the
authoritative remote CI record. The Git-triggered production deployment must
match its main commit and the tested staged artifact; do not rely on the earlier
working-tree source label. The prior 0.25.0 direct deployment remains historical.

## Qualification and boundaries

The patch is validated with `npm run verify`, `npm run test:e2e -- --workers=2`,
`npm run test:rendered` (now 42 scenarios), the sandboxed file-renderer smoke,
and final desktop source/payload/signature checks. Exact final build hashes and
remote delivery observations are attached to the ignored qualification evidence
and the release PR. No executable, private signing material, CLI credential or
local qualification log is committed.

Fresh local checks passed: **386 Node tests / one Windows symlink-policy skip**,
**49 browser e2e tests**, all **42 rendered scenarios** and the real sandboxed
file-renderer/Origin smoke. The final packaged app matches all **59 current
application source files**; both setup and portable archives match all **87
signed unpacked payload files**. Both artifacts identify version 0.25.1 and carry
the accepted local signer plus DigiCert RFC3161 timestamp. Windows still reports
the untrusted local root; no public trust is claimed. Installer behavior itself
was qualified with the unchanged packaging configuration in 0.25.0; the patch
checks source/payload/signature parity rather than claiming a repeated install matrix.

Final Windows ARM64 artifacts are under ignored `.build/qualification/desktop-0.25.1-final/`:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `EarthRadio-Setup-0.25.1-arm64.exe` | 97,886,816 | `3d044cfa103cd5e52bebd4dd93539fcbfde378eb38ca85dc82aa4c603bdb974d` |
| `EarthRadio-Portable-0.25.1-arm64.exe` | 97,579,280 | `a9617cf1bf6e82b05c32924f184df47aeab995a9e3e5e1fa88e4389de87b491e` |

The earlier live provider, station/audio, quota and isolated installer qualification
remains bounded evidence described in RELEASE-0.25.0.md. A Git/CI success does not
re-prove OAuth consent flows, every station, perceptual fidelity or installed PWA
behavior. The precise physical device/OS and screen-lock audio result remain
unreported. Signing stays local-only by user choice. No paid recognition provider,
plan upgrade, schema change or unrelated authentication setting is introduced.

## Public installer publication

The user authorized a GitHub Release for `v0.25.1`, Windows ARM64 setup/portable
uploads, macOS installers and iPhone/iPad web-app instructions. The release tag is
pinned to application commit `a42187c5e667f5687e57494bac996c8d096ff068`; later
packaging tools/docs do not retag or alter that application source.
The user explicitly selected clearly labeled unnotarized macOS builds because no
Apple Developer ID/notarization credentials are configured. The read-only native
macOS workflow builds arm64 and x64 separately from that exact application commit,
checks source/tag identity, disk-image integrity, code signatures, packaged source,
native architecture and bounded startup. Its candidates are uploaded to Actions;
the authorized release publisher verifies and uploads assets separately.

The [installation guide](INSTALLATION.md) is also attached to the release. A single
SHA256SUMS.txt covers all uploaded installers and that guide. Windows publisher
trust remains local-only; macOS ad-hoc signatures do not provide Apple identity or
Gatekeeper/notarization approval. Native runner startup is not a full physical-Mac
or audio-device qualification. See the release page and packaging workflow runs
for final asset identities and observations.

## Rollback

Follow [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md). Preserve guarded
Functions, the durable quota binding and explicit environment scope during any
UI rollback. A header-only fallback can use the qualified v51 static artifact
with current guarded Functions; never restore an old unguarded deployment or
delete the quota namespace. Preserve the original desktop installation/profile.
