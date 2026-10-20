# View distance extension, private #87

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

## Audit before editing (2026-09-26)

Read current PR head d43bc918 and fetched main 890ee5b11f024409ea2f413e4146b2abf9bd3945.
The latter changes Survival only and has been merged into this feature branch.
The original track, aircraft-clearance and Agora changes remain intact.

Delivery sync: main 0fa6abda4eeb0865336f02412d29864c5acbf4ae was subsequently
merged into this branch. Its separately merged private #89 adds standalone network
foundation modules. This PR neither modifies those modules nor connects them
to the campus runtime; online activation remains a separate integration task.
Final delivery also includes main 3d201105a03553709ca9ac5eafef0cc0e86dd9ee
(independent Grow analytics private #94; no World files changed by that sync).

The requested runtime modules, QA, tests and Reality/zone inventories were
rechecked against SPATIAL_ARCHITECTURE_P0.md. ZoneStreamingManager no longer
exists; archived ZoneRegistry/JSON only serve compatibility QA. Live adjacency
is absent. Places resolve per frame, independently of the 250 ms render loop.
15 AREA places and 19 RC ownership chunks are already independent. Facility
ownership is center-grid based with whole-footprint expanded bounds. Collision
and CampusBase stay resident. HUD/tour use AREA IDs; legacy analytics and tour
adapters remain explicit. No account/location persistence changes are needed.

Current render thresholds: DETAIL 35/50, NEAR 85/105, resident 150/180. ACTIVE
means DETAIL. Layer handles survive ACTIVE/NEAR/VISTA. There is no settings API
yet. Camera far clip is 700; user orbit 12..36 and flight height cap 24. Existing
control preferences use inhagame-campus-settings-v1 (size/side); view distance
will use a separate versioned key and must not overwrite those preferences.

Plan: add a pure preset/storage contract, incremental policy changes and a small
settings UI; compare candidate preset workloads on the actual 19 chunks in
Chrome WebGPU, then document final measured tuning. Preserve full-campus BASE
in every preset, increase only detail range, and do not implement online code.

## Final view-distance contract

Pure `view-distance.js` owns the four immutable presets and storage normalization.
It imports spatial bounds/chunk size, never PlaceZoneRegistry or online code.
`viewDistancePreset(id)` normalizes unknown IDs to NORMAL. All existing 15 AREA
and 19 RC records remain unchanged; their complete inventories and compatibility
mappings are in SPATIAL_ARCHITECTURE_P0.md.

All distances below are logical world units (approximately 2 metres per unit),
measured to expanded chunk bounds. ACTIVE is the existing name for DETAIL.

| Preset | Label | DETAIL enter / exit | NEAR enter / exit | VISTA load / full dynamic unload |
| --- | --- | --- | --- | --- |
| SHORT | 짧게 | 22 / 34 | 52 / 68 | 100 / 124 |
| NORMAL | 보통 (default) | 35 / 50 | 85 / 105 | 150 / 180 |
| FAR | 멀리 | 80 / 100 | 144 / 168 | 224 / 256 |
| MAX | 최대 | 104 / 128 | 200 / 232 | 640 / 672 |

MAX VISTA entry is the playable diagonal rounded up to a 64-unit cell. Its exit
adds 32 units. From every playable corner all 19 chunks have at least VISTA
residency, while distant chunks still exclude NEAR/DETAIL layers. A building
can share an expanded chunk with another building; tiers are chunk-level.

Camera far clip is 704 in **all** presets: rounded campus diagonal plus a cell
for the existing <=36 orbit and vertical margin. Lowering it for SHORT would
incorrectly cut off persistent major silhouettes. View distance changes detail
reach, not the skyline's existence. It does not change the existing orbit/FOV,
flight controls or provide a new aerial-photo/free-camera mode.

## Runtime updates and visual continuity

`RenderChunkStreaming.setPolicy(preset)` retains runtime handles and the BASE.
It queues nearby chunks first and reconciles at most one chunk per frame during
a settings change. A replacement preference supersedes the pending policy, and
all decisions use the current position. The queue must drain before another
250 ms evaluation replaces it, preventing far-chunk starvation at low frame
rates. Normal movement retains the 250 ms evaluation cadence.

Surviving NEAR/DETAIL roots are enabled and faded, not rebuilt. Each layer uses
its own material copies so fades never alter shared BASE materials. A 250 ms
Bayer opacity/shadow dither fades detail while retaining opaque depth behavior.
Copies are disposed when their layer is destroyed. Implementation uses the
pinned PlayCanvas 2.22.4 [StandardMaterial dither contract](https://api.playcanvas.com/engine/classes/StandardMaterial.html#opacitydither).

Far dynamic unload destroys only that chunk's layers. BASE terrain, roads,
pond/stadium outlines, building/landmark silhouettes and collision stay resident
even when its dynamic state is UNLOADED. Settings changes do not rebuild the
world. A tier fade is visible as a fine dither pattern; this is not TAA or a
photorealistic continuous LOD system. Far removal is chunk-granular.

Hysteresis applies at all three levels and preserves previous-state bands when
switching presets. Consequently counts/memory depend on arrival history; SHORT
does not purge every previously created disabled layer inside its retained
radius. This preserves reuse. This PR does not impose a total memory budget.

## Settings and compatibility

Top-right **설정 · current label** opens a small panel with the four choices.
Select changes apply immediately; Escape/close/toggle returns to the world.
On mobile the panel sits below the HUD/tour and above the movement controls.
Keyboard movement is cleared/ignored while selecting, and select has a 44 px
touch height. Stored key: `inhagame-campus-view-distance-v1`, raw value one of
SHORT/NORMAL/FAR/MAX. Missing, corrupt or inaccessible storage uses NORMAL;
write denial applies session-only and is explained in the panel.

`inhagame-campus-settings-v1` (joystick side), guest identity and tour save
are untouched. No account sync. Place IDs/events, discovery IDs, channel keys,
legacy analytics targets and permanent collision are unchanged. Online P0 can
subscribe to place changes without reading this setting or render state.

## Calibration and measured workload

NORMAL retains the previous tested settings. Initial candidates used FAR DETAIL
52 and MAX DETAIL 70. Six-location WebGPU measurements were collected, then a
visual gate comparison revealed that the Main Hall remained blank even at MAX:
its expanded chunk starts about 73 units away. A runtime candidate with MAX
DETAIL 104 showed its facade at an acceptable observed draw/buffer increase.
Final FAR 80 includes that key view; MAX 104 includes more middle-distance
assets without turning all 19 chunks into DETAIL. Final values were rerun at all
six locations, not inferred from the initial candidate results.

Final measurement: Chrome WebGPU, 1280x800 DPR1, six named positions at Y24,
yaw0/pitch0.5/orbit36. Each location switches SHORT→NORMAL→FAR→MAX, then back to
SHORT; the next location inherits resident history. Each sample waits for policy
settling and 24 frames, then samples 45 frames. These are repeatable workload
observations on this machine, not device-independent performance guarantees.

| Location | Draw calls median SHORT / NORMAL / FAR / MAX | Resident mesh buffer bytes SHORT / NORMAL / FAR / MAX |
| --- | --- | --- |
| Gate | 580 / 1228 / 1501 / 1512 | 1029888 / 1551380 / 2766932 / 2890796 |
| Main Hall | 839 / 848 / 1161 / 1164 | 3208724 / 3307316 / 6955892 / 7237628 |
| Pond | 422 / 425 / 429 / 429 | 6838892 / 6838892 / 6851996 / 6915644 |
| Agora | 526 / 532 / 940 / 940 | 3321044 / 3349124 / 3721028 / 3752852 |
| Sports | 220 / 521 / 546 / 558 | 1371044 / 1412228 / 4452404 / 4511372 |
| Building 5 / west | 285 / 463 / 717 / 717 | 4430876 / 4439300 / 5121644 / 5150660 |

Gate MAX versus NORMAL adds 284 median draw calls and 1,339,416 mesh-buffer
bytes (~1.28 MiB). Maximum observed resident mesh buffers across all samples:
7,237,628 bytes (~6.90 MiB), at Main Hall MAX. Identical FAR/MAX draw counts in
some views reflect extra content outside the frustum, not failure to apply MAX.

Draw counts use engine `app.stats.drawCalls.total` (including passes, not unique
objects). Buffer bytes sum unique resident mesh vertex/index buffers, including
disabled retained layers; they exclude texture/uniform memory and engine/driver
overhead. JSON additionally records PlayCanvas's `_vram` counters and Chromium's
JS heap observation. Neither is claimed to measure total GPU/process memory;
JS heap varies with GC. Frame-interval p95 was 16.7–16.9 ms in these warmed
samples; it is not CPU/GPU execution time or evidence of FPS improvement. No GPU
timer-query measurement or physical-mobile performance claim is made.

The matrix JSON retains per-sample entity creates/destroys, chunk builds/destroys,
state transitions, cumulative counters and all four state counts. A settings
upgrade naturally creates newly required detail; zero churn is only expected
when no residency/detail change is needed. The old-seam 20-crossing regression
still reports zero creation/destruction/transitions after warming. The original
comparison against legacy 18,390 created/destroyed entities remains in the base
architecture record, and is not a preset-vs-preset FPS comparison.

## Validation and delivery limits

- Node World suite: 54/54 before the final main sync; 100/100 after including
  the independent network-foundation regression suite. Campus QA and both Reality
  validators pass.
- All 7 source mutation proofs killed with clean baseline restoration: Agora
  ownership, hysteresis, center distance, AREA/RC coupling, missing legacy mapping,
  MAX removing campus vista, settings change destroying all resident handles.
- Pure tests cover preset ordering and all tier bands, storage/reload/failure,
  unchanged tour/control saves, no whole-world rebuild, bounded reconciliation,
  MAX corner coverage, camera range and unchanged semantic resolution.
- Actual WebGPU: all 24 location/preset combinations, MAX→SHORT return, BASE and
  nearby root GUID retention, hidden distant details and correct place labels.
- Actual controller Gate→Hall→pond and tour 2/2 passed in every preset. Existing
  33-facility GPU QA, flat track/aircraft clearance/Agora, far unload/restore and
  ACTIVE↔NEAR identity checks still pass. No repeating whole-campus flicker or
  missing terrain was observed. Discrete far unload and dither remain limitations.
- Mobile Chrome emulation 390x844: setting selection, MAX persisted after reload,
  tour stage2 retained. Panel y320..532, tour ends y291, joystick starts y700;
  selector height44. Physical-device coverage is not claimed.
- Reproduce matrix with `qa-view-distance-runtime.mjs` in a disposable local or
  PR-preview tab (it intentionally writes that origin's preference/tour). Run
  `qa-spatial-mutations.mjs` alone, never concurrently with source readers.
- Exact final head, CI and preview checks are in the PR delivery record. PR stays
  open, not merged. This PR adds or activates no Realtime, online tables, Presence,
  remote players or chat; the independent main-branch foundation is preserved.

Next action: Online P0 Network Foundation integration (not implemented here).
