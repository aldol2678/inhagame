#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# A disposable local stack is the sole accepted database target.
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
supabase start
trap 'supabase stop --no-backup' EXIT
supabase test db
node scripts/local-integration.mjs
generated=$(mktemp)
trap 'rm -f "$generated"; supabase stop --no-backup' EXIT
supabase gen types typescript --local --schema public,private,analytics > "$generated"
node .github/ci/check-types-coverage.mjs supabase/database.types.ts "$generated"
