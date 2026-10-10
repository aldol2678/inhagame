# MASCOT-3D-FIDELITY-01 — design review candidate

Start-main: `718cdf33b74287e8312f2b36fde04ec693c3f4c8` (2026-10-08).
Prior #286 was verified **merged**, head `31c4c4b008d886d80f41febeec76ccfc89eab5bc`, merge `f455df62ac49c702c95af462e9dd32cf995363a2`.
Branch: `work/mascot-3d-fidelity-01`. No merge, Production deployment or email submission authorized/performed.

## Why / changes

The prior model retained a feather-like flight fan and extra ground silhouette. This candidate uses one continuous scalloped cloud surface with curls on both sides, and stows the flight extension after ground settling. The small identity clouds remain visible. A fuller, deeper curved tail and broader cloud tip preserve the three named tail morphs and root attachment. Ear angle, horn thickness, dark forelock curl and conforming belly patch receive small adjustments.

Shipping changes are restricted to the generated Annyongi GLB and visual wing deployment. Flight pose table, body/head pitch, timing, tail weights, physics, network, camera, equipment, mount controls and RiderAnchor are retained. No replacement Production Induck bytes are included.

## Design basis and boundary

The user-supplied official 10-page manual was visually reviewed, including Annyong five-view/tail sheet (p4), Induck post-/pre-orb forms (p5), color sheets (p6–7) and expressions (p8–10). The 2026-10-08 design feedback was read directly. Reference files and correspondence remain outside the public repository. The earlier MASCOT specification's P0/P1 essentials were recovered from conversation context; its full verbatim text was not recovered. The current explicit execution order and manual govern this implementation.

This is a project-authored **candidate**, not an approved university revision. Technical tests cannot establish design acceptance. Projection comparisons are visual reviews, not an automated similarity score. RGB values are the existing screen interpretation of CMYK guidance; display/ICC color matching is not certified.

## P0 / P1 status

| Item | Result | Remaining condition |
|---|---|---|
| P0 ground silhouette | Implemented: only small CloudWing remains after settling; no extension deletion | Manual-based visual acceptance by user/school |
| P0 flight cloud identity | Implemented continuous scalloped shell + two-sided spiral, retained animated pivots | 3D volume and extension proportions remain an interpretation |
| P0 tail | Implemented fuller curve/depth/tip; 3 morph names/order/attachment preserved | Final silhouette approval |
| P0 Hover/Ascend/Forward/Descend/Landing | Pose parameters and state selection preserved; paired captures include Ground as sixth state | Hardware/online testing remains separate |
| P1 Annyong proportion/face | Five-view review; existing head/body dimensions retained; small horn/ear/forelock/belly corrections | No claim of exact 2D correspondence across every view |
| P1 palette/day/night | Existing blue/cream/pink colors retained; day/night visual QA | Physical-device color/performance unverified |
| P1 Production Induck | Actual live GLB obtained and reviewed privately, 87,788 bytes, source SHA-256 `bec8585e3e64f092585c23e353ae833215a25ceffa850d819bce7d34d70f01ea` | Head/neck continuity needs a separate source-model revision; not changed here |
| P1 actual rider | Private source injected into local offline campus; see QA results | Full surface-to-surface collision certification / equipment matrix not claimed |

Induck finding: the official post-orb silhouette reads as a narrow continuous neck/head column. The current Production model has a separately bulging oval head (authored head width 0.50 versus neck width 0.32 and body width 1.66). That factual geometry difference is not presented as a school-approved deviation. Its four PBR materials also require separate color-space review before any source modification. The public repository's 144-triangle cuboid is only a QA stand-in and was never assessed as Induck's appearance.

## Evidence / reproduction

- [Ground five-view before/after](images/ground-five-views.jpg)
- [Six states, desktop day](images/six-states-day.jpg)
- [Six states, desktop night](images/six-states-night.jpg)
- [Mobile day/night](images/mobile-day-night.jpg)
- [Validation and limits](QA.md)

All public images are actual local PlayCanvas renders of public project geometry. Teal cuboids are explicitly QA riders. The private manual comparison and Production-rider screenshots are delivered separately; no reference pixels or private source models are published here.

```sh
python3 tools/world-assets/build-annyongi.py
node apps/world/assets/check_characters.mjs
npm test --prefix tools/world-assets
node tools/world-assets/optimize-world-assets.mjs --strict
node tools/world-assets/validate-annyongi.mjs
node --test apps/world/tests/browser/character-model-loading-runtime.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/annyongi-fidelity-capture.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/annyongi-flight-pose-capture.mjs
WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/annyongi-campus-smoke.mjs
```

For identical baseline sampling, point `FIDELITY_WORLD_ROOT` at start-main's `apps/world` and use `ANNYONGI_OUTPUT` outside the repo. For private live-rider verification, supply an externally downloaded `FIDELITY_RIDER_GLB` path to `annyongi-campus-smoke.mjs` / `annyongi-production-review.mjs`. These tools read bytes into an offline HTTP route; they do not overwrite repository assets or contact Production. Use outputs outside the repository. Optional sampler `FIDELITY_DEVICE` / `FIDELITY_STATES` only narrow a diagnostic run; the recorded acceptance matrix uses defaults.
