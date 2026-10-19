# PHONE-LEARN-01 / STACK-REPAIR-01

Status: code/branch repair only; both PRs remain Draft and unmerged. Exact final SHAs and CI links are recorded in each PR description, outside the commit whose SHA they identify. No Production action is authorized here.

## Baselines and recovery

Verified remote main: `1a8466a2bb715dcc44aad3dece83e358ec442ca1`.
Original #429: `c773b137ec9252573e519dd025c670774c086bbc`; original #430: `3ece3cf298eca7ed2e03ed7dc3d7b4fcf0c6d068`.
Before rewriting, local refs `refs/backup/stack-repair-01/r1a` and `refs/backup/stack-repair-01/r1b` plus a verified complete Git bundle preserve both original histories. Only the two named task branches may be updated; main is untouched. Any rewritten child push requires its original exact remote HEAD lease.

## Ownership and import boundary

| Finding | #429 parent | #430 child only |
| --- | --- | --- |
| F-01 | engine save outcomes, progress stale-write protection, local save states, result/retry/backup UI, active-session unload warning | outbox, cloud states, ACK/readback, account-pinned requests |
| F-02 | local recovery helper, immutable copies, cap/backup/explicit cleanup | cloud archive extension; coalescing and stable retry UUID; server request limits |
| F-03 | pure learning-contract module, strict local load/import, explicit legacy conversion, shared synthetic vectors | SQL validator and shared-vector RPC parity tests |
| QA | original learning/Phone tests unchanged; review/remediation Node and browser tests, local-only workflow | cloud Node/real Auth browser/API tests, RLS/SQL suites and cloud CI job |

The parent's controller imports content/progress/engine/speech/view only. Progress imports content/contract/local recovery. The view uses the supplied local save state. No parent module needs a cloud symbol or SDK. Its recovery helper recognizes local keys only; child extends it to account-scoped cloud archives. Parent still forbids learning RPC use in its original source-authority test. Both native modules and test fixtures remain inert until approved content is available.

## Reproduction and acceptance evidence

On a detached original-parent checkout, copy the first three remediation regression tests and `phone-learning-review.test.mjs` from the repaired parent, then run both files: **8 failures / 0 passes**. Failures expose ignored save errors, permissive malformed JSON, no recovery limit, stale overwrite/import rollback, future-version import, missing independent recovery snapshots and missing randomUUID fallback. The original tests are not deleted or loosened.

Repaired parent:

```sh
node --test apps/world/tests/phone-learning*.test.mjs
node --test apps/world/tests/phone-*.test.mjs apps/world/tests/daily-quiz.test.mjs apps/world/tests/daily-panel-focus.test.mjs apps/world/tests/daily-reward-readback.test.mjs apps/world/tests/pwa-shortcuts.test.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 PHONE_HEAD_SHA=$(git rev-parse HEAD) node apps/world/tests/browser/phone-learning-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 PHONE_HEAD_SHA=$(git rev-parse HEAD) node apps/world/tests/browser/phone-learning-remediation-smoke.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 PHONE_HEAD_SHA=$(git rev-parse HEAD) node apps/world/tests/browser/phone-learning-campus-smoke.mjs
```

Learning tests cover 15 English lessons, question versions/mastery/review/bosses, local A/B/guest isolation, quota/storage failures, stale tabs, immutable recovery/cleanup and strict JSON. Browser tests use newly authored synthetic content only, desktop and Android 360px emulation, real storage quota, Phone Home/Back/Close and actual World input restoration with maps/album/camera/Daily Quiz. Public checks and Smartphone integration checks remain required in addition to dedicated exact-head learning QA. Skipped/cancelled/running checks are not passes.

## Safe merge and release order

Ark must review **both new final heads**, especially the standalone parent and the residual child diff. Review #429 first; only separately authorized maintainers may merge it. Then retarget/rebase #430 onto the resulting main and repeat required checks for that new head before any separately authorized merge. With a squash merge, use the reviewed parent head as the old base so inherited changes do not reappear. This task performs neither merge nor retarget to main.

Do not release either learning or cloud flags. Unapproved content remains private; no approved manifest exists. R1-B SQL remains a repository-only candidate for separately approved isolated validation and deployment. Production rollout, storage/cost policy, real device tests and R2 league work remain separate gates. LocalStorage snapshot admission is not a cross-tab atomic database; explicit recovery preserves surviving copies without claiming an automatic conflict merge. Cloud receipt cleanup has no TTL and must not be enabled merely because records are old.

## Child rebase readback

Parent head: `82ceb7989cb2f48b2f3301c3013531c0114f45c9`. Rebase used that head with original parent `c773b137ec9252573e519dd025c670774c086bbc` as the old base. The stale-save/import commit and no-randomUUID commit were already fully promoted; skip them rather than apply a second copy. Other cloud and server-security commits remain in the child history. Conflict choices preserve the final old-child behavior. `git diff refs/backup/stack-repair-01/r1b HEAD -- apps/world/src apps/world/tests .github/workflows supabase scripts` is empty; child implementation, tests, migration order and CI jobs remain byte-identical to the previously reviewed final child. Documentation records the repaired ownership.

The residual child diff excludes common `learning-contract.js`, `learning-progress.js`, `learning-engine.js`, common review/remediation tests and fixture vectors. Controller/view differences are cloud lifecycle/status actions; recovery adds only cloud archive scope. Source/content/off flags and economic authority are unchanged. Fresh child target tests pass 285/285. SQL/RLS/Auth tests run only in disposable local CI; no operational project is touched. The final PR readback must show parent → main and child → this parent, both Draft, unmerged, auto-merge disabled.
