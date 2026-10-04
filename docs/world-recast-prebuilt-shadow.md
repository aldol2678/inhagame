# Recast NPC shadow: validated prebuilt navmesh

The standalone PoC imports a validated prebuilt navmesh in a Worker by default, with no production
navigator switch. `/recast-npc-poc.html?navMesh=runtime` exercises explicit cold generation in a
Worker. For local serving, first generate the derived files:

```sh
npm ci --ignore-scripts --prefix apps/world/tests/recast-runtime
npm run build:artifact --prefix apps/world/tests/recast-runtime
node apps/world/dev-server.mjs
```

The build writes `apps/world/recast-data/campus.manifest.json` and a content-addressed
`<binary-sha256>.bin`. These derived files are ignored by Git. The versioned World vercel.json runs build-recast-shadow.sh on deployment, installing the locked
Recast dependency with devDependencies included and generating these files before serving the World root.
The same real-WASM acceptance and round-trip gate must pass for a deployment build to succeed.
The existing `scripts/public-ci.sh` Recast test step also builds and verifies the artifact locally.

## Input and version contract

The fingerprint includes the full resolved population, READY expansion, purposeful schedules
and destinations, actual navigator bounds/filtered obstacles/projected pond/clearance/sampling
constants, resolved canonical corridor graph, surface settings, all Recast settings and query
limits. Effective geometry is exposed as a snapshot by the same navigator that owns walkability.
Sources owning walkability, polygon overlap, graph queries, route solving, the adapter and the
artifact format are additionally hashed. Upstream geometry/anchor changes are captured through
their resolved values; a newly introduced logic dependency must be added to `RECAST_SOURCE_URLS`.

The adapter checks the manifest schema, adapter/config/query contract, current input SHA-256,
manifest checksum, binary length/SHA-256, and the pinned solo MSET v1 / DNAV v7 binary header
before loading WASM. Import requires a loader declaring package version 0.43.1. The browser
loader declares it only for the pinned URLs, while the Node loader reads the installed wrapper,
core, generators and WASM package versions. No cached verdict is stored or used.

Missing, corrupt, stale or incompatible artifacts return an explicit `ERROR` on the prebuilt
page. There is no automatic generation fallback. The runtime query parameter selects a separate explicit cold
path. Each successful load recomputes the entire shared schedule evaluation, including legacy
comparison and failure diagnostics. All endpoint, partial-path and segment-safety checks apply
to generated and imported navigators. Query/filter/mesh ownership is released on teardown.

## Verification

```sh
node --test apps/world/tests/recast-navigator-poc.test.mjs \
  apps/world/tests/recast-schedule-evaluation.test.mjs \
  apps/world/tests/recast-navmesh-artifact.test.mjs
npm test --prefix apps/world/tests/recast-runtime
npm ci --prefix apps/world/tests/browser
node apps/world/tests/browser/recast-prebuilt-smoke.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
```

The actual-WASM build gate regenerates the mesh, evaluates the current schedules, audits every
accepted route independently, exports/imports through the browser artifact loader, and requires
identical metrics, diagnostics and all waypoint arrays. It writes the binary atomically and the
manifest last, only after both gates pass. The integration test reads the emitted files back.
Current schedule acceptance is 48/READY, eligible 200/200 and moving 141/141 with zero failures,
unsafe returned routes and incorrect endpoints. A real disconnected-surface fixture must remain
unreachable after import. Unit tests cover stale inputs/config/version, corruption, missing
files and imported resource ownership.

The offline browser smoke serves the actual page and application sources/data. Only the two
pinned esm.sh entry points are answered with local pinned npm exports; those exports execute
real Recast WASM. Every other off-origin request is blocked. It compares the actual
`window.__RECAST_NPC_POC__` export with the rendered JSON, requires prebuilt/runtime metrics to
match, and checks missing/stale/corrupt artifacts return ERROR before any engine loading.
Optional `WORLD_RECAST_PLAYWRIGHT_MODULE` and `WORLD_RECAST_BROWSER_EXECUTABLE` permit using a
known local installation; record its versions separately from the project's browser package.

Performance values are reported separately as artifact validation/loading, navigator initialization
and total evaluation time. Node round-trip import runs after WASM is initialized and is a warm
measurement. A fresh offline browser load includes its engine loading. Neither proves the same
latency for a Vercel Preview, network conditions or a user's device. Legacy comparison remains
expensive, but runs off the UI thread by default. Representative runtime behaviors remain further work.

Production stays HOLD: this gate covers `CAMPUS_PURPOSEFUL_SCHEDULE_ONLY`, not all runtime
wander/social/recovery/Biryong behavior or deployment readiness.

## Worker execution and UI ownership

The standalone page runs population preparation, artifact validation, Recast initialization and
the unchanged shared schedule evaluator in one module Worker. No functions, DOM objects or WASM
handles cross realms. PHASE messages describe progress; only the final RESULT publishes the full
`window.__RECAST_NPC_POC__` and JSON. Elapsed, navigator, artifact and schedule timings remain separate.
This change moves synchronous work off the UI thread; it does not promise faster total computation.

Cancel and restart terminate the owned Worker, including a synchronous legacy calculation. Normal
completion releases the navigator in finally, then closes/terminates the Worker. Termination also
discards the realm's WASM memory on cancellation. Request IDs and page generations reject late
responses. pagehide cancels outstanding work; a restored BFCache page starts a fresh evaluation.
Worker startup, module or message errors report ERROR with no silent main-thread fallback.
An explicit `?navMesh=prebuilt&execution=main` URL retains the shared evaluator as a diagnostic
baseline. The default prebuilt path requires generated artifacts; explicit cold generation
also runs in the Worker. The World deployment build generates the artifacts. No production
NPC navigation switch is included.

Canonical JSON readers select disk versus fetch by file/HTTP module URL, consistent with existing
road readers. This supports browser Workers (which have fetch and no window), while preserving
the same Node data, canonical geometry and browser behavior.

The offline smoke rewrites only bare npm Recast imports to local module URLs in its fixture
server, because Worker modules do not inherit page import maps. Application Worker sources are
served unchanged. It compares Worker cold/prebuilt and explicit main-thread results, measures
requestAnimationFrame gaps and long tasks, clicks a test button during legacy computation, tests
cancel/restart and failed Worker modules, and rejects stale/corrupt/missing artifacts before WASM.
Client unit tests additionally exercise message errors, stale IDs and queued completion after cancel.
