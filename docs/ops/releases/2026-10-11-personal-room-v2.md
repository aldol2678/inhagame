# Personal room V2 release — 2026-10-11

## Scope and lineage

- Release base: `c542fcedcd1c0c9eb4279cfe3d9bf8e46face610`.
- Sole included candidate: #334, exact head `a546f9ad6a48ded13c3e2b3293dd367a4363ea9a`.
- Reviewed candidate tree: `412f48c797e6675376029649b1b5c545bcaaf560`.
- Release branch: `release/2026-10-11-personal-room-v2`.
- This wrapper adds only this manifest to the reviewed candidate. Runtime code, assets, tests and workflows remain identical to #334. The Release PR is the sole path to main; do not independently merge #334 or unrelated candidates.
- Scope: personal-room shell/window/materials/lighting, matching fixed chair GLB and fallback, safe chair exit behavior, and strict loaded/fallback visual QA.
- All other open candidates are excluded from this single-candidate release.

## Admission and release gates

The candidate's six exact-head workflows passed: Public local checks (including required verify, source and disposable database checks), Housing browser QA, Life housing candidate browser QA, Character model browser checks, Asset runtime browser QA, and World asset optimizer.

The Release PR must independently pass its exact-head repository CI and required verify before an expected-head guarded squash merge. No protection bypass, manual deploy or workflow rerun is included. Verify main has not changed from the release base before merging. No unresolved P0/P1 incident is known from this candidate's review; any newly found incident blocks release.

## Database and activation boundary

No Production SQL, migrations, backend traffic changes, feature activation, credentials, permissions, ownership grants or real-user data mutations are part of this release. Existing Collection-owned furniture authority, catalog definitions, acquisition restrictions, cooking/food-use availability and saved room data remain unchanged. Public database CI is disposable-development validation only.

## Rollback target and completion

Previously verified main: `c542fcedcd1c0c9eb4279cfe3d9bf8e46face610`.
Previously verified READY Production deployment: `dpl_fyBBrYoxyz6zdiKna5nrFQ8PPbzp`, serving `inhagame.app`. Rollback execution requires separate approval.

After merge, verify main's release SHA, the normal Git-triggered Vercel Production deployment, READY status, matching Git SHA, canonical domain alias, live `/api/dev-status` SHA and changed source/asset readback. Review deployment-scoped runtime errors. Until these postconditions are established, report PENDING or HOLD rather than COMPLETE.

## Evidence limits

Chromium SwiftShader validates software WebGL2; portrait viewport screenshots do not establish physical-mobile or GPU performance. The intentional fallback test injects loader errors rather than HTTP/network failures. Source/asset readback does not establish authenticated in-game visual acceptance or real-account save behavior.
