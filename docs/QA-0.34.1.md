# 0.34.1 search focus qualification

This patch addresses the strict qualification failure found after PR50, whose
workflow was green but browser report had 330 passes and two retry-dependent
results. Published v0.34.0 and every existing asset remain immutable.

Controlled timing probes on source715f997 reproduced two distinct causes in
Chromium and WebKit. A delayed native focus callback moves typing from the
visible palette input to its hidden legacy engine, leaving the intended query
empty and returning the full fixture catalog. A history toggle remains disabled
while IndexedDB is pending; immediate navigation before the operation starts
does not establish persistence. Once the write is acknowledged, history-off
persists correctly. Original accounts were not used or modified.

The patch gives the engine native hidden semantics while preserving its
programmatic value/event bridge. The visible station/country field receives
focus within the explicit open action, without a later focus handoff. Song
storage/privacy/account code is unchanged; its reload test now waits for the
actual stored policy and completed control state. A held native IDB callback
case retains the full persistence assertion.

Four desktop focus regressions failed before correction; the first eight
targeted focus/history/retention cases then passed. Expanded focus/composition
coverage includes phone and desktop widths in both engines. Patch identity is
0.34.1 with v77-search-focus and runtime index-d7add1ac.js. The existing frozen
place input was replayed against current model bytes: all 9,400 program-component
counts and eleven city minima are unchanged. Local qualification passed:

- `npm run verify`: 679 passed, three existing Windows skips; 448 deterministic
  manifest entries, source/staged app and website validation and lint passed.
- Complete Chromium/WebKit suite: 341 passed with three workers and retries
  disabled, including eight phone/desktop edit/composition regressions and the
  held native IndexedDB acknowledgement case.
- Rendered matrix: all 42 scenario contracts passed. Native Windows ARM64
  renderer, encrypted auth restart, sync adapter, sign-out recovery, single-owner
  lifecycle and normal-quit persistence checks passed using synthetic providers.
- Actual same-origin service-worker upgrade from0.34.0/v76 to0.34.1/v77 retained
  a fixture favorite and43% volume, removed the old cache and reloaded offline
  without autoplay or uncaught errors. The probe waits for worker activation;
  cache creation alone does not establish a completed installation.
- Thirty-five focused worker/model checks passed. No original profile was used.

Independent review found no P0–P3 defect and independently passed 56 unit checks,
60 browser cases without retries and 448 canonical Git hashes. PR #51 reviewed head
8bf7c4d and merged main 8b6875a each passed all ten checks and 341 hosted browser
cases with zero flaky results. Actual preview/production artifacts and headers,
10/15 routes, four app contexts, eight focus cases, 16 website contexts, offline and muted live playback
passed. Account-control visibility is separate from fresh provider sign-in.

All six final-source desktop packages and 13 draft/anonymous public downloads are
qualified and published. Both Windows guests retained favorites and 61%/37% volume
after two normal quit cycles without autoplay. The current website/guide update
has its own CI and served acceptance gate, pending at this revision. See the
[immutable release record](RELEASE-0.34.1.md) and [public receipt](provenance/release-0.34.1.json).

The change adds no dependency, provider, schema, credential, telemetry, paid
resource or new directory request. Ranking, station identities, audio intent,
counter and account/sync owners remain intact. Rollback restores a complete
coherent deployment and advances the shell on a forward correction; retain all
tags/assets and user profiles. Fresh live providers, physical devices/installers
and human audio fidelity remain separate from fixtures and native CI.
