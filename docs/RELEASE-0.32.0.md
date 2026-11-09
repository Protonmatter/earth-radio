# Earth Radio 0.32.0 normalized directory and station variants

This release addresses the four priorities in the v0.31 follow-up: duplicate stream
cards, request-time raw snapshots, catalog-toast/Antarctic regressions, and injected
Cloudflare beacon CSP errors. It preserves original station UUIDs, favorite records,
account documents and provider configuration.

The directory publisher is separate from source history and runs hourly through
the public repository's free GitHub Pages artifact deployment. It produces normalized
global/country data, conservative country derivations, clean tags, explicit HTTP
transport, grouped streams and legacy compatibility files. Content SHA-256 defines
stable ETags; generation time is separate. Publication and reader failure paths
retain last-good data. See [operations and rollback](DIRECTORY_PUBLICATION.md) and
[runtime behavior](DISCOVERY_RELIABILITY.md).

Browse/search/map show one matching program per country/region, with an accessible
stream selector that prepares the next explicit Play action. Original UUID links
and saved alias favorites remain usable. Up to three distinct siblings can be tried
on failure before existing station recovery. HTTP-only streams are disclosed.
Catalog success is persistent status; action/error toasts remain above player/nav.
The actual map viewport stays within -60..85 latitude after resizing and map actions.
The v66 shell retains lazy immutable map data and coherent 0.32.0 module URLs.

Public Windows publisher trust and Apple notarization are unchanged: Windows builds
use the accepted local signer; Mac installers are ad-hoc signed and explicitly
unnotarized. Preserve all earlier tags/assets. Installation instructions cover Windows
ARM64, both Mac architectures and Safari Home Screen installation on iPhone/iPad.

Publication requires local verify, browser/rendered/native/auth checks, independent
review, ten exact-head checks, real preview reader/header/CSP checks, final-main CI,
production byte readbacks, Windows payload/signature checks, both final-main Mac DMG
receipts and anonymous download checksums. Record actual outcomes in release
provenance and Spaces; this document alone does not assert completion of those gates.
Physical iPhone/iPad/Mac installs, original-profile installer upgrades, outside-user
signup, screen-reader audition and audio-fidelity measurements need separate evidence.

Rollback redeploys a prior verified directory artifact and coherent app source with
a newer shell generation. Disable a faulty publisher schedule while repairing it.
Retain current rate-limit bindings, strict-public routing and all account data.
Never reset identities, rotate credentials, rewrite source history or replace
published release assets as part of this rollback.
