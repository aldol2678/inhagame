# Shared NPC Authority · implementation contract mirror

> Status: DESIGN LOCKED · P0 AUTHORITY + CLIENT CONSUMER MERGED · PRODUCTION ACTIVATION OFF
>
> This file mirrors the current design decision. Product/design authority remains outside the repository:
> - Notion `INHA WORLD · Online Architecture v0.1 [CURRENT DESIGN]` owns Network / Presence / Zone / Tick / AOI / reconnect HOW.
> - Notion `INHA WORLD · Social S3 NPC Autonomous Intelligence v0.1 [CURRENT DESIGN]` owns NPC autonomous behavior / AI WHAT.
>
> The repository `main` remains implementation authority. Shared NPC Authority P0 and pilot renderer consumer wiring are merged. Production activation and live two-device authority validation are not claimed.

## P0 implementation status

- Public PR `#229` merged as `77458ee906b39c3e6d7fe130be8c73ce4983479f`.
- Pilot NPCs: `INKYUNG-NPC-003` and `INKYUNG-NPC-012`.
- Server authority samples the existing deterministic schedule / shared-meeting runtime on a canonical 250 ms tick.
- The read-only endpoint is `/api/npc-shared-state?placeZoneId=<AREA_ID>` and remains disabled unless `NPC_SHARED_AUTHORITY_P0=1`.
- The replica contract rejects stale/duplicate revisions and supports reconnect reset + fresh snapshot application.
- Interest output contains only `ACTIVE` NPCs for the requested Place Zone while the server evaluates `ACTIVE / COARSE / SLEEP`.
- Player-specific dialogue, memory, reward and quest state are excluded from the shared snapshot.
- Verification: `public-ci.sh` PASS, `public-db.sh` PASS, and Biryong/Campus Chromium QA PASS on PR #229.
- No Production environment flag was changed, so this merge does not activate the endpoint in Production.
- Public PR `#232` merged as `bf964ff07fa1ee6d929d9a4b7cdd1b6c1e55437e`.
- The Campus client probes the authority endpoint independently, consumes only the current Place Zone snapshot, and gives pilot NPCs 003/012 server snapshot state final renderer ownership.
- While authority is enabled but a current-zone snapshot has not arrived, pilot NPCs fail closed instead of advancing local canonical state. A 404 disables the consumer and restores the existing local deterministic path.
- Local canary mode requires `npcTest=a-r1&npcAuthority=p0&npcSync=ng2`, preventing mixed local/server time axes.
- PR #232 verification: Public local checks PASS, World stability PASS, Quest journal PASS, World asset optimizer PASS, Student center integrated Campus PASS, Room transition recovery PASS, Biryong map/NPC guidance PASS.

Live two-device authority consumption and Production activation remain follow-up work.

## Legacy v1 reconciliation

The September 26 database prototype `world_npc_shared_state_v1` is **HISTORICAL DORMANT /
SUPERSEDED FOR RUNTIME AUTHORITY**.

- Production still contains `private.world_npc_shared_ticks_v1` and the service-role-only
  `get/claim/commit_world_npc_shared_*_v1` RPCs.
- Production readback on 2026-10-06 found 0 rows in the shared tick table.
- The old contract uses a 60-second tick and legacy ambient actions
  (`stay / walk_nearby / look_around / return_anchor`) for NPC 003–020.
- The current P0 uses the 250 ms revisioned snapshot, Place Zone interest management,
  ACTIVE/COARSE/SLEEP, and renderer ownership described above.
- Runtime code must not call the legacy RPCs. CI guard:
  `npc-shared-authority-legacy-boundary.test.mjs`.
- Do not drop or revoke the Production DB objects in ordinary feature work. Schema retirement is a
  separate explicitly approved Production cleanup.
- If shared AI actions return later, use Action Registry → Validator → Executor → Shared NPC
  Authority. Do not revive the v1 decision vocabulary as canonical state.

Full evidence and retirement criteria:
`docs/architecture/SHARED_NPC_AUTHORITY_RECONCILIATION_2026-10-06.md`.

