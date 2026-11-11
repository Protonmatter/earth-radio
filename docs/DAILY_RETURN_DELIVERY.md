# Playback intent and delivery sequence

## Current candidate: ER-01

A direct station action owns a program, including its grouped stream variants.
All sibling attempts share one 7.5-second connection budget. Exhaustion pauses the
player and exposes **Try again** and **Play something similar**. Similar changes
program only after its explicit button activation. Failed attempts do not publish
the successful station-selected event or add a successful listening record.

Only **World Scan** grants automatic cross-program selection. Each transition
commits the row selection and hash, updates player and Media Session identity,
and names the new program in the notification. Previous/next, map selection,
Continue, quality selection and a normal row action retain station intent.

The maintained `playback-intent.js` policy is memory-only and has no network,
account, sync or storage access. `discovery-ui.js` owns grouped retry state and
failure controls. The audited runtime supplies the audio/route adapter. Pause
invalidates pending media work; old source, HLS import, reconnect and timer work
cannot publish a newer selection's outcome. The recovered TypeScript files are
updated as a maintenance reference; they are not a reproducible bundle source.

### Verification

```powershell
node --test tests/playback-intent.test.mjs
npm run test:e2e -- --project=chromium playback-trust.spec.mjs
npm run verify
npm run test:e2e
npm run test:rendered
```

The focused browser suite uses the actual HTML media element with controlled
stream failures and generated WAV data. It covers exhausted siblings, a hung
stream deadline, pause cancellation, retry, explicit Similar, World Scan,
stale attempts, previous/next and identity agreement. This establishes client
behavior, not public station availability or audio quality on physical devices.

### Rollback

Before publication, discard only this branch or revert its commits. After a
release, restore the preceding complete Pages deployment and ship a follow-up
cache generation; never reuse an immutable runtime filename for different bytes.
Do not remove account data, rewrite favorites/UUIDs, or replace prior desktop
release assets. Desktop rollback uses the preceding version's published installer.

## Approved delivery order

1. ER-01 playback intent and ER-02 confirmed-play click reporting as separate PRs.
2. ER-07 real route/crawler responses; free ER-13 release fallback and Windows x64.
3. Minimum verified place/time model, then ER-03 Today and ER-05 place-first copy.
4. ER-06 Passport, ER-11 Media Session, ER-09 share routes, ER-10 installation.
5. Broader ER-16 locations, ER-14/15 performance/logos, then ER-04/08 atlas/SEO.

Each phase needs its own acceptance evidence. Changes to live authentication or
schema must preserve the original account, local collections and supported sync.
Passport cannot infer historical duration from Recent. Use IANA time zones and
explicit location provenance; never manufacture city precision to meet coverage.

New paid services/signing require cost approval. Analytics and notifications
remain separate opt-in product decisions; this roadmap does not enable either.
