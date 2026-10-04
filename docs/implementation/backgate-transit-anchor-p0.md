# Back-gate 37165 information anchor P0

Based on public main `cfa0d1a1870fef6cea140cc8b901964afd50aa28`.

Walking players can open the 인하대후문 · 37165 information panel using the shared F/context action or touch button. Real 511 background information and game-only F1 are visually separated. F1 remains COMING_SOON: no bus is spawned, no boarding/teleport/preload occurs, and no FRONTIER_VILLAGE spawn grant is issued. Guest access needs no account or RPC.

The lat/lon are restored design evidence, not a newly fetched timetable. The original geographic anchor stays separate from the physical pole, which is moved inward onto the existing sidewalk. All geometry uses current geoToWorld / road frames; 1 world unit = 2 metres.

| Item | World X | World Z | Ground Y |
| --- | ---: | ---: | ---: |
| Source anchor | 111.798063 | 113.042070 | 0 |
| Pole | 112.130096 | 114.102923 | 0 |
| Wait | 111.038794 | 114.968404 | 0 |
| Reserved boarding | 111.158273 | 115.350143 | 0 |
| Reserved bus centre | 112.832038 | 116.345639 | 0 |

The flat connector follows existing back-street road frames into `inha_west_extension_2`. Its width is 1.3 wu (2.6 m), increased from the layout draft's 1.1 wu to accommodate walking-capsule detours around existing lamp and signal poles. Asphalt polygons are clipped from the new paving so current crossings/road markings retain their surfaces. Existing street furniture is preserved. The exported walk guide is a validation route, not a new automatic movement system. Pole/sign colliders are part of resident OBSTACLES.

The 3.5 m context radius is checked with the player's entire capsule on the stop sidewalk and ground-height readback. Road-side, airborne, mounted, seated, indoor, lobby and blocked-input states cannot publish the action. Trigger-time state is checked again. Priority 180 yields to NPC, follow, seats and shop. The panel claims BLOCKING_UI and releases only its own owner; Escape, Tab, other modal handoffs, room/lobby transitions and pagehide are handled.

## Validation

- `node --test apps/world/tests/*.test.mjs`: 1,822 passed, 0 failed.
- `node apps/world/qa.mjs`: all static contracts passed.
- Added stop tests sweep 1,551 samples through the complete live obstacle set; all points are occupiable and every swept step reaches its endpoint.
- Actual offline Campus boot reached WebGL2 / READY in Chromium 153 with SwiftShader. PC F, 390×844 shared button and touch/coarse-pointer emulation, disabled F1, Tab/Escape, movement blocking/restoration, road/air exclusion and keyboard-help modal handoff passed with no page/console/same-origin errors.
- Browser test: `npm ci --prefix apps/world/tests/browser`, then `WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/backgate-transit-smoke.mjs`. Repeat with `TRANSIT_SMOKE_TOUCH=1` for mobile touch emulation. Requires installed Playwright Chromium. Local validation used a temporary executable-path harness for packaged Chromium because Playwright's browser download failed; no dependency/harness replacement is included.
- `git diff --check` and `node --check apps/world/src/main.js` passed.

WebGPU, physical mobile touch hardware and a live online session were not exercised. Online endpoints were stubbed/blocked by the existing offline smoke harness. Destination geometry and F1 transit integration remain a subsequent implementation step.