## Locked model

INHA WORLD shared online NPCs use:

`One Shared NPC Authority + Server Simulation LOD + Interest Management + Personal Narrative Layer`

### Shared authoritative state

A shared NPC has one canonical world state, never one canonical copy per viewer. At minimum the authoritative owner must cover:

- stable NPC identity
- monotonic `revision` or `seq`
- canonical world time / schedule period
- Place Zone and movement / route progress
- current shared activity
- shared meeting / group / event participation
- quest-critical availability
- NPC-to-NPC shared social facts
- combat / health / death when those systems apply

Player-specific dialogue or memory must not fork any of those facts.

## Server simulation LOD

The authoritative simulation may reduce compute when nobody is observing an NPC. The cost level is server-scoped, not viewer-scoped.

| Level | Use | Required behavior |
| --- | --- | --- |
| `ACTIVE` | observer nearby, combat, quest-critical action, detailed shared event | run the needed movement/action/collision simulation |
| `COARSE` | no nearby observer but schedule/travel/shared-event continuity matters | advance from canonical time, route and transitions without frame-by-frame walking |
| `SLEEP` | no observer and no immediate shared gameplay obligation | retain authoritative snapshot + next transition; materialize deterministically on wake |

Quest- or event-critical NPCs may force a minimum `ACTIVE` or `COARSE` level regardless of observers.

## Interest management

- One shared authority does not mean every client receives every NPC.
- Reuse the existing `world:campus:<AREA_ID>` Place Zone boundary first.
- Publish snapshots/events only to relevant Place Zones or a later measured AOI.
- Do not default to campus-wide NPC realtime fan-out.
- Add finer AOI partitioning only after real density/traffic measurements justify it.

## Ordering and transitions

- Shared updates carry a monotonic revision/sequence plus canonical time/period.
- Clients reject stale and duplicate updates.
- Schedule period and shared-event transitions come from server/canonical world time, not browser render frames or local clocks.
- A given authoritative revision represents the same shared fact to every viewer.

## Late join and reconnect

- A joining observer receives the current authoritative NPC snapshot and revision before applying later incremental events.
- Reconnect reconciles against a fresh snapshot so duplicate NPCs and stale state do not survive.
- When stream and snapshot disagree, the newer authoritative revision wins.
- If authority is temporarily unavailable, clients may retain the last safe snapshot for presentation only. They must not invent authoritative movement, rewards, quest completion or shared-social mutations.

## Personal narrative boundary

Player-specific state may differ without duplicating the shared NPC body:

- dialogue session branch / response
- player-to-NPC familiarity and memory
- last topic
- personal quest progress and personal reward result
- UI and viewer-local observed-scene suppression
- purely cosmetic blink/idle timing, cloth/hair physics, distant animation/shadow/nameplate LOD

Talking to an NPC does not server-lock that NPC for everyone by default. Viewer-local suppression remains presentation only, consistent with `SHARED-MEETINGS.md`.

## AI admission

- Jev/Gemini/other providers are proposal or language layers, never the shared NPC authority.
- An AI-proposed shared action must pass the registered Action/Intent contract, Rule/Validator and authoritative executor.
- Client-local AI cannot write shared location, schedule, group, relationship, quest or economy state.
- Shared generated dialogue, if introduced, must first become a server-owned versioned artifact such as `event_id + revision + generated payload/cache`.

## Existing compatible precedent

`SHARED-MEETINGS.md` already derives the same scene from `/api/world-time`, lets late observers see the current line, and treats direct-talk suppression as viewer-local rather than a server NPC lock. Keep that behavior compatible with this contract.

## Minimum implementation acceptance

Do not mark this architecture implemented until tests/evidence cover at least:

1. two clients observing the same NPC state
2. late join snapshot correctness
3. reconnect without duplicate/stale NPCs
4. canonical period transition
5. `ACTIVE ↔ COARSE ↔ SLEEP` transitions
6. stale/duplicate update rejection
7. player-specific dialogue/memory not forking shared world facts
8. AI/provider failure not freezing or authoring shared state
