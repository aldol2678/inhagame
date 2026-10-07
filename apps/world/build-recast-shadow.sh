#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Vercel sets NODE_ENV=production; the pinned build-only Recast package is a devDependency.
npm ci --prefix tests/recast-runtime --include=dev --ignore-scripts --no-audit --no-fund
npm run build:artifact --prefix tests/recast-runtime

# Source-controlled Annyongi owns both static paths; fail the build on optimizer fallback.
npm ci --prefix ../../tools/world-assets --ignore-scripts --no-audit --no-fund
node ../../tools/world-assets/optimize-world-assets.mjs --strict
node assets/check_characters.mjs
