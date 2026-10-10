# Release 2026-10-10: integrated life and housing

Status: ADMITTED COMPOSITE; final Release PR -> main checks required
Release branch: `release/2026-10-10-life-housing-integrated`
Verified release/main base: `4f7320a1ac360e9162b59aa9d9527a412dedfef7`

## Admitted candidate and preserved lineage

The user authorized merging the verified combined candidate for evaluation in the
game. The only admitted composite is #332 at
`4964bd5322de5c25cd6a5256e3ab4b289dd82f5a`, reviewed tree
`91c84a4af582d9afde01bfc789817519fc807524`. This wrapper changes only this release
manifest; the complete code, tests, generated declarations and public migrations
remain identical to that reviewed tree.

Included source lineage:

- #329 life/housing interactions: `d2441b0820c71270c9d9b46ec77ab1cfe3dd72a6`
- #331 closed Cooking B2: `7e5cbc288b29dd3ead0d016b92c5e93441d8486b`
- #330 closed Room Finish P0: `06c3a908e4ebccfbd6a64dea6b4311ebc7df68a0`
- #332 category/fixture integration: `4964bd5322de5c25cd6a5256e3ab4b289dd82f5a`

These are not four independent admissions. The combined #332 result includes the
necessary CONSUMABLE + ROOM_FINISH repair. Do not later merge the raw #330
migration or independently squash/cherry-pick source branches over this release.
Existing source branches and PRs are retained; closing or deleting them is a
separate housekeeping decision. Other Draft/HOLD work is excluded.

## Exact-source evidence and release gate

#332 completed all six triggered workflows: full source (4,055 World tests),
44-migration fresh replay, 73 SQL files / 3,675 pgTAP assertions, 152 actual
cross-connection integration tests, Cooking Chromium, six life/housing lanes,
Housing, Shop focus and Collection Book. The catalog is exactly the preserved
36 baseline definitions plus two cooking and four finish definitions.

The Release PR targets current main and must rerun the broader path-triggered
checks, including required `verify`, before a guarded merge. No required check,
branch protection or failing test may be bypassed. If main changes, reconcile it
in the isolated release candidate and reverify the combined result first.

## Production and activation boundary

This release changes the web client through the existing main-triggered Vercel
pipeline only. The public Supabase lineage is a disposable-development/CI
contract, not the Production migration authority. No Production SQL, account or
inventory mutation, credentials/configuration change, backend traffic shift, or
manual deployment is included.

Cooking runtime availability and food-use availability remain false. The cooking
recipe and all six new catalog items remain COMING_SOON, and both finish offers
remain LOCKED. The default-closed client does not call the new cooking RPC in
Production. This release does not make cooking, food effects, finish purchases
or new furniture acquisition available. A future activation needs a separately
authorized backend-first rollout and Production schema verification.

The existing Wood Floor 051 visual default and saved room data are preserved.
Trophy selection is owner-only, session-only preview. No invented owned trophy,
persistent display selection or visitor Inventory access is added.

## Known evaluation limits

The user will evaluate appearance in game. Prior proxy-avatar seating screenshots
do not establish final character/sofa framing; the hidden trophy fixture does not
establish rendered on-shelf appearance. Browser fixtures are synthetic offline
services, not real-account Production save/readback. Generated-type coverage
passes with 512 pre-existing non-failing missing declarations; exact generated
file equality has not been established.

## Post-merge completion criteria

Confirm expected main SHA, one matching Git-triggered Vercel Production
deployment in READY state, `inhagame.app` alias assignment, and live deployment
SHA/source readback. Review deployment-scoped runtime errors and changed public
client sources. Distinguish HTTP/source proof from authenticated in-game visual
acceptance. Report PENDING/HOLD if a required postcondition cannot be verified.

## Rollback target

Before this release, verified Production served main
`4f7320a1ac360e9162b59aa9d9527a412dedfef7` from READY deployment
`dpl_DStX49i7hGafvVW8Np7F14rqNNju`, with `inhagame.app` assigned and live
`/api/dev-status` confirming the same SHA. This is the rollback target; rollback
execution requires separate authorization.
