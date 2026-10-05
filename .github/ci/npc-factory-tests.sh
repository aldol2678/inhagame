#!/usr/bin/env bash
# Run every committed NPC factory check. They are plain Node scripts (node:assert, no runner), so
# each one runs on its own and the first failure fails the job. `tests*.mjs` picks up new test
# files automatically; `runtime-spike.mjs` is the assert-based data rehearsal from the README.
# Generators (generate.mjs, make-fixtures.mjs, quality.mjs, …) write files and are never run here.
set -euo pipefail
shopt -s nullglob
dir=apps/world/npc-factory
files=("$dir"/tests*.mjs "$dir"/runtime-spike.mjs)
if [[ ${#files[@]} -lt 2 ]]; then
  echo "npc-factory-tests: no $dir/tests*.mjs found" >&2
  exit 1
fi
for file in "${files[@]}"; do
  echo "npc-factory-tests: $file"
  node "$file"
done
echo "npc-factory-tests: ${#files[@]} script(s) passed"
