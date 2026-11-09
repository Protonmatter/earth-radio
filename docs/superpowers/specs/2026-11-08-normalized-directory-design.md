# Normalized directory and stream selection

This pass implements the four priorities in the v0.31.0 follow-up review under the
owner's standing implementation/release authority. Preserve existing account,
station UUID, favorite, playback and deep-link contracts. No paid resource,
dependency, credential, telemetry or authentication change is authorized here.

## Data publication

An hourly GitHub Actions producer fetches Radio Browser through validated discovery,
normalizes public station metadata and publishes a complete validated generation to
the public repository's free GitHub Pages artifact service. A failed producer leaves
the last good deployment intact. The publisher never writes source branches and
uses only an ephemeral Pages/OIDC workflow identity. There is no generated data
branch, hourly Git-history growth, saved deployment key or Cloudflare build exclusion.
The static artifact is bounded to 128 MiB. Hosting remains subject to the service's
published free limits; do not represent it as unlimited or activate paid capacity.

Keep the existing v1 flat response shape for old clients. Add a versioned grouped
catalog response for the new client, with all original UUIDs represented as stream
or alias IDs. Precompute bounded per-country files and the country index. A small
manifest carries content hashes, sizes, counts, producer identity and generation
time. The Pages reader streams these published files using their content hashes as
ETags; request-time clocks never identify snapshot content. The browser displays the
snapshot update time and stale state. Direct Radio Browser and IndexedDB remain
explicit fallback paths. Scheduled execution is best effort, not an hourly SLA.

Normalize country codes using directory names and unambiguous sibling evidence;
retain unknown when evidence conflicts. Clean tag aliases and generic noise. Keep
HTTP streams explicit and selectable on desktop; identify HTTP-only choices in the
web UI. Reject malformed identities/URLs, credentials and invalid coordinates.
Never invent transmitter coordinates or silently map unknown countries to a point.

## Variant identity and interaction

Group case/punctuation-equivalent station names within a country, respecting
conflicting regions. Collapse identical stream URLs into one quality choice while
retaining their UUID aliases. Different regions, programs and countries remain
distinct. Grouping is a presentation projection over an addressable stream catalog.
Favorites and old links retain original IDs; no new cloud document schema is needed.

Render one result card with an accessible stream/quality picker. Selecting a quality
before playback does not autoplay. During playback or pause, choosing a quality
prepares the next explicit Play action. Playback recovery tries untried sibling streams within a fixed
budget before the existing different-station recovery. Surface a clear message.
Test selection, favorite membership, old alias links, search, map, recent history,
keyboard focus and interrupted refreshes together.

## Regression corrections

The Antarctica cluster is reproduced from explicit upstream AQ rows with missing
coordinates, not unknown-country fallback. Exclude presentation positions outside
the atlas latitude range (-60 to 85 degrees), while retaining those stations in the
list. A height-aware minimum Mercator zoom and bounded center keep the actual view
inside that range after initial layout, resize, pan and fit actions.

Catalog success is persistent status, not a toast. Remove that transient message;
other toasts sit above the player/navigation and do not intercept pointer input.
Verify actual rendered geometry at phone and desktop sizes.

The production browser contains an injected Cloudflare beacon despite the self-only
script CSP. Apply the existing no-transform document policy to application HTML,
which Cloudflare documents as preventing automatic injection. The marketing site
already uses this policy. Preserve analytics history and the self-only CSP. Verify browser console/DOM
behavior as well as served headers; curl alone does not prove browser injection state.

## Qualification and rollback

Run existing verify, E2E, rendered, native renderer/auth/lifecycle and audit gates.
Add adversarial normalization/grouping/publication tests and real edge checks for
stable ETags, timestamps, malformed files, stale generations and provider outages.
Retain the strict-public boundary and metadata limiter. Review source independently
before exact-head CI/merge. Deploy and compare full production files/headers, rebuild
Windows ARM64 and both Mac architectures from final main, publish a new immutable
release and verify draft/public checksums. Update Spaces with every material action.

Rollback is a coherent source/module/reader change with a newer shell generation,
plus redeployment of a prior validated static data artifact. Stop the
hourly workflow if publication is faulty. Preserve existing releases, source history,
accounts, vault entries and local collections. No account reset or credential change
is a rollback step.
