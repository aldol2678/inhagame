# V2-FIX validation

2026-10-07. Latest main and starting PR head were read directly before editing (see README). This report and its images describe the source tree submitted by this PR update. Remote exact-head check links/status are recorded in the PR body after the run completes, avoiding a self-referential commit SHA in this file.

| Check | Result |
|---|---|
| World unit/integration suite | 3,625 / 3,625 PASS |
| Final focused camera + character loading | 31 / 31 PASS |
| Pinned PlayCanvas 2.22.4 real-GLB runtime | 11 / 11 PASS |
| Asset optimizer | 6 / 6 PASS; all 6 GLBs optimized, no fallback |
| World static QA | PASS |
| Recast shadow build | PASS |
| Legacy character WebGL2 smoke | PASS, 12 snapshots |
| Canonical / optimized | All 4 flight states pixel-identical; original front check also PASS |
| Deterministic Python regeneration | Byte-identical SHA256 before/after regeneration |
| Khronos validator | canonical + optimized: 0 errors, 0 warnings |
| Campus desktop 1280×800 | day + night PASS |
| Campus mobile portrait 390×844 | day + night PASS; real CDP touch input |
| Console fatal / page errors | 0 in all browser cases |

The 40 campus captures cover mounted, ascend, hover, forward, three-quarter view, descend, close zoom, first-person, landing and dismounted for each viewport/time combination. Framing assertions project every vertex, including the active morph deltas. The actual four states are asserted after pose convergence, not merely after a button is pressed. Landing is observed before automatic dismount. No test/assertion was removed or skipped.

Runtime regressions verify actual cloud-tip extension to Z < -3, recurling, independent morph instance weights, head counter-pitch, moving head/rider separation throughout transitions, bounded per-frame body/tail change, phase-continuous wing movement, ground settling, teleport rejection, private fill ownership, disposal, partial asset failures and first-person visibility.

The source GLB is 394,672 bytes (`5b53dd9a13e2123bab399f68483c3fa72259b75888edf67b9bab32553a53fc23`); optimized is 332,520 bytes (`72e616f07a41ba97562da62ab7b735631d7a21b99986131da5f83cf929ffd20a`). Both keep 12,188 triangles / 28 meshes / one material / no textures. Morph target data increases source size by 46,204 bytes versus V2 without increasing triangle count.

Local browser: Chromium 153 / SwiftShader WebGL2. The executable override was needed because the standard browser download was truncated in this workspace; remote CI uses Playwright's pinned Chromium installation. Portrait captures are viewport emulation, not physical-phone performance measurements. API and online calls are blocked/stubbed by the existing offline harness. Production deployment and online multiplayer are untested.

Visual assessment: the four states have different body axes, tail lengths/curves and wing silhouettes. Forward retains a forward-looking face while the tail extends horizontally behind the body. Descend uses a bowed tail and broad low-amplitude glide. Night retains the V2 pale-blue palette and facial details. The public QA rider and missing emoji glyphs in this runner remain visible limitations of the review environment.

Evidence: [campus-results.json](campus-results.json), [pose-results.json](pose-results.json), [glb-validation.json](glb-validation.json), [studio-results.json](studio-results.json).
