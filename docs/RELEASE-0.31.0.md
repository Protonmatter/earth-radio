# Earth Radio 0.31.0 directory and discovery reliability

This release addresses the five highest-impact findings in the November 8 review:
directory startup fan-out, fuzzy matches above exact results, repetitive opening
stations, missing map positions and large map-data precaching. The design, finite
network boundary, data provenance, qualification limits and rollback are in
[DISCOVERY_RELIABILITY.md](DISCOVERY_RELIABILITY.md).
The qualification scope and repeatable gates are in
[QUALIFICATION-0.31.0.md](QUALIFICATION-0.31.0.md).

The web app uses an hourly, demand-refreshed same-origin edge snapshot with stale
fallback and ETags, not an R2/Cron index. It adds no paid resource or new dependency.
Desktop and fallback paths use validated server discovery and fail a bad mirror
before launching country requests. Search keeps station UUIDs intact, protects place
terms from fuzzy correction, discloses genre corrections and diversifies the empty
best-match view. Country-level map positions are explicitly approximate and are
excluded from precise area filtering and stored station/account records.

The v65 shell omits all large map modules from precache, caches the canonical root
for offline navigation, and uses coherent 0.31.0 module URLs. Large geography has
content hashes and immutable caching; old loader URLs redirect to identical data
for already-open tabs. Existing playback, favorites, provider sign-in and cloud
document schemas are preserved.

Publication requires the full local/browser/native gates, real cold/warm Cloudflare
preview/cache checks, all ten exact-head checks, both production deployment readbacks,
Windows ARM64 installer/portable and Apple Silicon/Intel macOS builds, signing/DMG
checks, source-payload comparison and anonymous asset checksums. Final receipts and
Spaces must distinguish those results from fixtures and physical-device limits.
Windows retains local signing without public publisher trust; Mac builds remain
ad-hoc signed and explicitly unnotarized. Preserve prior release assets/tags.

Rollback restores the coherent prior runtime/modules/Functions with a newer shell
generation and reruns all gates; published assets are not replaced. Retain the
metadata limiter and strict-public network flag. No identity or credential reset
is part of this rollback.
