#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix apps/world/tests/recast-runtime --ignore-scripts
npm ci --prefix apps/world/tests/browser --no-audit --no-fund
(cd apps/world/tests/browser && npx --no-install playwright install --with-deps --only-shell chromium)
node apps/world/tests/browser/recast-crowd-worker-benchmark.mjs
