# INHA WORLD Short Release Train

Status: CURRENT OPERATING CONTRACT
Adopted: 2026-10-07

## Purpose

Keep feature work and pull requests small while reducing repeated Production deploys and repeated `main` verification. The public repository remains the implementation authority. Production is released from `main` only.

## Branch model

- Feature and fix branches stay small and single-purpose.
- Normal release candidates target a short-lived `release/YYYY-MM-DD-x` branch.
- A release branch starts from the current verified `main`, normally lives for hours rather than days, and is deleted after the release closes.
- The release branch is integrated back to `main` once as one release PR.
- Long-lived `develop` branches are not part of this workflow.

The root `vercel.json` keeps Git deployments disabled for every branch except `main`. A release branch therefore does not create a Vercel deployment.

## Default release cadence

Use a short release train rather than a large daily dump.

- Normal target: 2-3 release trains per active development day.
- Normal batch size: about 3-6 independent PRs.
- Do not wait to fill a quota. A smaller coherent batch is valid.
- Prefer fewer coupled changes per batch when rollback or diagnosis would become ambiguous.

## Admission gate

A PR may enter a release branch only when all of the following hold:

1. It is not Draft or explicitly HOLD.
2. Its current reviewed head is known.
3. Required PR checks for that head are green.
4. The PR does not require an unresolved external activation, Production migration, credential/config change, or other prerequisite.
5. Its scope is compatible with the other candidates in the batch.

Retargeting alone does not require duplicating an unchanged exact-head CI run. If the candidate head changes or is rebased, its required head checks must pass again. Cross-candidate integration is authoritative at the final Release PR → `main` gate.

## Release gate

Before the release PR is merged to `main`:

1. Every included PR has green required checks for its admitted exact head.
2. The final Release PR → `main` passes repository CI on the integrated release result.
3. The release manifest records:
   - release base SHA
   - included PRs and exact heads
   - excluded/HOLD candidates when relevant
   - DB/activation boundary
   - expected rollback target
4. No unresolved P0/P1 incident is being hidden by the release.
5. The release PR is the only normal path from that batch to `main`.

## Production postconditions

A release is not COMPLETE just because the GitHub merge succeeds.

After the release PR enters `main`, verify all of the following:

1. GitHub `main` points to the expected release commit.
2. Vercel created one Production deployment for that commit.
3. The deployment is `READY`.
4. The deployment Git SHA matches the expected `main` SHA.
5. The Production custom domain is serving the released deployment.
6. Required Production smoke/readback checks for the changed surfaces pass.
7. New Production runtime errors are reviewed when the release changes runtime behavior.

If these postconditions cannot be confirmed, report the release as PENDING or HOLD, not COMPLETE.

## Hotfix bypass

The release train must never delay a serious Production repair. Examples include:

- login or game-entry outage
- character, inventory, progression, or save loss
- duplicate or corrupt rewards
- authentication/security failure
- server/API outage
- material Production data corruption

A hotfix may target `main` directly through the protected PR path. After the hotfix lands, every open release branch must incorporate the new `main` before release and rerun the relevant integration checks.

## Database and activation boundary

The public Supabase migration lineage is not the Production database migration authority. Repository CI and `public-db.sh` validate the public/disposable development lineage only.

Therefore a normal web release batch must not silently imply any of the following:

- Production SQL application
- Production-only migration
- Cloud Run/backend traffic shift
- feature-flag activation
- credential or environment change

When a feature depends on one of those operations, record and verify the external rollout order separately. A client release must not run ahead of an unresolved server/database prerequisite.

## Rollback

Each release records the previously verified Production deployment as its rollback target.

- Broad release regression: roll back Production to the last verified deployment first, then diagnose.
- Isolated feature regression: revert the offending PR through the hotfix path when that is safer than reverting the full release.
- A rollback does not erase the need to reconcile `main`, the release manifest, and any external database/backend state.

## Current first batch

See `docs/ops/releases/2026-10-07-a.md`.
