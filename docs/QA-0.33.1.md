# 0.33.1 production Settings focus correction

The live production verification of 0.33.0 found a case that the auth-disabled
preview origin did not expose: the original account owner mounts its closed
dialog at startup. Settings incorrectly treated node existence as an open dialog
and bypassed its Tab containment. This affects keyboard containment, not provider
credentials, account identity, sync or playback.

The guard now uses the account owner's existing `hidden` flag. A hidden account
dialog permits Settings to contain focus; an open account dialog keeps its own
focus owner. The fixture now explicitly covers account enabled and disabled at
390px and 1440px in Chromium and WebKit. All four account-enabled cases first
failed; all eight Settings cases and four existing account focus cases then pass.
No account or provider setting was changed to reproduce or correct this case.

Version 0.33.1 uses coherent module URLs and worker `v75-settings-focus`, so an
installed shell can receive the correction. Runtime byte changes only advance
its embedded release identity and maintained-module imports. Map data and prior
desktop release assets remain unchanged. The integrity-bound place qualification
retains identical metrics, including 3,016 native records from one root read.

Local gates pass: `npm run verify` reports 652 passing tests, three existing
Windows skips and 425 deterministic hashes; all 278 browser cases pass at three
workers without retries; all 42 rendered scenarios pass. Windows ARM64 sandbox,
owned-origin, synthetic-provider PKCE/sync, OS-encrypted restart and normal-quit
lifecycle checks pass in isolated profiles. Fresh review found no issues; all ten
head and final-main checks pass. Actual preview and account-enabled production
verification pass on main `3ebd300af6d4189d3be3ee40e3f31f9560291b54`, including
104/104/19 served files, headers, fifteen routes and four live UI contexts. Google,
GitHub and email controls are present; fresh provider completion is not claimed.
Keep `docs/QA-0.33.0.md` as the original source qualification record; green fixtures
and previews alone did not establish the account-enabled production interaction.
The source branch's plan/ledger retain the observed production and four local
failures, then the green cases. Live provider login, physical devices, installation
upgrades and subjective audio fidelity remain separate acceptance.

Rollback uses a complete preceding Pages deployment with a fresh cache generation;
0.33.0 has the documented keyboard gap. No user-data migration, credential change,
store clearing or identity reset is required. Desktop distribution stays on the
immutable 0.32.2 release until the final phase3 build is independently qualified.
