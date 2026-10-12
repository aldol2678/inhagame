# Personal room day/night, ceiling lights and curtains

## Candidate scope

- Base: `82538ea1` on `main`. Local candidate only; no commit, push, PR, merge, deployment, database or environment-permission change.
- Uses the existing world environment/time projection; no second clock or new time API.
- Window sky/haze/foliage and ambient fill follow interpolated world lighting. Preview/manual environment controls remain usable.
- Existing ceiling rocker controls the two ceiling lights and diffuser glow. The existing reading lamp remains independent and unchanged. **Existing total: 3 non-shadow lights; added lights: 0.**
- Existing curtain meshes spread inward to overlap or gather outward. Geometry/mesh counts stay fixed; fabric loops track the opening. Reduced-motion mode snaps to the final pose.
- Shared F/mobile context action only. The nearest switch/exit wins at the same priority. Input focus, movement range, grounding, mounted/seated state and transition gates are rechecked when activated.
- State is local to the current room stay. Leaving, changing room identity or changing account resets ceiling lights ON and curtains OPEN. Visitors see their own session-local choices. No save, realtime broadcast or database/schema changes.
- Room-owned materials are the only materials changed; shared fallback surfaces remain untouched. Global lighting receives color copies, so the environment director cannot mutate a reusable room palette by reference.
- Default furniture geometry, anchors, placement and collision are unchanged.

## Verification

- All World Node tests: **4,159 passed**, including the final main-copy regression assertion.
- Focused personal-room + room-transition tests: **153 passed**; syntax checks and `git diff --check`: PASS.
- `node apps/world/qa.mjs`: PASS.
- Existing `personal-room-v2-null-smoke.mjs`: PASS.
- New `personal-room-environment-null-smoke.mjs`, real pinned PlayCanvas 2.22.4 / NullGraphicsDevice: PASS. Checks existing 3-light budget, separate room materials, world-time day/night projection, curtain overlap at every geometry row, stable textures/render counts through 20 stays, and actual room-world-adapter/color-copy restoration through 10 campus round trips.
- New WebGL2/LOW browser fixture and desktop/touch smoke prepared. Includes F/tap, blocked input, account reset, repeated stays, day/night window colors and screenshots.

## Remaining evidence

The cloud Chromium process aborts before loading the fixture: `socket() failed: Operation not permitted`. No attempt was made to change permissions or bypass that restriction. The browser smoke is **not executed successfully** here. NullGraphicsDevice results are not rendered-pixel, touch-device or GPU/performance evidence. Actual LOW visibility, visual curtain quality and desktop/mobile input must be confirmed in a supported browser before release.

## CI / combined-candidate dependency

Housing browser QA runs the new Null test. Life housing browser QA adds `personal-room-environment` and the parallel `furniture-recommendations` smoke. The integrated candidate includes both smoke files. The original separate patches must be applied together if used individually; this workflow change is intentionally coordinated across both features.

Commands for supported CI/browser environment:

- `node --test apps/world/tests/personal-room*.test.mjs apps/world/tests/room-transition*.test.mjs`
- `node apps/world/tests/browser/personal-room-environment-null-smoke.mjs`
- `WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/personal-room-environment-smoke.mjs`
