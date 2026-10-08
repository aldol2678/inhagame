# Biryong performance CI investigation — 2026-10-08

Status: environment-contract repair candidate; performance recovery **not yet demonstrated**.
Base main: `718cdf33b74287e8312f2b36fde04ec693c3f4c8`.
No main merge, Production deployment, runtime/asset edit, budget relaxation or skipped performance checks.

## Original failing evidence

| PR / run | Comparison | LOW p95, control / candidate | Runner image | Result |
| --- | --- | --- | --- | --- |
| [304 / 37715983534](https://github.com/aldol2678/inhagame/actions/runs/37715983534) | Same PR source, Visual OFF / ON | 249.9 / 250 ms | ubuntu-24.04 / 20261004.327.1 | INCONCLUSIVE |
| [305 / 37717563835](https://github.com/aldol2678/inhagame/actions/runs/37717563835) | Historical immutable main / PR head, both OFF | 600 / 600 ms | ubuntu-24.04 / 20261004.327.1 | INCONCLUSIVE |
| [306 / 37720919917](https://github.com/aldol2678/inhagame/actions/runs/37720919917) | Historical immutable main / PR head, both OFF | 433.3 / 416.7 ms | ubuntu-24.04 / 20260927.320.1 | INCONCLUSIVE |

All used WebGL2 with ANGLE SwiftShader, 1280x720 CSS / DPR 1, 1024x576 LOW drawing buffer, DAY/CLEAR, no LOW shadows, 30 warmup and 90 sampled RAF intervals. The three jobs were distinct VMs/regions; common software-renderer class does not mean identical execution environments. Same-runner pairing applies within #305/#306, not across the three runs. Browser binaries were selected with the moving system `chrome` channel; their exact versions were absent from these receipts.

The immutable control in #305/#306 is `e49419c39d884515f2402a2f3a23fe4c754b8882`, **not** their current base main `718cdf33...`. It predates graphics integration #301. Therefore its candidate delta includes intervening main changes and is not an isolated estimate of the individual PR effect. Preserve this historical control, but do not call it latest main or attribute its entire delta to the candidate PR.

Source review: #304 changes only CI scope/workflow files; no rendering source or assets change. #305 changes the character model/GLB; #306 changes room/catalog code and data. Shared-runtime regressions in #305/#306 remain UNKNOWN until a valid same-environment baseline comparison. Similar or smaller p95 values against an invalid baseline do not prove no regression. The original #305 run belongs to head `80da3eac...`; later R1 heads require their own evidence.

## Reused #309 diagnostic evidence

[Run 37725352457](https://github.com/aldol2678/inhagame/actions/runs/37725352457), sampler `2f991bb59a32fbaa83bbd808bb7485f04e3db085`, immutable control `e49419c...`, artifact `11527631859` (ZIP SHA-256 `18f35306fc1b0b04ca396fbed0e508f7b38ec0de76f21ddca0d5a6fd0392c54a`). Actual browser: Chrome 154.0.8037.57.

| Diagnostic window | RAF p95 | Postrender interval p95 | Update CPU-wall p95 | Render submission CPU-wall p95 |
| --- | --- | --- | --- | --- |
| Original 1024x576 | 433.2 ms | 427.1 ms | 5.2 ms | 3.7 ms |
| Half-size 512x288 | 133.3 ms | 126.4 ms | 6.1 ms | 3.5 ms |

The baseline CPU profile was predominantly idle between callbacks. This and resolution sensitivity support a software raster/compositor bottleneck rather than dominant synchronous application JavaScript. They are not GPU-time measurements or proof of a particular browser defect. The trace reached its bounded event cap during the half-resolution window; collection ended DIAGNOSTIC_PARTIAL before the restored-baseline window. Do not describe this as a completed A/B/A experiment or acceptance evidence. Do not reduce the acceptance resolution based on it.

A separate local prepatch main LOW-only probe (Chromium 153.0.8010.0, same engine and scene, different host) was also INCONCLUSIVE: p95 150 ms, p99 183.4 ms, long-frame rate 0.9111. It is supporting evidence only, not hosted or exact-pinned-browser acceptance.

## Minimal repair in this branch

- Both performance entry points install the Chromium revision locked by Playwright 1.63.0 (revision 1243, version 153.0.8010.12), instead of silently using system Chrome. Fail closed on an unexpected running version; no fallback to system Chrome.
- Use the explicit Ubuntu 24.04 runner family. This does not freeze GitHub's image revision or VM CPU; record those differences instead of claiming complete host reproducibility.
- Retain browser, engine, Node, kernel, CPU, image, run and job identity in receipts. Cross-environment, missing and malformed receipts cannot become a performance PASS even when frame numbers look good.
- Keep the immutable historical control, rendering workload, sample counts, LOW p95 85 ms, all other absolute/ratio/long-frame budgets and non-passing INCONCLUSIVE semantics unchanged.
- Preserve #304, #305, #306, #308 and #309 branches. This candidate does not copy their changes, alter their results or imply their acceptance. No shared browser harness or product code is edited.

## Verification and limits

- New environment-mismatch test reproduced the prior erroneous PASS, then passed after the repair.
- Focused control, budget and sampling diagnostics: 23/23 PASS. Workflow YAML parsing, Node syntax and git whitespace validation passed.
- Collected environment metadata against the real installed engine/package manifest. A real local Chromium 153.0.8010.0 launch was rejected before scene sampling; failure receipt retained, no performance PASS emitted.
- Local installation of the exact pinned Chromium failed because the download was not a valid ZIP. No repeated manual install attempt or substitute-browser performance claim. Hosted installation and measurement must establish the remaining result.
- Existing passed product tests were not rerun locally. Hosted checks on the repair head remain independently required.

Next completion gate: obtain the repair head's hosted comparison and visual-performance receipts once. If the valid pinned historical control still exceeds the unchanged budget, performance recovery remains BLOCKED. Use the recorded environment and existing trace to evaluate a suitable rendering runner or a separately evidenced runtime optimization; do not convert the invalid baseline into a pass. Any paid-runner, permissions, merge or Production change needs separate authorization.
