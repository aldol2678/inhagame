# INHA WORLD Promo Capture P0

Promo Capture turns the existing offline Chromium QA harness into a deterministic source-footage pipeline for trailers, shorts and code-driven editors such as Remotion. It does **not** call Production, log in, use secrets or fabricate gameplay. Captures are generated from the checked-out repository revision with the actual World renderer and existing runtime controllers/UI.

## Contract

The human/agent input is `capture-manifest.v1.json`. Keep it semantic: request `main-hall`, `jeongseok-library`, `student-center`, or a Full Map POI rather than copying current world coordinates into a prompt. The runner resolves those names from current game modules at capture time.

The manifest `output.timelineFps` is the intended downstream edit/composition timeline, not a claim about the native Playwright source recording frame rate. The pinned Playwright 1.63 `recordVideo` API controls video size but does not expose a capture FPS option.

Each shot produces:

- `<shot-id>.webm` — Playwright browser recording. It includes boot/setup pre-roll so evidence is preserved. The native temporary recording lives outside the artifact directory and is deleted after the named copy is saved, so the artifact does not retain a duplicate raw video.
- `thumbs/<shot-id>.png` — final-frame visual receipt.
- `capture-index.json` — canonical machine-readable handoff containing source head, manifest hash, renderer, file hash and the usable edit window as `edit.inMs`, `edit.outMs`, and `edit.durationMs`.

`source.mode` is `offline-real-render` and `source.productionClaim` is always `false`. A successful capture proves the checked-out game revision rendered and executed the declared shot offline; it is not a claim that the same pixels were recorded from the live Production URL.

## Run locally

From the repository root:

```bash
cd apps/world/tests/browser
npm ci --ignore-scripts --no-audit --no-fund
cd ../../../..
WORLD_SMOKE_DISABLE_WEBGPU=1 \
WORLD_SMOKE_BROWSER=chrome \
WORLD_PROMO_OUTPUT=test-results/world-promo-capture \
node apps/world/tests/browser/promo-capture.mjs apps/world/promo/capture-manifest.v1.json
```

The GitHub workflow **World promo capture** is deliberately `workflow_dispatch` only. Choose the exact Git ref and manifest path, then download the generated `world-promo-capture-<sha>` artifact. Public Actions never deploy Production from this workflow.

## Opus / coding-agent handoff

Give the agent the artifact and this instruction:

> Read `capture-index.json` first. Use only shots whose `result` is `PASS`. For every source video, trim to its `edit.inMs` → `edit.outMs` interval before creative editing. Treat `source.expectedHead` and every file SHA-256 as provenance. Do not describe the footage as a live Production recording because `source.productionClaim` is false. Build the trailer from the captured game footage; do not synthesize replacement gameplay. You may add titles, motion graphics, transitions, music and sound design around the footage.

A typical follow-up request can then be as small as:

> Make a 15-second INHA WORLD trailer from this Promo Capture artifact. Open with `campus-entry-walk`, use both landmark reveals, then `student-center-walk`, and end on `full-map-navigation`. Keep actual game footage dominant and add restrained motion typography.

## P0 shot types

- `walk`: capture-only setup places the player at a semantic location, then movement uses the real `PlayerController` through Playwright keyboard input.
- `orbit`: game geometry/rendering stays real; only the camera yaw is moved by the capture runner for a cinematic reveal.
- `ui`: operates the real Full Map UI and the existing navigation owner.

P0 intentionally excludes account-bound fishing/NPC reward flows from the default manifest. Those can be added later with an explicit synthetic/offline fixture contract instead of pretending a stubbed API is live gameplay.
