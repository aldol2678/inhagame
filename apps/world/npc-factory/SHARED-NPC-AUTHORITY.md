# Shared NPC Authority · implementation contract mirror

> Status: DESIGN LOCKED · IMPLEMENTATION PENDING
>
> This file mirrors the current design decision. Product/design authority remains outside the repository:
> - Notion `INHA WORLD · Online Architecture v0.1 [CURRENT DESIGN]` owns Network / Presence / Zone / Tick / AOI / reconnect HOW.
> - Notion `INHA WORLD · Social S3 NPC Autonomous Intelligence v0.1 [CURRENT DESIGN]` owns NPC autonomous behavior / AI WHAT.
>
> The repository `main` remains implementation authority. This document does not claim that shared authoritative NPC runtime is already implemented.

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
