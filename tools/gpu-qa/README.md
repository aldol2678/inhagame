# ALDOL GPU QA preflight (non-canonical candidate)

Portable read-only QA tooling for ALDOL Code v0.6, ALDOL Cloud R1.4, and INHA WORLD. This directory is a candidate, not a production deployment. No GitHub Actions, Cloud VM startup, database, token, or network-write dependency.

Requirements: Python 3.10+, Python Playwright, Chromium. Run from repository root.

- Unit policy QA: python3 -m unittest discover -s tools/gpu-qa -p 'test_*.py' -v
- GPU preflight: python3 tools/gpu-qa/preflight.py --output /tmp/gpu-preflight.json
- Optional local World preflight: python3 tools/gpu-qa/preflight.py --url http://127.0.0.1:4187/campus/ --output /tmp/world-gpu.json
- Only on a trusted local fixture: add --software to explicitly allow unsafe SwiftShader fallback. The flag is restricted to literal loopback hosts.
- Set GPU_QA_CHROMIUM_PATH or --browser-path when using a system Chromium.

Statuses:

- READY_RENDER_QA: WebGPU device created or WebGL2 clear/readPixels checked. This is only a browser preflight, NOT a rendered-world PASS.
- BLOCKED_GPU: Neither API usable. Run existing engine logic/NullGraphicsDevice and asset checks separately, then schedule real-GPU visual QA.
- BLOCKED_BROWSER: browser launch or navigation/probe blocked by execution environment. Does not prove GPU unavailability.
- Actual application FAIL is determined only by a running application test.

The tool uses a temporary loopback web page for a trustworthy origin; about:blank is not reliable for WebGPU. If the remote browser cannot navigate even to the loopback fixture, the result is BLOCKED_BROWSER.

INHA WORLD QA sequence: Run node apps/world/qa.mjs and relevant Node tests; use this preflight; if READY_RENDER_QA run a real PlayCanvas browser harness with screenshot and pixel/interaction checks. Software-WebGL success never substitutes for real GPU performance or Android/iOS checks.

ALDOL Code/Cloud: invoke this CLI from a trusted local QA job. Do not add a public HTTP command execution endpoint. Return the JSON report as non-canonical evidence, include source SHA and test logs, and do not auto-approve release. The GCP Code Control v0.2.0 VM is NOT this Code v0.6 local candidate and has not been changed.