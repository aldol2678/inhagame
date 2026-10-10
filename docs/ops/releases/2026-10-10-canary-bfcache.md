# Release 2026-10-10 Canary BFCache

Status: INTEGRATION GATE
Release branch: `release/2026-10-10-canary-bfcache`
Base `main`: `acd54a70d969120b7f7401d83c99845ee7921d88`

## Candidate set

- #69 only: resume asset-canary remote monitoring after persisted BFCache restoration.
- Admitted exact head: `cb856d68e6132976025f19bba2bc8da836a673ba`.
- Candidate merge into release: `ade454d007a36a0167b03dfb6614a1e1a728c0f3`.
- Both required `verify` checks passed for the admitted head; no unresolved review threads.
- Preserved runtime patch and deterministic timeout regression. No unrelated feature changes.

## Known validation caveat

The admitted candidate's non-required Graphics integration browser gate failed at
`graphics-parallel-smoke.mjs:224`, "need actual rendered frames", before its first
reload/history navigation. Root cause is unresolved. The maintainer requested
merging after this failure was disclosed. This acceptance does not mark the
failure as PASS or waive required checks. Thresholds and protection stay unchanged.

Native three-cycle Chromium BFCache, one immediate GET and resumed polling,
real asset authority/production-canary/remote-kill browser gates, and Public CI
passed on the admitted head. The final integrated release receives fresh CI.

## Explicit exclusions

- All other feature, Draft, HOLD and stacked candidates remain excluded.
- Paused graphics/performance work and policy #322 are unchanged.
- No new performance acceptance, real-device GPU claim, or threshold adjustment.

## Production / DB boundary

No Production SQL, migrations, environment/credential changes, backend traffic
shifts, flag activation, rewards or real-account writes.
Only the normal Git-driven main deployment is expected.
The BFCache fixture has synthetic character authority; full Campus/Production
behavior is not established by that fixture alone.

## Integration and completion gates

- Admitted #69 exact-head required checks: PASS.
- Current main contributes only #324's Vercel build-selection changes.
- Final Release PR to main: required integration CI must pass before merge.
- After merge: verify main SHA, one matching READY Git Production deployment,
  custom-domain assignment, changed-surface readback and runtime-error review.
- Any unverified postcondition remains PENDING/HOLD.

## Rollback target

Last verified Production release serving base main
`acd54a70d969120b7f7401d83c99845ee7921d88`.
Reconfirmed READY and assigned to the Production custom domain before this release.
Rollback is not performed by this release.
