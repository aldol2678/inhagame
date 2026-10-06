# Shared NPC Authority Reconciliation Audit · 2026-10-06

Status: **DECISION RECORDED · NO PRODUCTION DB MUTATION**

This audit reconciles the September 26 shared-NPC database prototype with the October 6
Shared NPC Authority P0 implementation. It does not drop, revoke, migrate, or activate Production
database objects.

## Decision

The canonical runtime authority is the October 6 model:

`One Shared NPC Authority + Server Simulation LOD + Interest Management + Personal Narrative Layer`

implemented by PR #229 and client/renderer wiring PR #232.

The older `world_npc_shared_state_v1` database contract is **HISTORICAL DORMANT / SUPERSEDED
FOR RUNTIME AUTHORITY**. It remains present in the schema for compatibility and auditability, but
must not be used as a second canonical NPC-world authority.

If AI-generated shared actions are reintroduced later, build a new Action Registry-aligned
admission/journal contract. Do not revive the v1 action vocabulary as canonical state.

## Evidence

### September 26 database prototype

Production migration history contains:

- `20260926085930 · world_npc_shared_state_v1`

The public baseline also contains the corresponding objects:

- `private.world_npc_shared_ticks_v1`
- `public.get_world_npc_shared_state_v1()`
- `public.claim_world_npc_shared_tick_v1(text,bigint)`
- `public.commit_world_npc_shared_tick_v1(text,bigint,bigint,jsonb)`

Live Production readback on 2026-10-06 showed:

- `anon`: no EXECUTE on all three RPCs
- `authenticated`: no EXECUTE on all three RPCs
- `service_role`: EXECUTE allowed
- shared tick row count: **0**
- latest committed tick: **none**

The old contract uses:

- fixed 60-second ticks
- periods: morning / class_time / lunch / evening
- NPC scope: 003–020
- stored decision actions: `stay`, `walk_nearby`, `look_around`, `return_anchor`
- atomic advisory-lock claim, then commit of a JSON decision object
- retention of the latest 1,440 ticks

This is a decision ledger shape. It does not store the current canonical position/heading/Place
Zone snapshot now consumed by the Campus renderer.

### October 6 canonical runtime

PR #229 added:

- server-generated canonical snapshot
- 250 ms monotonic revision tick
- current schedule / movement / shared meeting projection
- `ACTIVE / COARSE / SLEEP` server simulation LOD
- Place Zone interest filtering
- late-join/reconnect snapshot contract
- stale/duplicate revision rejection

PR #232 added:

- feature probe and client authority consumer
- current Place Zone snapshot consumption
- final renderer ownership for pilot NPCs 003/012
- fail-closed hiding before a current-zone snapshot exists
- 404 fallback to the existing deterministic local path
- explicit shared-clock coupling for local authority canary

Production activation remains OFF unless `NPC_SHARED_AUTHORITY_P0=1` is configured.

## Why the two contracts must not both be authorities

| Dimension | September v1 DB prototype | October P0 canonical runtime |
| --- | --- | --- |
| Role | shared AI/action decision ledger | canonical runtime snapshot/projection |
| Tick | 60 s | 250 ms |
| NPC scope | 003–020 | P0 pilot 003/012 |
| State | action + confidence | position, heading, activity, schedule, meeting, zone |
| Time bands | 4, no night | current 5-period world schedule |
| Action vocabulary | legacy ambient verbs | current Purposeful runtime / Action Registry direction |
| Interest management | none | Place Zone / future AOI |
| LOD | none | ACTIVE / COARSE / SLEEP |
| Client contract | latest shared decision read | revisioned snapshot + stale rejection |
| Current runtime callers | none found | `/api/npc-shared-state` consumer |

Treating both as canonical would create two independent revision clocks, two action vocabularies,
and ambiguous ownership of NPC movement.

## Canonical ownership after reconciliation

1. **World body / position / schedule / shared meeting state:** October Shared NPC Authority.
2. **Player-specific dialogue / memory / quest narrative:** Personal Narrative layer.
3. **AI/Jev/LLM:** proposal/provider only.
4. **Future shared AI action admission:** Action Registry → Validator → Executor → Shared NPC Authority.
5. **September DB v1:** historical dormant compatibility object, not a runtime authority.

## Retirement plan

No Production change is made by this audit.

A later explicit Production schema-cleanup change may remove or revoke the September v1 objects
only after all of the following are true:

1. repository/runtime guard confirms no caller;
2. Production logs/usage confirm no external trusted caller;
3. replacement, if any, is Action Registry-aligned;
4. database forward migration and rollback plan are reviewed;
5. user explicitly approves the Production schema/permission change.

Until then, the objects may remain present but dormant.

## Guard

`npc-shared-authority-legacy-boundary.test.mjs` prevents runtime JavaScript/MJS under
`apps/world` from reintroducing the legacy claim/commit/get RPC names. Database baseline,
database tests, migration history, and architecture documentation are intentionally excluded from
that runtime guard.
