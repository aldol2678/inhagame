# Campus facilities exterior blockout

The reference expansion adds 32 runtime features to the existing pond, Main Hall,
library, entrance, lawns and approach roads. It is a simplified exterior model,
not a surveyed architectural reconstruction. No interior gameplay is added.

## Coverage

| Group | Added exterior features |
| --- | --- |
| Academic and service buildings | 2 south/north, 4, 5 with open courtyard, 60th Anniversary, 6, 9, Student Center, Hi-Tech, Seoho, Nabille, Law School, ROTC, Continuing Education, Dream Center 1/2/3, Hawaii Center, C building, dormitories 1/2 |
| Sports and grounds | Stadium/track, basketball, tennis, south court, Biryong parking, Hawaii-Inha Park sculpture group |
| Landmarks | Biryong Tower, matching tree, Woonam aircraft, Heidegger forest, pond pavilion |

The 21 building features include separate parts of named buildings. The six
ground features and five landmarks bring the runtime feature count to 32.
Sports markings, vegetation and sculptures are deliberately simplified.

## Evidence and accuracy

- `data/reality/evidence/facilities/source.json` retains the selected OSM ways,
  relation members, original coordinates, versions, retrieval date and raw-response
  hash. Official university map markers include their source URLs and retrieval times.
- The user-provided campus diagram, aerial views and exterior photos guide facades.
- Facade colours and window rhythm (Student Center, University Building 6) are
  visual estimates from the reference material above. Third-party map imagery notes
  are kept out of the public repository.
- Similarly numbered Inha Technical College buildings are excluded.
- Horizontal building outlines preserve OSM rings. The 5-building courtyard is
  partitioned as outer minus inner ring, including the walking/camera colliders.
- Heights, roof/tower masses, facade rhythm, sport markings and point-landmark
  positions are **visual estimates**. They are not canonical cadastral promotions.
- The third dormitory has no separately resolved footprint in this evidence set.
  It is not represented by a guessed duplicate. Agora structures, connector paths, decoration, colliders and tour stop were
  removed at user request. Its archival source record is retained.

Completed three-stop tour saves remain complete in the new two-stop tour.

## Runtime integration

Facilities use the existing projection, polygon geometry, collision and three-zone
streaming systems. Bounds expand only to include the mapped facilities and a
walking margin (X -181..308, Z -180..165). Facade details batch by material per
facility; VISTA omits detailed facades. Meshes are destroyed on streaming rebuild.
The gate spawn moves from Z -110 to -98 to clear the mapped first dormitory from
the default camera. Camera near clipping moves from 0.1 to 0.3 to prevent distant
roof-cap depth interference across the expanded scene.

## Verification (2026-09-25)

- `node apps/world/validate-reality.mjs`: PASS.
- `node apps/world/validate-reality-evidence.mjs`: PASS.
- `node apps/world/qa.mjs`: PASS.
- `node --test apps/world/tests/*.test.mjs`: 36/36 PASS.
- Chrome desktop WebGPU, 390x844 mobile emulation WebGPU, and WebGL2 fallback:
  32/32 facility entities and actual GPU buffers; finite vertices/nonzero triangles;
  source building/ground world AABBs; Gate-Hall movement 2/2;
  C03 unload/return creates a new Student Center entity and retains pond rendering.
- Mobile native touch joystick moved the player 3.5 WU over 30 controlled frames.
- Desktop gate, pond/Student Center and overview screenshots, mobile gate and
  pond/Student Center screenshots, and WebGL2 overview were visually inspected.
  Overview uses a developer inspection camera; the gate and pond images use the
  normal gameplay zoom range. No captured console errors.
- Mobile emulation is not a physical-device performance benchmark.

Reproduce the GPU/tour/rebuild assertions in a disposable local QA browser tab:

```js
await (await import('/qa-facilities-runtime.mjs')).run()
```

The helper moves the player and restarts the local tour. Reload the QA tab after
use. WebGL2 was checked with a temporary copy of campus HTML that disables
`navigator.gpu` before normal startup; that file was removed after verification.
Production release is a separate step; local/browser checks do not prove deployment.
