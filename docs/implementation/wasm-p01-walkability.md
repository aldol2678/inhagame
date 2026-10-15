# WASM-P01: batched static NPC walkability

**Decision: KEEP AS EXPERIMENT. Production adoption is not justified.**

This is one freestanding C++/WebAssembly kernel, not a navigator replacement. The
unchanged JavaScript navigator remains the default. The opt-in prototype only fills
complete 256-cell batches in its existing one-time grid warm-up. Route search,
canonical corridor exceptions, NPC movement, social state and persistence stay in JS.
No merge, deployment, database operation or feature activation is part of this spike.

## Source and candidate selection

Work started at public `main` `1b68d1cbbcb0fe08787be2c9e7d73a3b2bea30ba`.
Before final verification, the branch was advanced to current release-A main
`07e18ef418c7f987dc45a144ffd0fa240d9fd417`, without bringing in any receipt #185 changes.
The benchmark records its base SHA and the measured source hashes in
`apps/world/tests/wasm-p01/results.sources.json`.

| Candidate | Actual boundary and reason |
| --- | --- |
| NPC proximity / spatial selection | At most 48 NPCs; nameplate distance/filter/sort runs every 0.3 s. Too little arithmetic to justify a second runtime |
| Path search / Recast | Existing #243 is an opt-in JS-authoritative Recast shadow; it is not adopted production navigation. #270's DetourCrowd benchmark is now on main, but JS waypoint following and crowd steering are not equivalent workloads |
| Geometry: **selected** | `createNpcNavigator().warmGrid()` already batches 256 independent points. The real runtime invokes it from `stepStartup()` with a 4 ms budget before placing deferred NPCs. One immutable geometry upload can amortize many narrow-phase polygon probes |
| Vector/animation batches | Small scalar trigonometry is intertwined with PlayCanvas transform calls. Porting engine/DOM/GPU calls would violate the intended boundary |

Current READY population: **48 NPCs**, with 40/39/42/41 visible anchor positions in
morning/class/lunch/evening. The canonical grid has **56,088 cells (228 × 246)**,
**978 filtered obstacles**, and a **13-vertex pond**. This is startup work, not a
56,088-point per-frame workload. NPC anchor batches are workload-scale controls,
not a claim that the runtime currently batches these anchors for walkability.

## Boundary and safe runtime route

- C++: bounds/AABB checks, bucket lookup, polygon inclusion and clearance for a batch
- JS: immutable packing, input/output copies, original `walkable()` fallback,
  corridor override, scheduling, grid ownership and every route/gameplay operation
- `?npcWalkabilityWasm=1` lazily imports the adapter and downloads the committed
  same-origin module. No awaited initialization is inserted in NPC boot
- Until ready, and on fetch/compile/ABI/trap failure, warm-up uses original JS
- Invalid-size or non-boolean batch results cannot partially update the grid
- A module arriving after the grid is already warm has no benefit. It does not
  rebuild the grid or force a later frame to repeat startup
- Read-only opt-in diagnostics: `window.__NPC_WALKABILITY_WASM_P01__.status()`
- Page teardown discards the kernel; BFCache keeps the existing navigator state
- With the flag absent, there is no extra adapter or WASM request

The pond is always blocking when its original predicate says so. Only legacy
obstacle rejection can use the existing canonical-network exception. A C++ result
requesting an exception is resolved by original `walkable()`, never by a new graph
implementation. No per-point JS↔WASM calls are used.

## Correctness and floating-point policy

The ABI uses f64, no fast-math, no fused contraction, no SIMD or threads, and no
WASI/libc/imported functions. Cached tangent/length values are prepared using the
same JS `Math.hypot` as the original geometry. C++ radius distance uses f64 sqrt.

A result close to a ray intersection or strict radius boundary, within
`1e-10 * (1 + abs(x) + abs(z))`, asks original JS to decide. This is a conservative
fallback region, **not an allowed output mismatch or geometry expansion**. Bounds
and AABB comparisons remain inclusive and clearance remains strictly `< radius`.
Coordinates in immutable geometry are bounded to ±1e6, avoiding square overflow;
nonfinite and nonnumeric query coordinates preserve canonical rejection.

