# Earth Radio 0.29.1 qualification

Require the full existing verification suite, browser station/song regressions,
rendered matrix, standalone discovery/HLS/navigation and native auth/sandbox checks.
Website tests cover 320/390/768/1440-pixel layouts, keyboard navigation, install anchors,
images and complete-release/fallback behavior. Pure tests reject spoofed origins,
unsafe release URLs, missing assets and unexpected website worker files. The build
uses an explicit public source allowlist and bounded replacement directory.

Live qualification must independently verify custom-domain DNS/TLS, static content
and headers, both exact-source Pages deployments, real station/API behavior and a
new-origin account sign-in with the existing identity. Retain the original session
and verify collection sync without copying credentials. Hosted URL configuration must
preserve legacy/native returns; sender DNS must remain intact. Fixture tests alone
do not qualify hosted authentication, real audio or installed-device behavior.

Final live evidence belongs in release provenance and Spaces. Existing physical
Home Screen testing used an older preview; it does not prove new-domain installation.
Physical iOS/iPadOS account returns, physical Mac install/upgrade, public Windows
publisher trust, Apple notarization, all stations and human audio fidelity remain
outside automated qualification. Origin-local data does not migrate automatically.
