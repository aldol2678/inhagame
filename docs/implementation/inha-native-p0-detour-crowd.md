# INHA Native P0: DetourCrowd WASM benchmark

Status: EXPERIMENT / NO PRODUCTION AUTHORITY

This experiment measures whether the existing C++ Recast/Detour WebAssembly stack is a
useful next step for INHA WORLD NPC locomotion. It deliberately does **not** switch the
production navigator, change NPC authority, alter database state, or deploy a new runtime.

## Scope

- pinned `recast-navigation@0.43.1`
- the same campus walkability and corridor geometry used by the current Recast shadow PoC
- real `DetourCrowd` WASM
- agent tiers: 48, 100, 200
- fixed 60 Hz stepping
- current JS waypoint follower measured beside the WASM crowd as a reference
- no performance pass/fail threshold in CI

The JS and WASM measurements are **not feature-equivalent**. The JS side advances existing
waypoints. DetourCrowd also performs local steering, acceleration constraints, obstacle
avoidance and separation. Numbers are therefore directional evidence, not a winner/loser
microbenchmark.

## Run

```sh
cd apps/world/tests/recast-runtime
npm ci --ignore-scripts
npm run benchmark:crowd
```

The command emits JSON with setup time, aggregate update time, mean/p95 frame cost,
movement, remaining target distance, overlap count and coarse RSS delta for each tier.

Public CI only runs a 48-agent smoke gate. It verifies that the pinned real WASM runtime
can create 48 active crowd agents, accept all move targets, step them, and leave
`authorityEffect: NONE`. CI intentionally does not assert timing thresholds.

## Promotion gate

Do not make DetourCrowd authoritative from this experiment alone. A later cutover needs:

1. browser/Production-device measurements, especially mobile;
2. route and endpoint parity with the current navigator;
3. crowd overlap/stall regressions characterized at realistic spawn distributions;
4. Worker/main-thread ownership decided and measured;
5. NPC schedule, dialogue, quest and social-motion regressions green;
6. an explicit rollback path to the JS navigator.

P0 answers one question only: can the existing native WASM layer run a realistic INHA
WORLD crowd workload safely enough to justify deeper integration?
