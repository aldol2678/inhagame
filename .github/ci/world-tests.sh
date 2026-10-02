#!/usr/bin/env bash
# Run every committed World Node test. `node --test <dir>` does not discover files on Node 22,
# and an unmatched glob would pass with zero tests, so the file list is explicit and must be non-empty.
set -euo pipefail
shopt -s nullglob
all_files=(apps/world/tests/*.test.mjs)
if [[ ${#all_files[@]} -eq 0 ]]; then
  echo "world-tests: no apps/world/tests/*.test.mjs found" >&2
  exit 1
fi

shard_total="${WORLD_TEST_SHARD_TOTAL:-1}"
shard_index="${WORLD_TEST_SHARD_INDEX:-0}"
if [[ ! "$shard_total" =~ ^[0-9]+$ || ! "$shard_index" =~ ^[0-9]+$ ]]; then
  echo "world-tests: shard values must be non-negative integers" >&2
  exit 1
fi
if (( shard_total < 1 || shard_index >= shard_total )); then
  echo "world-tests: invalid shard ${shard_index}/${shard_total}" >&2
  exit 1
fi

files=()
for i in "${!all_files[@]}"; do
  if (( i % shard_total == shard_index )); then
    files+=("${all_files[$i]}")
  fi
done
if [[ ${#files[@]} -eq 0 ]]; then
  echo "world-tests: shard ${shard_index}/${shard_total} selected no files" >&2
  exit 1
fi

printf 'world-tests: shard %d/%d — %d/%d files\n' "$((shard_index + 1))" "$shard_total" "${#files[@]}" "${#all_files[@]}"
printf 'world-tests: %s\n' "${files[@]}"
node --test "${files[@]}"
