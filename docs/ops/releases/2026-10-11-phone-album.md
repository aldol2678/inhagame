# INHA WORLD Release · Phone Album Manager

## Scope and provenance

- Release train: Short Release Train (normal one-candidate batch)
- Release base main: `82538ea1dfd4b3f82123673786ab052a76fc1a7c`
- Admitted source: PR #342, exact head `df88b6090ae1a4b3ddbb5b160bef598f2d6296de`
- Admission: PR #342 Ready for Review (not Draft); 5 exact-head PR workflows SUCCESS, including required verify and real Chrome browser ZIP QA.
- Included: account-isolated phone album storage statistics, bounded original-image ZIP export, multi-selection, progress/cancellation and associated tests.
- Source changes: exactly nine files from source PR #342, preserved as matching blob SHAs. This manifest is the only additional release file.
- Exclusions: PR #337 (boot recovery), #340 (runtime diagnostics), #314 (collision validation), other Draft/HOLD candidates. Do not cherry-pick or independently merge unrelated branches.

## Integration and verification

- PR #342 was based on main `952a826c3a38d4dd88f2d5fe316cacc9c9b41dd6`. Main advanced to `82538ea1dfd4b3f82123673786ab052a76fc1a7c` solely by Housing QA workflow path scoping (#339). The source files in #342 do not overlap the intervening main change.
- This release branch starts at the exact current main base and applies only the reviewed nine source blobs plus this manifest.
- Required gate: final integrated release PR → main must pass required `verify` and all triggered checks; no bypass.
- Physical-device QA: **explicitly waived for this release by the user**. Chromium desktop/portrait/landscape browser acceptance is evidence of emulated behavior, not physical Android/iOS acceptance.
- Known constraints: ZIP <= 100 photos and <= 32 MiB original bytes, images <= 16,777,216 pixels; ZIP generation in bounded browser memory. OS disk persistence cannot be confirmed from browser JavaScript. Existing capture limitation in Chromium Headless Shell remains documented; installed Chrome acceptance passed.
- CI evidence for PR #342 exact head: Public local checks (38114306161), Smartphone integration browser QA (38114306136), Private character acceptance (38114306158), Mounted Photo + Maps browser QA (38114306188), Life housing candidate browser QA (38114306120).

## Database and activation

- No Production SQL, migrations, credentials, permissions, server/backend traffic changes or feature-flag activation.
- Existing IndexedDB v1 schema retained; export is read-only. No automatic photo deletion.
- Deploy only via standard Git-triggered Vercel Production on main after protected release PR merge. No Preview/manual deploy.

## Rollback and postconditions

- Pre-release main commit: `82538ea1dfd4b3f82123673786ab052a76fc1a7c`.
- Previously READY Production deployment as rollback candidate: `dpl_4e779CfBopYjsAn2edxAYjamZfN2` at commit `952a826c3a38d4dd88f2d5fe316cacc9c9b41dd6` (the subsequent main commit deployment `dpl_qSgGYPR1eSsEnoo9k6s8ai2ZZA6X` was CANCELED).
- After main merge: verify exact main SHA, one Git-triggered Production deployment READY at that SHA, inhagame.app alias/readback, and phone album loading/download entry plus Production runtime error state.
- If any postcondition fails: treat rollout as PENDING/HOLD and investigate; rollback requires separate decision.
