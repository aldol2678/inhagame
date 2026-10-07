# INHA Native P0-B: Chromium Worker Crowd Benchmark

Status: EXPERIMENT / NO PRODUCTION AUTHORITY

P0-B moves the successful DetourCrowd benchmark into a real Chromium module Worker. It keeps the current JS navigator authoritative.

## Measures
- pinned recast-navigation@0.43.1
- validated prebuilt campus navmesh imported in a Worker
- 48 / 100 / 200 agents, 180 fixed 60 Hz steps
- Worker mean / p95 / max update cost
- active agents, accepted targets, invalid agents and overlap pairs
- main-thread rAF gaps, timer gaps and Long Tasks
- desktop Chromium plus mobile viewport/touch emulation

The mobile-emulation pass is not real mobile CPU/GPU evidence. A physical Android measurement remains required.

## Run
```sh
npm ci --prefix apps/world/tests/recast-runtime --ignore-scripts
npm ci --prefix apps/world/tests/browser --no-audit --no-fund
cd apps/world/tests/browser
npx --no-install playwright install --with-deps --only-shell chromium
node recast-crowd-worker-benchmark.mjs
```

The runner rebuilds and validates the content-addressed Recast artifact before Chromium starts. The Worker imports that prebuilt binary; it does not generate navmesh at runtime.

Evidence stays `authorityEffect: NONE` and `productionCutover: false`. Promotion requires a physical Android run, shadow-only integration with the production NPC runtime, schedule/quest/dialogue/social parity, bounded Worker backpressure, and JS rollback.
