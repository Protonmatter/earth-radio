# Public and Desktop Authentication Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Public Google/GitHub/email signup and secure Windows/macOS sign-in/sync,
qualified with separate automated and live end-to-end evidence.

**Architecture:** System-browser PKCE returns to a short-lived loopback listener.
Electron main owns tokens and encrypted persistence; a validated, token-free IPC
adapter lets the existing renderer account/sync engine operate unchanged in scope.

**Tech Stack:** Existing Electron 43.4.1, Node 24.18.0, native WebCrypto/HTTP,
Electron async safeStorage, Supabase Auth/PostgREST, existing Playwright/GoTrue tests.

**Spec:** `docs/superpowers/specs/2026-11-04-public-desktop-auth-design.md`

## Global Constraints

- No new project dependency, private key/token in Git, plaintext session file or telemetry.
- Keep sandbox/context isolation and the original application/profile intact.
- Hosted production signup/config changes are scoped to the user's explicit request.
- Preserve forced per-user RLS and required metadata quota bindings.
- Retain local Windows/ad-hoc unnotarized macOS signing decisions unless the user changes them.
- Old release tags/assets remain immutable; ship new native-auth functionality separately.

## Review Focus

1. A malicious renderer/frame or forged callback must not access another account or tokens.
2. Starting a second flow, closing the app or replaying a URL must not revive a stale flow.
3. Encryption failure/keychain lock must not silently persist a plaintext refresh token.
4. Logout/account switch during refresh/sync must not restore the prior account's state.
5. Local fixtures and a recovered live session must not be reported as public signup qualification.

## Task 1: Hosted public-provider readiness

- [x] Read project health/advisors and current public signup/provider settings.
- [x] Inspect SMTP dashboard; confirmed custom SMTP off.
- [x] Inspect Google audience/scopes and hosted GitHub configuration; live owner returns succeeded.
- [ ] Resolve sender-domain/service prerequisites, configure verified transactional email,
  preserve confirmation and verify outside-team delivery with a user-owned inbox.
- [x] Add and verify the narrow native loopback redirect entry after callback design is implemented.

## Task 2: Native callback and encrypted vault

**Create:** `electron/auth-callback.mjs`, `electron/auth-vault.mjs`.
**Tests:** `tests/desktop-auth-callback.test.mjs`, `tests/desktop-auth-vault.test.mjs`.

- [x] Write failing tests for exact Host/path/method, duplicate/expired/replayed returns,
  unrelated invalid requests, cancellation, port lifecycle and request-size limits.
- [x] Implement a one-active-attempt loopback callback with bounded lifetime/cleanup.
- [x] Write failing encrypted-vault tests for corruption, unavailable encryption,
  atomic updates, ordered refresh/logout writes and absence of plaintext on disk.
- [x] Implement asynchronous OS encryption with in-memory flow storage and an explicit flush gate.

## Task 3: Main-process auth and restricted IPC

**Create:** `electron/auth-manager.mjs`, `electron/auth-ipc-policy.mjs`.
**Modify:** `electron/main.mjs`, `electron/preload.cjs`, `site/assets/auth-core.js`.
**Tests:** `tests/desktop-auth-manager.test.mjs`, `tests/desktop-auth-ipc.test.mjs`.

- [x] Add minimal PKCE client hooks while preserving web default redirect behavior/tests.
- [x] Reuse the client in main with fixed public config, external-browser opening and secure vault.
- [x] Implement provider/email/link/logout/session operations and safe display metadata.
- [x] Restrict read/RPC operations, document keys, expected-user identity and body sizes.
- [x] Enforce owned top-level sender/document validation; refuse raw token/URL/RPC access.
- [x] Test errors, callback failures, overlapping attempts, persistence/restart and logout races.

## Task 4: Shared config and renderer adapter

**Create:** `site/assets/auth-deployment.js`, `site/assets/desktop-auth.js`.
**Modify:** `site/config.js`, `site/assets/auth-ui.js`, `site/sw.js`, deployment validators/tests.

- [x] Move existing intentionally public auth config without adding a secret or duplicate private config.
- [x] Select native IPC adapter only for the genuine desktop file context; exclude web previews.
- [x] Preserve the current account namespace and sync engine; explain external-browser/email state.
- [x] Exercise signup/sign-in/logout/account switch, offline behavior and cross-client sync.
- [x] Fingerprint changed runtime only if edited, bump shell generation and update provenance/hashes.

## Task 5: End-to-end and delivery

**Extend:** local GoTrue workflow, native Electron auth harness and native macOS workflow.
**Update:** `docs/SUPABASE.md`, `docs/ARCHITECTURE.md`, installation/release/build records.

- [x] Run parser/lint/unit/integration checks and relevant browser/rendered suites.
- [ ] Run native sandbox + real OS vault + loopback/GoTrue/Mailpit + sync E2E on Windows/macOS.
- [ ] Complete live Google/GitHub/email return tests with authorized identities; verify fresh signup
  and remote data across web/desktop, including account isolation and logout.
- [x] Obtain independent auth/security review and resolve actionable findings.
- [ ] Build/sign/qualify updated Windows/macOS artifacts and test the installed/portable auth path.
- [ ] Commit/push/review/merge under existing release authorization after CI passes, deploy and
  verify updated web/desktop delivery. Record exact results and remaining external blockers.

Qualification note: native OS/renderer tests use synthetic provider HTTP; the same manager is separately tested against real local GoTrue/Mailpit/PostgREST in Linux CI. Live Windows provider returns are distinct evidence. Public SMTP, fresh outside-team signup, physical Mac consent and final release publication are not inferred from those tests.
