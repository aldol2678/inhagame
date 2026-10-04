#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Vercel sets NODE_ENV=production; the pinned build-only Recast package is a devDependency.
npm ci --prefix tests/recast-runtime --include=dev --ignore-scripts --no-audit --no-fund
npm run build:artifact --prefix tests/recast-runtime
