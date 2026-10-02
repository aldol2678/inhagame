#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
(cd apps/classic && npm test && npm run check)
(cd apps/induck-grow && npm test)
(cd apps/survival && npm test && npm run check)
(cd apps/induckup && npm ci --ignore-scripts && npm test && npm run build)
node --test supabase/tests/edge/*.test.mjs
