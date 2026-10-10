# Release 2026-10-10 Canary BFCache

Status: HOLD — diagnostic browser validation pending
Release branch: `release/2026-10-10-canary-bfcache`
Base `main`: `acd54a70d969120b7f7401d83c99845ee7921d88`

## Candidate set

- #69: resume asset-canary remote monitoring after persisted BFCache restoration.
- Maintainer-approved diagnostic follow-up on release PR #325: preserve Photo capture failure phase/code/reason and include the capture module in browser source provenance. This is not an admitted fix for the intermittent PNG failure.
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

## Smartphone capture diagnostic follow-up

The original integrated head `c929c508d3f5f2a8dc8afb56dd366edb7d7c65a7`
failed the first desktop Smartphone shutter in job `114124918672`:
https://github.com/aldol2678/inhagame/actions/runs/38022039636/job/114124918672
The report retained only the generic PNG failure UI; it did not identify whether
frame waiting, readback or asynchronous encoding failed. A same-head retry passed,
which does not establish the failure's cause or prove a fix.

The diagnostic follow-up preserves bounded error code, phase, reason and elapsed
time in panel status and browser failure evidence. It also verifies the served
`photo-capture.js` hash. The 10-second deadline, capture ordering, lifecycle
cancellation, PNG/download/Album assertions and policy #322 remain unchanged.
No raw exception text, pixel contents, account information or telemetry is added.

Local verification: all 3,928 World tests passed, including nine new diagnostic
cases; focused capture/panel tests passed 48/48. The initial seven diagnostic
regressions failed before the implementation and passed afterward. World QA passed.
Local Chromium was blocked before boot by the executor's socket restriction.
The complete local Public CI aggregate did not finish its dependency-install step;
existing hosted checks on the new exact head remain authoritative and pending.

Release #325 stays Draft/HOLD. The underlying intermittent PNG cause remains
unknown. Passing this diagnostic candidate does not authorize main merge,
Production deployment, or removal of this hold.

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
