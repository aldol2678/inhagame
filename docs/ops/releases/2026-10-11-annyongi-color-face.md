# Annyongi authored color and facial contrast release — 2026-10-11

## Exact scope

- Release base: `82538ea1dfd4b3f82123673786ab052a76fc1a7c`.
- Sole source candidate: #345 head `ebaaa20bd17621523436eaefb23676d8070f68c0`, tree `262e4f48ca7f292e004bcaafacedec370cafad12`.
- Preserve every source candidate blob, including the current main life-housing workflow. No color-only intermediate release.
- Additional test-only change: `apps/world/tests/browser/annyongi-campus-smoke.mjs`, adding observation metadata from the existing campus PNGs. Expected patched blob: `995e0bc6fe03c9d2282cdb3f810490deb220223e`.
- The only other addition is this release manifest. No runtime, geometry, private asset, routing, threshold or camera change beyond the reviewed #345 source.
- #346 and all other unmerged candidates are excluded. If another owner's release reaches main first, preserve its main changes, revalidate the release base and rerun relevant integrated CI; do not merge or modify those candidates here.

## Evidence and honest limits

The exact source head passed all five PR-triggered workflows plus metadata labels on the first attempt: Public local checks, World asset optimizer, Character model browser checks, Mounted Photo + Maps and Private character acceptance. The three independent asset safety canaries passed. Source private evidence contains eleven JSON files only.

Eight source/optimized × desktop/mobile viewport × day/night color cases passed. Twenty-four asset/viewport/light/view-angle facial conditions passed: measurable line-core pixels show no additional contrast loss or connected-component splitting. AA-mixed boundary pixels are excluded; baseline visible cores already contain separate components. This is not proof that every facial line is one uninterrupted stroke or that all expressions pass human visual review. Both asset variants also passed ownership, flight states and four campus conditions/forty frames.

The extra campus metadata is observation-only, not a relaxed acceptance gate. It reuses existing screenshots without new captures, camera changes or isolated ID masks. Verify its execution in this Release PR, including forty source and forty optimized frame observations, finite measurements, bounded ratios and honest hidden/back-facing/resolution-limited states. Projected ROIs may include eyes, shadows, background or occlusion; dark pixels do not prove contour continuity. Do not retroactively attribute these new observations to the source PR evidence.

Physical GPU/mobile performance and full in-game visual acceptance remain unverified. Private screenshots/model payloads must not be published; existing artifact allowlists remain JSON-only.

## Gates and operating boundaries

Admit #345 only after exact-head green checks, independent review and Ready status. The source PR is Ready and its wording now reflects the combined color/face result. Publish the release as Draft, run its own exact-head CI and independent review, and merge only after the integrated results satisfy the renewed combined-release request. Recheck main/head, required verify and matching merge-test tree before guarded squash merge. No branch-protection bypass or manual deployment.

No Production SQL/migration, RPC installation, catalog/feature activation, credentials, permissions, backend traffic change or player-data mutation. Public database tests use disposable local lineage only. Keep the existing main-only Git-triggered Vercel deployment path.

## Rollback and postconditions

At preparation time, the previous READY Production is `dpl_4e779CfBopYjsAn2edxAYjamZfN2`, Git SHA `952a826c3a38d4dd88f2d5fe316cacc9c9b41dd6`, serving `inhagame.app`; repository main is newer at `82538ea1dfd4b3f82123673786ab052a76fc1a7c`. Do not treat a non-READY main deployment as a rollback candidate. Recheck the last READY Production before release. Rollback execution requires separate approval.

After authorized merge, verify expected main SHA/tree, matching Git-triggered READY Production deployment, canonical alias and live dev-status, exact changed renderer source and unchanged private source/optimized/Induck hashes, campus HTTP entry and deployment-scoped runtime errors. Source/HTTP readback alone is not visual acceptance. Until all required postconditions are verified, report PENDING/HOLD rather than COMPLETE.
