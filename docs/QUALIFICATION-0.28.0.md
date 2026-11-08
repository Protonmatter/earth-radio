# Earth Radio 0.28.0 qualification

This release changes tooltip presentation and local map rendering. Station directory,
playback, account, encrypted-session and sync contracts retain the 0.26/0.27 behavior.
The [release record](RELEASE-0.28.0.md) defines exact-source publication gates.

## Regression scope

Tooltip regressions cover 320/390/1440px viewports, Paper/Night palettes, long names,
pending and resolved metadata, safe card width and no autoplay from a hover.
Geographic-map regressions cover independent country/city toggles, persistence,
zoom detail, label collision, keyboard dismissal, palette changes, phone overflow,
no external tile-provider calls and missing-data fallback without blocking search.
Pure tests validate all generated geometry, data-only exports, provenance hashes,
deterministic simplification, localized/RTL labels and priority/zoom rules.

Existing browser regressions retain 500-station directory loading, offscreen search,
end-of-list selection, cached offline recovery, worldwide area searches, country
expansion, retry, deduplication, IME and similar-station behavior. The 42-scenario
Electron rendered matrix covers responsive layouts, dialogs, safe areas, RTL/locales,
keyboard navigation and zoom. Run the rendered matrix separately from the full
browser suite on this workstation to avoid competing browser resource pressure;
the readiness assertion is retained. CI jobs run in separate hosted workers.

The local verification logs/screenshots are retained under ignored `.build/`.
Final exact-head CI, production parity, desktop source/payload and public download
verification identities are recorded in release provenance and Spaces. A green
merge or uploaded artifact alone does not establish served acceptance.

## Limits

Fixtures establish application behavior. Live directory/stream samples establish
point-in-time responses, not all-station uptime or perceptual audio quality.
Natural Earth is generalized and does not cover every street/address. No map
subscription or provider quota is required; ordinary hosting limits still apply.

Live OAuth/SMTP configuration is unchanged. [Prior account evidence](QUALIFICATION-0.26.0.md)
remains applicable within its scope. Fresh outside-team identities, physical Mac
installation/upgrade, installed iOS/iPadOS account returns, publicly trusted Windows
signing and Apple notarization retain their documented qualification limits.
