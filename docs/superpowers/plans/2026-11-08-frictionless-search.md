# Frictionless Search Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task. One fresh-context whole-branch review at the end. The owner delegated design choices and delivery; only a new cost requires another question.

**Goal:** Make station finding consistent, quick to refine, and easy to recover.

**Architecture:** One maintained ranker, shared query/scope presentations and existing
country expansion. Searchable facet widgets enhance named native controls; explicit
chips/recovery operate through current filter/view adapters.

**Tech Stack:** Existing Node/npm, vanilla ES modules, HTML/CSS, Leaflet, Playwright,
Electron, Cloudflare Pages and existing Supabase. No new dependency/service.

**Spec:** docs/superpowers/specs/2026-11-08-frictionless-search-design.md

## Global Constraints

- Preserve playback, accounts, favorites, mapped/unmapped stations and bounded loaders.
- Keep queries at 160 characters, facets bounded, suggestions at most 24 DOM options.
- No implicit autoplay, new history storage, tracking, dependency or subscription.
- 44px targets; IME, keyboard, safe areas, RTL, zoom and selected-facet retention.
- Keep release/import graph coherent and preserve published tags/assets.

## Review Focus

- Rapid typing/Enter/composition must not activate an earlier station.
- Country refresh after cancellation must not restore hidden filters or lose neighbors.
- Missing selected facets and zero-result combinations must remain reversible.
- Country aliases must never conflate North/South Korea or unrelated short words.
- Cached documents must reflect mutated station metadata and not change explicit sorts.

### Task 1: Pure search and facet behavior

Files: site/assets/search-core.js (new), discovery-core.js; tests/search-core.test.mjs
(new), discovery-core.test.mjs. Preserve fold/rank/pick/similar interfaces.

- [x] Write failing tests for exact-title priority, transposition, region/format,
  country/language/tag aliases, connecting terms, mutation-safe caching and suggestions.
- [x] Implement pure bounded canonicalization, country matching, query terms and facet
  suggestion ordering; cache normalized documents with a value signature.
- [x] Watch tests pass; run existing discovery/country and network boundary tests.

### Task 2: Shared search interactions

Files: discovery-ui.js, responsive-ui.js, index.html, runtime adapter;
facet-picker.js, search-controls.js, search-controls.css (new); E2E search suite.

- [x] Add failing browser cases for shared query/scope and correct late Enter/IME.
- [x] Mirror query via explicit discovery/search-open events; render palette from the
  ranked pool. Reuse country expansion with code/name matching before result limits.
- [x] Add searchable comboboxes backed by native selects, with focus/keyboard/IME,
  bounded safe options/counts and selected-value retention after catalog refresh.
- [x] Add active chips, query clearing, query-preserving filter reset and geographic
  conflict handling. Route scope changes through existing view/filter callbacks.
- [x] Verify each regression, then all existing browser and rendered scenarios.

### Task 3: Qualification and delivery

Files: package/lock, current module references/runtime/SW, provenance/manifests,
docs/DISCOVERY.md, README, release/qualification/installation docs and website links.

- [x] Advance 0.30.0 and shell, version imports, fingerprint audited runtime changes.
- [x] Run npm verify, browser, rendered/standalone, native sandbox/auth, recovery and
  audit checks. Inspect actual phone/desktop geometry and live directory behavior.
- [x] Fresh independent whole-branch review; fix blockers and rerun affected gates.
- [ ] Commit/push only the tested scope; exact-head CI, merge, exact-source production
  parity, matching Windows ARM64/Mac ARM64+x64 release and anonymous checksums.
- [ ] Update/read back Spaces and preserve prior assets and account sessions.

## Execution ledger

- Ruling: design/implementation decisions are delegated and cost-only questions remain
  in force; no approval ceremony — avoids stopping authorized work.
- Ruling: use inline execution and a final fresh reviewer; no implementer agents.
- Ruling: defer commits until full regressions pass, matching the owner's earlier
  release instruction; retain intermediate evidence under ignored .build paths.
- Base: 5a85bc509b89fae52b154a3d2fe30a5008422d32; clean feature/frictionless-search.

- Validation: pure behavior and focused browser gates passed; review found and
  verified fixes for pending-reset ownership, async country highlight identity
  and retired ISO inference. Country focus now reuses the existing single-flight
  index; selecting new coverage remains explicit. Full final gates precede commit.