Tests require exact Uint8 output equality, including every canonical grid cell,
all period anchors, obstacle vertices/edges, clearance ±epsilon, bucket boundaries,
a rotated pond with perpendicular offsets and duplicate closing vertex, empty and
0/1/255/256/257 batches, 100,000 inputs, repeated calls, retained copied results,
memory growth, partial JS warm-up followed by real WASM, eager/sliced route equality,
invalid bytes, missing load, traps, teardown races and malformed batch output.

The numerical fallback and the existing graph exception account for 9,243 of the
56,088 first-grid classifications in the measured cold WASM runs. This conservative
16.48% fallback rate substantially limits end-to-end savings.

## Reproduction

No new npm production dependency is added. A compatible Clang + LLD is enough:

```sh
CXX=clang++ WASM_LD=/path/to/wasm-ld \
  sh apps/world/npc-factory/wasm/build-walkability-p01.sh
node --test apps/world/tests/wasm-walkability-p01.test.mjs
node apps/world/tests/wasm-p01/benchmark.mjs
bash scripts/public-ci.sh
npm ci --ignore-scripts --prefix apps/world/tests/browser
WORLD_BROWSER_EXECUTABLE=/usr/bin/google-chrome \
  node apps/world/tests/browser/wasm-walkability-p01-smoke.mjs
```

The compiler first passed a freestanding compile/link/run smoke: `add(20,22)=42`,
242 bytes, zero imports. Only Debian **clang-19, lld-19, libclang-cpp19**, each
**1:19.1.7-3+b1**, were downloaded and unpacked into an isolated task folder.
Existing host libraries were reused. PATH and LD_LIBRARY_PATH were command-local;
there was no global installation, sysroot, WASI, wasi-libc or Emscripten expansion.
Exact official package URLs and SHA-256 hashes are in `toolchain.json`.

`walkability-p01.build.json` binds C++ source, build script and the actual committed
binary by SHA-256. Tests validate this manifest; rebuilding refreshes it. Public CI
executes that binary; it does not install a C++ compiler. This leaves manual compiler
reproduction as an explicit maintenance cost rather than silently adding a compiler
to the production deployment pipeline.

## Measurement method

`js-baseline.json` was captured before C++ implementation at the initial source base.
Its 256-point spatially distributed sample is explicitly named `stratified-256`,
not a real contiguous runtime slice. Its scalar JS grid p50 was 58.02 ms; do not use
that earlier run as the denominator for the later paired comparison.

The final `results.json` contains all samples, environment, checksums and inputs:

- Node 24.19.0, Linux x64, Intel Xeon Platinum 8573C shared cloud execution host
- Identical points and geometry for original JS, cached-geometry JS and real WASM
- 20 warm-up passes, 31 samples, repeated calls for small inputs; ordering rotated
- Small (8), all actual NPC period anchors, distributed 256, contiguous first/middle/
  final 256-cell slices, 4,096, and the actual full grid
- Whole-call WASM includes input packing/copy, output copying and original-JS fallback
- Separate instrumented input, kernel, output/fallback timings; timer overhead matters
  for microsecond-size batches, so use uninstrumented whole-call distributions first
- Seven complete passes over every actual contiguous grid chunk
- Fifteen actual `navigator.warmGrid(4)` builds per implementation, including point
  construction, validation and grid writes. These grouped runs are supplemental,
  sensitive to order/JIT and host scheduling; they are CPU totals, not FPS
- Seven **separate fresh processes per implementation** for cold-ish startup.
  Each includes optional disk read, compile/instantiate/pack, navigator setup and the
  first real sliced warmGrid. Common campus context construction is excluded equally.
  OS file cache is not flushed; this is not an internet-download measurement

### Observed whole-call warm CPU timings (ms, p50 / p95)

