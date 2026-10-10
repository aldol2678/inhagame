# Candidate validation — 2026-10-08

This report applies to the source tree containing this report. The PR records the commit SHA after creation; CI status is separate.

| Verification | Result |
|---|---|
| World unit/integration | **3,793 / 3,793 PASS** |
| Real PlayCanvas GLB lifecycle / flight / morph / ground-stow | **12 / 12 PASS** |
| Optimizer suite | **6 / 6 PASS**, strict transform no fallback |
| World static QA | PASS |
| Khronos Validator source + optimized | **0 errors / 0 warnings** |
| Deterministic generator | byte-identical regeneration |
| Source/optimized flight rendering | Hover/Ascend/Forward/Descend pixel-identical |
| Same-time baseline/candidate pose state | **24 / 24 exact-equal snapshots** |
| Official-view comparison | Ground Basic/Front/Right/Back/Left visually inspected against manual; not school approval |
| Six-state Before/After | Ground/Hover/Ascend/Forward/Descend/Landing, 2 viewports × 2 lighting modes = 48 paired-input renders |
| Actual Production Induck | Read-only live source, 87,788 bytes; distinct from public QA cuboid |
| Actual rider/head separation | 7 transition segments × 120 steps; all vertex/ellipsoid checks ≥ 1, minimum **1.197656** |
| Offline campus with actual rider | Desktop 1280×800 / touch-emulated Mobile 390×844, day/night **4 / 4 PASS** |
| Campus captures | **40**, including mount, ascend, hover, forward, orbit, descend, close zoom, first person, landing and dismount |
| Campus errors | No watched fatal/page/console errors in accepted runs |

## Geometry / compatibility

Source: **404,276 bytes**, SHA-256 `ea624d5f1a4a011cc185eda7a86918b87a01e83552c60ca35f715f036be0c002`.
Optimized: **331,244 bytes**, SHA-256 `34a8008a8f17d09466946aba82c5aa1450584110845d73a05bfe3c1083b1908b`.
Both: **12,558 triangles / 28 meshes / 1 material / no textures**. Existing ceiling: 13,000 triangles / 450,000 source bytes. Previous source: 394,672 bytes / 12,188 triangles. The source grows 2.43%, optimized shrinks 0.38% from 332,520 bytes. No measured FPS improvement is claimed.

`Tail` and `TailCloud` retain POSITION/NORMAL targets `TailAscend`, `TailForward`, `TailGlide`, equal vertex counts and zero default weights. Tail root ring is copied to each target to avoid seam movement. FlightHeadPivot, DragonWing_L/R and RiderAnchor names/hierarchy are retained; RiderAnchor `[0,-0.08,-0.80]` is unchanged. Runtime tests exercise independent instance weights, reset, disposal and smooth transitions.

The fixed small CloudWing surface remains when the extra flight pivot is disabled below the deployment epsilon. A nonsingular 0.001 minimum scale prevents invalid transforms. The pose table and phase integration remain unchanged. Ground-to-hover transition is tested for bounded per-frame expansion.

## Scope of confidence / remaining risks

- **Design remains pending.** Cloud contours, volume/depth, facial details and extended-tail interpretation still need user/school visual acceptance. The manual prioritizes the recognizable 2D design over strict perspective realism; a single 3D projection cannot certify every drawn view.
- **Induck source revision is not completed.** The real model's oval head / neck transition differs from the continuous official outline. It was inspected, not replaced or published. Separate review is needed for geometry and the PBR color interpretation. Public QA cuboid bytes are unchanged.
- Actual rider separation measures rider vertices against the known head ellipsoid through transitions; it is **not** exhaustive triangle-to-triangle testing of all limbs, tail and equipment. The existing physics collider is unchanged.
- Camera checks use actual campus chase camera/framing, close zoom, first-person hiding and return. This is not an exhaustive camera-obstacle sweep across the entire campus.
- Local **Chromium 153 / SwiftShader WebGL2** only. Portrait is touch/viewport emulation, not physical Android/iOS; hardware WebGPU, Safari, accessories and live two-client multiplayer remain unverified.
- Existing shared offline harness stubs API/online calls. Loading an externally downloaded production rider into local renders is not a Production deployment test.
- Some UI emoji glyphs appear as boxes in the local runner; not caused by this model change.
- Intermediate visual QA found a belly patch intersecting the body; it was subdivided and all final captures were regenerated. Intermediate acceptance results were not used for the final model.
- CI has not been inferred from local test success. The final response/PR carries the remotely queried status and no repeated polling is required.

Raw numerical evidence: [GLB](glb-validation.json), [pose parity](pose-parity.json), [campus](campus-results.json), [actual rider](production-rider-results.json). Private manual/Production imagery is excluded from the repository.
