# Settings account focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contain Settings keyboard focus when the existing account UI is enabled.
**Architecture:** Respect the original account modal hidden-state flag rather than node existence; change no account or player owner.
**Tech Stack:** Existing ESM, Playwright, npm/Electron.
**Spec:** ../specs/2026-11-11-settings-auth-focus-design.md

## Global Constraints
- Preserve original account/provider/session/sync and all playback/loader interfaces.
- No dependency, resource, credential, permission, analytics or notification change.
- Coherent0.33.1 module URLs/freshv75 worker; previous release assets immutable.

## Review Focus
- Mounted hidden account dialog cannot disable Settings trap.
- Visible account dialog retains its own focus handling.
- Escape/Close restores a visible invoking control in both viewport layouts.
- A returning installed worker receives coherent versioned modules.
- Provider discovery or account sync resolving late cannot steal Settings focus.

## Task 1: Correct and qualify visible-modal priority
- [ ] Add account-enabled Settings cases via maintained fixture; observe RED at both widths/engines.
- [ ] Change only visible-account guard and prove GREEN with account focus regressions.
- [ ] Advance coherent0.33.1/v75, refresh fingerprint/model/provenance/manifests and docs.
- [ ] Fullverify,allbrowser/rendered/native, then one fresh read-only wholebranch review and covering fixes.
- [ ] Commit/push/attachPR, exactheadCI+preview; mergeauthorizedexacthead, finalmain/actualproduction+Spaces, resumeER05.
