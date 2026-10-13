# CI policy, runtime diagnostics and north walkway release

Status: CANDIDATE / FINAL EXACT-HEAD CI AND PRODUCTION READBACK PENDING

## Scope and admission

- Release base: `bfa08ad78f92fba51eb1a3978dd97a12182fc82c` on `main`. The original prepared base was `ea88ceaf1c813a0a9ea3f7056290bd5110e5552a`; concurrent #381, #379 and #377 main commits are preserved unchanged. #379 is already merged independently and adds no duplicate content.
- Included #379: `d436d8f5db161875930db53b7c589c1dab91fc7d`, eleven SEO classifier dependency trigger additions and regression coverage. Exact-head Public source/database/verify and affected browser checks succeeded; the SEO-only job was correctly skipped for the policy change.
- Included #311: `1dcd85d9370b82a32ea29a0992c45618e5a82f5e`, one exact photo QA documentation path becomes database-independent while full source checks remain required. Exact-head Public scope/source/database/verify succeeded.
- Included #340: `912a6d354464e6536029b631a587ab5f64c0ac5c`, local runtime diagnostics and user-initiated copy/download reports. Exact-head checks succeeded before admission.
- Included #365: `8f00074c8736a100bd229a1bd29a74e8bfd9698d`, the Building 5 / 60th Anniversary walkway, clocktower and south entry restoration. All 13 original exact-head workflows succeeded.
- Candidate source heads are unchanged. Their ancestry is preserved by this release integration. The #340 campus stylesheet conflict retains both current-main and diagnostics styles. The #365 hosted-QA test conflict retains both independent test additions.
- #370 and other pending candidates remain excluded. #381 and #377 were merged independently while this release was in CI; they are inherited from current main, not newly admitted or modified by this release.

## Verification boundary

- Final local combined CI-policy and hosted-scope contracts: 105/105 passed. Existing public verification gates, release/hotfix/full-ci overrides, fail-closed classification, permissions and unscoped core workflows are preserved.
- Final four-candidate runtime integration: 4542/4542 World tests, static QA, whitespace checks and actual PlayCanvas 2.22.4 NullGraphicsDevice landmark lifecycle passed. Earlier diagnostics integration also passed 100/100 focused diagnostics/input/HUD and 80/80 Jeongseok-related tests. NullGraphicsDevice results are not GPU/browser evidence.
- Necessary hall-hosted scope integration is bound to this exact release branch, immutable base, all four source-head ancestries and release manifest. Its runtime/data diff must equal the 18 reviewed paths. Extra/missing paths, wrong base, unknown extensions and missing manifest SHAs fail. Existing material, pixel and collision gates remain mandatory; dedicated walkway and diagnostics contracts also run.
- Local browser startup was blocked by executor socket permissions. It is not a browser PASS. The final exact-head Runtime diagnostics browser QA, North walkway exact-head QA, Hall and library integrated browser QA, all other triggered checks, and required Public verify must succeed before merge.
- Admission-head success does not establish success for the integrated result. The final Release PR to main is the authoritative integration gate and must run its normal full verification; no manual rerun, mass PR synchronization or gate weakening is intended.
- After main merge, confirm matching READY Production Git SHA, custom-domain readback, diagnostics smoke and new runtime-error review before reporting completion. Real-device testing is not claimed.

## Database, activation and privacy boundary

- No SQL, migration, schema, permissions, Production database, credential, deployment configuration or backend activation changes.
- No automatic report upload, remote telemetry transmission, personal identity export or new persistent diagnostics storage. Report copy/download remains a user action with bounded, allowlisted content.
- Current Jeongseok activation, pass rules, account-bound grants, inner-gate checks and exact-loopback preview guard remain unchanged.

## Rollback target

- Last verified Production base: `ea88ceaf1c813a0a9ea3f7056290bd5110e5552a`. Use that deployment as the rollback candidate if an independently authorized rollback is needed.
- Do not roll back to an older pre-guard deployment: that can restore the broader hosted-preview bypass. This release does not authorize a rollback or any database operation.


## Preserved failed comparison and baseline correction

- First integrated head `200c667bdd21485f87d20810fb4ecf307756b852` failed the unchanged walkway performance gate: [run 38328247904](https://github.com/aldol2678/inhagame/actions/runs/38328247904). Seven of 24 views exceeded one or more budgets. Keep its raw artifact as failed evidence; functional traversal and screenshots do not override that result.
- Its pinned comparison used `2b9a09615f7986e3d5e5b93d731fba21f33afbdd`, before the already shipped Jeongseok entrance. Independent PlayCanvas 2.22.4 geometry construction identified exactly +12 meshes, +3192 triangles and +248976 VRAM bytes from that existing entrance (BASE +5/+2124/+165672; NEAR +5/+984/+76752; DETAIL +2/+84/+6552). Those totals match the integrated candidate's resource increase relative to the earlier #365 candidate; BASE+NEAR matches the two C-view differences.
- The release-only baseline selector now requires the exact reviewed branch and base `bfa08ad78f92fba51eb1a3978dd97a12182fc82c`. Unknown release branches and mismatched bases fail. Standalone #365 retains its original immutable baseline. Both sides still use the same renderer, cameras, viewports, 12 warmup frames, 60 measured frames, synchronous GPU-completion protocol and all original budgets.
- This corrects a comparison confound; it is not a claim that runtime performance was optimized or that the failed run passed. The corrected exact-head comparison remains required before merge.

- Corrected local snapshot including current-main compatibility: World 4558/4558, policy/hosted/performance contracts 110/110, static QA and whitespace checks PASS. Runtime geometry and the measurement/comparison protocol are unchanged by the correction. This local result is not a corrected remote performance PASS.
