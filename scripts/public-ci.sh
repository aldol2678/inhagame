#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "INHA Native P0 one-shot benchmark only"
(cd apps/world/tests/recast-runtime && npm ci --ignore-scripts && node --test crowd-benchmark.test.mjs)
