# Recast shadow integration

This gate uses real `recast-navigation@0.43.1` WASM, the checked-in campus population
fixtures, and the same evaluator as `/recast-npc-poc.html`. It performs no database,
runtime navigator, deployment or account mutation. Node 24 is used by public CI.

```sh
cd apps/world/tests/recast-runtime
npm ci --ignore-scripts
npm test
npm run evaluate
```

`scripts/public-ci.sh` runs this after the world unit tests. Package and transitive
dependencies are pinned in the lockfile. The acceptance test fails below 190 of
200 current schedule legs and requires zero unsafe returned routes and exact
endpoint arrivals. The evaluator renders `PASS` only at 200/200, `PARTIAL_PASS`
at >=95%, and `FAIL` for incomplete population/expansion, empty schedules or
missing endpoint data. No legacy fallback counts toward Recast coverage.

The current 200 legs contain 141 movements and 59 same-position arrivals; both
counts and movement-only coverage/distance are reported. Thirty remote-adjacent
legs are excluded. The scope is the 46 purposeful campus NPC schedules, excluding
the two protected campus NPCs, Biryong Village NPCs, wander and social detours.

The standalone page still imports the pinned package from esm.sh; npm/WASM
integration does not independently prove CDN/browser loading or production
performance. This is a shadow PoC. Its result never authorizes runtime cutover.
