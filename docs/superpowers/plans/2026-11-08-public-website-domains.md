# Public Website and Domains Implementation Plan

> **For agentic workers:** Use the executing-plans workflow task-by-task. The owner delegated design approval and delivery; do not request another approval unless a new charge is introduced.

**Goal:** Publish the main website at earthradio.stream and the radio app at app.earthradio.stream with working sign-in and preserved old-origin data access.

**Architecture:** Two Pages projects, one repository. Static website sources/build stay separate from the application and its existing Functions. Explicit auth-origin/return changes retain the existing project, account and legacy/native flows.

**Tech Stack:** Existing Node/npm, vanilla HTML/CSS/ES modules, Cloudflare Pages, Supabase Auth. No new dependency or paid service.

**Spec:** `docs/superpowers/specs/2026-11-08-public-website-domains-design.md`

## Global constraints

- Main website earthradio.stream; app app.earthradio.stream; keep earth-radio.pages.dev functional.
- Sender DNS, provider credentials, identities, RLS and native loopback returns remain intact.
- Existing ivory/forest/copper brand; no fabricated proof, telemetry or external fonts.
- Static marketing project root website; no app Functions/bindings in that project.
- Only a new charge requires a question. Preserve old releases/deployments for rollback.

## Task 1: Trusted app origin and return configuration

Files: site/assets/auth-deployment.js, site/config.js, supabase/config.toml,
tests/auth-sync.test.mjs, tests/e2e/helpers.mjs, tests/web-origins.test.mjs.

- [x] Add failing exact-origin/host-spoof/root/native-preservation tests.
- [x] Export a pure exact-origin predicate and use it in runtime configuration.
- [x] Add exact new app roots to source Auth config, retaining old/native entries.
- [x] Run auth/core/native and origin tests; retain old-origin behavior.

## Task 2: Static website and safe release links

Files: website/index.html, website/styles.css, website/website.js,
website/release-core.js, website/_headers, website/_redirects, website/.node-version,
website/wrangler.jsonc, website/images/, scripts/stage-website.mjs,
scripts/validate-website.mjs, tests/website.test.mjs, tests/e2e/website.spec.mjs.

- [x] Test stable-release/link validation, missing assets, hostile URLs and fallback.
- [x] Build the stated design and copy existing guest screenshots/brand assets.
- [x] Stage an explicit static allowlist, copy public privacy/brand resources and
  validate references, headers, links and absence of Functions/secrets/local paths.
- [x] Add website lint/test/build commands to existing npm/CI verification; inventory
  source files in release manifest. Test responsive layout, keyboard and fallback.

## Task 3: Domain and hosted Auth setup

- [ ] Read current project/zone/Auth URL configuration; record nonsecret before state.
- [ ] After code qualification, create static Git-connected website Pages project
  with root website and correct build/output; preserve app project config.
- [ ] Attach owned apex/www to website and app subdomain to existing app project.
- [ ] Preserve sender records and compare DNS afterward. Verify Free plan/no add-on.
- [ ] Verify TLS; update hosted exact return URLs/Site URL without touching secrets.
- [ ] Test new-origin GitHub sign-in/cloud song sync and continued old-origin access.

## Task 4: Release and operations record

- [ ] Bump 0.29.1, version modules/fingerprint runtime, update docs and manifests.
- [ ] Run required local gates, independent review, commit/push and exact-head CI.
- [ ] Merge and match both production deployments to final main; verify served bytes.
- [ ] Build/qualify Windows ARM64, Mac ARM64/x64; publish draft, verify complete hashes,
  then publish and anonymously verify downloads without replacing prior releases.
- [ ] Update/read back Spaces, DNS/auth/rollback evidence and final receipts.

## Execution decisions and local evidence

- Use two Pages projects so public marketing requests remain static and the app API/quota boundary remains unchanged. No new dependency or paid service.
- Defer commits until the complete local regression set and independent review pass, following the owner’s delivery instruction.
- Local full verification passed: 449 tests, three explicit skips; 83 browser tests; 42 rendered scenarios plus seven standalone regressions; Windows native renderer and encrypted auth lifecycle; recovery importer; audit zero advisories. These do not establish hosted OAuth or physical device acceptance.
- The app hostname returned HTTPS 200 after its association with the existing project. The public website project and default Auth Site URL cutover follow exact-source CI.
