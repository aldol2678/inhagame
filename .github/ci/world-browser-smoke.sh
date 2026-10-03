#!/usr/bin/env bash
# World browser smokes on GPU-less CI: disable WebGPU and prove the real Campus boot falls back to
# WebGL2, then run the Editor preview/overlay through the same legacy backend. Real WebGPU graphics
# settings remain covered by boot-smoke.mjs and graphics-smoke.mjs on a GPU-enabled browser.
set -euo pipefail
dir=apps/world/tests/browser
npm ci --prefix "$dir" --no-audit --no-fund
(cd "$dir" && npx --no-install playwright install --with-deps --only-shell chromium)
export WORLD_SMOKE_DISABLE_WEBGPU=1
node "$dir/boot-smoke.mjs"
node "$dir/mobile-boot-smoke.mjs"
node "$dir/environment-smoke.mjs"
node "$dir/main-gate-camera-smoke.mjs"
node "$dir/lobby-layout-smoke.mjs"
node "$dir/housing-smoke.mjs"
node "$dir/studio-shell-smoke.mjs"
node "$dir/editor-smoke.mjs"
node "$dir/music-editor-smoke.mjs"
node "$dir/music-place-preview-smoke.mjs"
node "$dir/music-editor-acceptance.mjs"

