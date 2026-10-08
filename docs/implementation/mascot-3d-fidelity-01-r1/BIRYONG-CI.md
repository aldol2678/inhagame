# Biryong CI investigation — read-only

Inspected complete job logs and downloaded diagnostic artifacts for [optimizer run 37717563797](https://github.com/aldol2678/inhagame/actions/runs/37717563797) (job 113117467594, artifact 11524586697) and [immutable control run 37717563835](https://github.com/aldol2678/inhagame/actions/runs/37717563835) (job 113117467613, artifact 11524223696). No CI settings, budgets, Biryong code or workflow executions were changed for this investigation.

## CONFIRMED

- Optimizer contracts 6/6 and strict optimization passed. Failure occurred later at Biryong visual performance; downstream canary/rollout steps were skipped by the failed job, not verified.
- Optimizer checkout/sampler was merge candidate `bba152a5149ecd15992a00d68def00691f5822ae` (PR head `80da3eac51102ab019cd005a5a689f9698a9cf95` into main `718cdf33b74287e8312f2b36fde04ec693c3f4c8`). LOW Visual OFF p95 **433.4ms** versus 85ms limit. This is NOT a separately measured immutable main result. LOW Visual ON p95 466.6ms; ratio 1.077 is not a valid acceptance result because the baseline fails.
- Immutable control source: `e49419c39d884515f2402a2f3a23fe4c754b8882`, tree `6dbb4d7de7b112d8e97953a63b60515649453364`. Candidate: `80da3eac51102ab019cd005a5a689f9698a9cf95`, tree `e3e4be35e3dbd8ca246f6c7fad29224a37ef9020`. Both used candidate sampler/locked engine, same job/runner, sequential main then candidate, LOW Visual OFF, 90 frames each.
- Both immutable main and candidate: p50 300ms, p95 **600ms > 85ms**, p99 ~600ms >160ms. Long-frame rates 0.8556 / 0.8889 >0.35. Result **INCONCLUSIVE**, not PASS and not proven PR regression.
- Recorded scene matches: 1280×720 DPR1, drawing buffer 1024×576, position [0,1.15,75], yaw0/pitch0.3758378769/distance3.5, DAY/CLEAR, LOW, shadows off, 140 draw calls. Render components differ: main 2278 / candidate 2281. Therefore full scene identity is not established despite matching camera/settings.
- WebGL2 driver is ANGLE Vulkan SwiftShader (software). Receipts explicitly say GPU time was not measured; physical-device, thermal and battery measurements are absent. Browser/shader cache order effects are not controlled.
- The immutable control predates PR #301. Its comparison to #305 includes 57 intervening files / graphics changes from `e49419c` to `718cdf3`; this is not an isolated #305-only experiment.

## SUSPECTED

Software rasterization and runner CPU scheduling/contention are plausible contributors to these very high frame intervals. The 433.4ms versus 600ms figures come from different jobs and cannot quantify model cost. No captured CPU/GPU profile proves the dominant cause.

## UNKNOWN

Whether PR #305 causes a measurable Biryong regression remains unknown. Neither equal p95 values on a failing baseline nor unchanged draw-call count proves absence of regression. These logs/artifacts contain no direct causal evidence linking Annyongi geometry to the Biryong failure. Hardware performance and the source of the three-component count difference are not established by these receipts.

## Minimum next verification plan (not executed)

Use PR parent `718cdf33b74287e8312f2b36fde04ec693c3f4c8` and the exact candidate head, the same pinned sampler/browser and controlled scene. First establish a valid baseline without changing budgets; collect a CPU/render profile and confirm visible asset/scene identity if it still fails. Then compare in a small alternating A/B order to reduce order effects. Hardware PC/Android captures are separate evidence; they do not retroactively turn the failed CI into PASS. Do not repeatedly rerun the existing inconclusive job.

Receipts: [main](biryong-main.json), [candidate](biryong-candidate.json), [comparison](biryong-comparison.json), [optimizer diagnostics](biryong-optimizer-performance.json).
