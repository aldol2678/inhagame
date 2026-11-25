#!/bin/bash
# usage: run-matrix.sh <port> <outdir>
cd "$(dirname "$0")"
for p in ${PROFILES:-pc android ipad}; do
  echo "=== $p"; timeout 900 node journey.cjs $p $1 $2 > $2-$p.log 2>&1; grep -E '^(PASS|FAIL)' $2-$p.log | cut -c1-160
done
