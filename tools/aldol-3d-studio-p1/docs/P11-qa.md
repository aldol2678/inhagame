# ALDOL 3D Studio P1.1 · Renderer and mobile QA

**Development branch only:** `feat/aldol-3d-studio-p1-1-render-touch-20261020`.

## Changes
- Correct `.mjs` MIME response from local HTTP server; ES modules now receive `text/javascript`.
- Explicit renderer status (`webgl`, `canvas`, `unavailable`) in the viewport.
- On WebGL initialization/draw/context-loss errors, render to a **separate 2D canvas** rather than showing an empty scene. A GPU canvas that has already acquired a WebGL context cannot be reused as Canvas 2D.
- Track pointer gestures and suppress placement/picking after multi-touch pinch; single touch placement remains supported.
- Add an HTTP MIME regression and a real-served Chromium QA runner.

## Locally confirmed (2026-10-20)
- `npm run check`: PASS.
- `npm test`: **31 PASS / 0 FAIL**.
- Browser UI with actual local HTTP API proxied into Chromium (the hosted URL is blocked by the execution environment): object placement changed >9,000 pixels on Canvas fallback, desktop controls and mobile 390×844 touch placement PASS. Double-finger pinch did not create an unintended object.
- Chromium in the constrained environment **did not initialize WebGL**, so local pixel proof is for the Canvas fallback only, **not for WebGL or PlayCanvas**.

## GitHub CI: two independent gates
`.github/workflows/aldol-3d-studio-p1-1.yml`
1. Tracked source syntax, 31 local backend/command tests, real INHA WORLD editor class integration (8 PASS / 2 SKIP expected).
2. Pinned Playwright Chromium launches the **actual** `http://127.0.0.1:<port>/` served page on the GitHub runner. Test checks import MIME, renderer status, actual before/after screenshot pixel count (>2500 changed pixels), touch pinch vs tap, responsive overflow, and JavaScript errors.

GitHub CI screenshots (if run) are uploaded as short-lived artifacts for 7 days.

## Remaining gates
- **C13 PlayCanvas production runtime** is not covered by this standalone custom-WebGL viewer.
- **C14 physical mobile/browser end-to-end on the deployed site** remains unverified; GitHub Chromium is desktop and mobile emulation only.
- This branch does not implement GLB import, an Asset Factory API, remote public MCP auth, or deployment.
- No main merge, production change or public release is authorized. License remains `UNLICENSED`.