| Input | Original JS | Cached-geometry JS | WASM |
| --- | ---: | ---: | ---: |
| 40 morning NPC anchors | 0.1096 / 0.2108 | 0.0219 / 0.0536 | 0.0065 / 0.0147 |
| 8 distributed points | 0.0182 / 0.0430 | 0.0155 / 0.0564 | 0.0142 / 0.0199 |
| Contiguous middle 256 | 0.5596 / 0.8283 | 0.2389 / 0.4353 | 0.1596 / 0.2137 |
| Final 24-cell tail | 0.0038 / 0.0068 | 0.0005 / 0.0006 | 0.0012 / 0.0021 |
| 4,096 distributed points | 8.9835 / 14.6065 | 7.0386 / 13.8724 | 6.0883 / 11.8340 |
| Full 56,088-point grid | 111.8334 / 134.0186 | 87.1081 / 99.5575 | 78.9691 / 90.9697 |

The full-grid instrumented medians are 1.222 ms input, 5.353 ms kernel and
75.870 ms output plus original-JS fallback. Separately sampled medians do not sum
exactly. Quoting just the 5.353 ms kernel would grossly overstate the benefit.

Actual warmGrid CPU p50 was 133.41 ms original JS, 64.00 ms cached JS and 59.06 ms
WASM. Cached geometry recovers most of the observed warm benefit. The final tiny
24-cell tail is faster in cached JS than WASM, so there is no universal crossing win.

### Cold-ish actual startup (7 independent processes each)

| Implementation | Total p50 | Observed range |
| --- | ---: | ---: |
| Original JS | 90.62 ms | 73.87–121.51 ms |
| Cached-geometry JS | 168.02 ms | 85.42–375.36 ms |
| WASM | 101.79 ms | 73.26–288.53 ms |

WASM load/compile/instantiate/packing p50 is 17.35 ms. Its first actual grid CPU p50
is 80.55 ms versus JS 82.44 ms. The distributions are noisy and overlapping; these
results do **not** establish a reliable startup win. The measured WASM total median
is about 12% higher. Cold cached-JS results also show JIT/host variability, so this
spike does not authorize adopting that alternative either.

The existing 4 ms slice budget is checked after a 256-cell chunk. On this shared
host, actual warm slice p95 was 10.13 ms JS and 6.99 ms WASM, with larger outliers.
Neither stays strictly inside 4 ms. These are synchronous CPU timings affected by
host scheduling, not browser animation-frame or 60 Hz guarantees.

## Cost, compatibility and decision

- Binary: **1,369 bytes**, zero runtime imports
- Lazy JS adapter: **5,828 raw bytes**; it is fetched only with the query flag
- Default runtime source additions: **1,963 raw bytes** across the two existing files
- Packed immutable geometry: **303,088 bytes**; full-grid memory: **1,376,256 bytes**
- Transfer each call: 16 bytes per input point plus a copied 1-byte output; graph/
  numerical fallback adds original JS work. The runtime only uses 256-point batches
- Maintenance: C++ source/build artifact parity, independent float-boundary tests,
  three toolchain host packages for reproduction and a second numerical implementation
- Debugging: JS owner/fallback remains inspectable; stripped WASM has poorer step-through
  diagnostics. Debug rebuilds can omit strip/add symbols, increasing artifact size
- Compatibility: requires ordinary WebAssembly f64; no shared memory, COOP/COEP,
  SIMD, GPU API or worker support required. Failure returns to JS. Browser smoke is
  intentionally separate from Node proof
- No claim is made for Safari/Firefox, mobile GPU, thermal behavior, memory pressure,
  end-user networking, Production FPS or an actual user device

Keep the module and opt-in path experimental. Do not enable it by default or bundle
compiler work into normal deployment. A promotion would require stable cold
end-to-end improvement in real supported browsers/devices, runtime load-race and
frame-gap measurements, and benefit beyond cached JS large enough to justify the
extra build/debug surface. Existing Recast/DetourCrowd findings remain separate.

## Verification boundary

The dedicated hosted Chrome workflow loads actual application modules, the committed
WASM and real canonical data over loopback HTTP, verifies full-grid equality, executes
the warmGrid batch hook, proves disabled loading is inert and missing/corrupt module
fallback, and records browser measurements as an artifact. It blocks off-origin
requests. It is not a full-game, live Production, Preview or device FPS test.

Local Chromium was attempted normally and failed with `socket() failed: Operation
not permitted`; no sandbox restriction was bypassed. Hosted verification owns that
remaining browser check. No performance threshold is used as a flaky CI gate;
correctness and fallback contracts are hard gates. Existing public checks are retained.
