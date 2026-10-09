# Parallel graphics integration smoke

Run in the authorized GPU-enabled/CI environment using the existing browser package and offline harness:

```sh
WORLD_GRAPHICS_QA_OUTPUT=/tmp/graphics-parallel-evidence \
  node apps/world/tests/browser/graphics-parallel-smoke.mjs
```

Uses the same `WORLD_SMOKE_*` options as `harness.mjs`. It accepts actual WebGPU or WebGL2 rendering and records which was used. Dependencies/browser setup follow the existing `tests/browser/package.json` and CI setup. This script does not install software, upload artifacts, authenticate, touch production, or modify a workflow.

## Coverage

- Real settings DOM: quality, frame ceiling, render resolution, shadows, FPS display; independent view-distance setting; reload persistence; graphics-only reset.
- Actual engine `postrender` intervals and simulation update counts with a 30 FPS ceiling. The upper-bound assertion is deliberately not a minimum-performance promise. An overloaded software GPU may render well below 30 FPS.
- Contact geometry status and triangle/mesh/buffer budgets; enabled/disabled screenshots.
- Live environment controller receiving a fixed mock clock: within-DAY exposure progression and continuity across a daylight anchor.
- Biryong entry, day-to-night transition inside, return to campus and restoration of the current night exposure.
- PNGs plus JSON receipt, including failure screenshot and error where possible.

The committed offline harness blocks external requests, substitutes pinned PlayCanvas, and stubs Supabase. For this test only, main.js's exact clock construction expression is replaced in the served response with a fixed fake clock. All other main.js bytes stay unchanged. This enables the production environment-world-time consumer on localhost without adding a public runtime debug hook. The response replacement asserts one exact match and fails if the seam changes.

## Explicit limitations

This code was syntax/static-contract checked only on 2026-10-08. The dot cloud browser rejected local navigation (`ERR_BLOCKED_BY_CLIENT`); no bypass or browser execution was attempted during preparation. A successful static test is not evidence that the browser smoke passes. Await an authorized hosted/connected execution before claiming visual or functional verification.

Screenshots use the real running app and are not standardized comparison vistas. The previously proposed seven fixed scene coordinates (gate outside/inside, intersection, mid-route, main hall, NPC density, same-position night) have not been visually verified. This script prioritizes the four implementation workstreams rather than claiming those seven semantic views are proven. Contact visibility can depend on streamed geometry and snow; receipts record that state. Visual acceptance still requires image review for flicker, overlap and composition.

Headless CI/cloud-browser timings are surrogate measurements, not mobile GPU, battery, thermal, or release performance evidence. Viewport is 1280x720. No real-device pass/fail threshold is inferred. The fixed clock samples authoritative cycle time independently of render pacing, so it checks world-clock consumption but not network clock synchronization.

## Review hardening

After both settings-dismiss paths, the smoke asserts that the view-settings owner is released, movement is allowed, and the fixture is outside the lobby. It then focuses the canvas and holds native W until measured displacement exceeds 0.2 units in the existing gate-spawn corridor. Key release and position/yaw restoration run in finally; the test never forcibly clears focus claims or enables input.

Contact comparison uses the existing contact-shading-smoke's garden-bench close-up, with the canonical `library_garden_bench_0` receiver and a temporary fixed camera. It loads streaming chunks, requires positive active contact meshes and that exact bench in the enabled BASE batch, requires no snow masking, and captures on/off at identical camera transforms after a postrender barrier. Player visibility/position, primary camera enablement and contact state are restored, and the temporary camera is destroyed. This improves evidence framing but still awaits actual image review.

Biryong return also asserts restoration of the pre-entry canvas filter and camera tone mapping. Browser-launch failures now enter the report-writing finally path, even when no page exists. These are code/contract checks until authorized browser execution occurs.
