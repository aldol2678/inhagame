# Inkyung Pond Ducks P0

> **Ported from the private development repository** (`apps/world/docs`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Implemented scope: lightweight ambient fauna for the campus World. These entities are **not** Purposeful NPCs and do not change the human NPC roster.

## Runtime

- Four ordinary ducks are always present on the canonical `lmk_inkyung_pond` polygon: three white ducks and one mallard-coloured duck.
- Their spawn positions and swim targets are derived from the existing canonical pond polygon. Movement is rejected when a sampled segment would leave the water.
- Low-cost local states are `idle`, `swim`, `groom`, and `flap`. Nearby players cause a small water-bound avoidance move. There is no feeding, combat, economy, collision authority, or network synchronization.
- A mechanical duck is a rare per-session Easter egg (8%). PR/local previews can force it with `?mechanicalDuck=1`; production query strings cannot force it.
- When the player is within 2.4 WU, the shared F interaction slot offers **수상한 오리 관찰**. Discovery emits `inkyungDuckLoreFound` and a local World status message. P0 deliberately grants no currency, item, badge, quest progress, or persistent collection record.

## Lore provenance

The campus legend predates the implementation. An official Inha University engineering feature about an aerospace graduate student says the team proposed making a mechanical duck because Inha already had a "mechanical duck legend", and that the built duck later floated on Inkyung Pond before breaking down:

- https://newdept.inha.ac.kr/bbs/engineering/2461/180012/artclView.do

The university newspaper also documents the real ducks of Inkyung Pond as a familiar campus presence and discusses how they overwinter:

- https://www.inhapress.com/news/articleView.html?idxno=8469

P0 treats the legend as playful campus folklore. It does not claim that ordinary pond ducks are machines or invent an origin date for the rumor.

## Verification

`apps/world/tests/ambient-ducks.test.mjs` covers roster composition, polygon-derived spawn safety, long-running water-bound motion, and the rare/forced mechanical spawn contract. The existing World CI automatically runs every `apps/world/tests/*.test.mjs`.


## Side event · 인경호의 진실

`event.inkyung_mechanical_duck` reuses the existing Ga-yudam NPC and duck runtime.

Flow:

1. The first campus tour must already be complete.
2. Talk to Ga-yudam and ask about the Inkyung duck rumor.
3. Observe one ordinary duck.
4. The side event guarantees that a mechanical duck exists in the pond for the search phase.
5. Observe the mechanical duck.
6. Return to Ga-yudam and report the sighting.
7. Complete the event and retain `lore.inkyung_mechanical_duck`.

The ordinary 8% per-session Easter-egg spawn remains unchanged outside the side event. If a player discovers the Easter egg first, that pre-discovery is remembered and the later side event skips directly to the report phase.

P0 side-event progress is device-local, namespaced by the current World account id when signed in. Guest pre-discovery may migrate into the first signed-in scope on that device. There is intentionally no coin, EXP, item, badge, or Reward Orchestrator call. A future account-backed collection service can replace this storage without changing the event state machine.

For deterministic preview QA, `?inkyungDuckEvent=1` unlocks the side event on localhost/Vercel previews only. `?mechanicalDuck=1` continues to force the mechanical duck itself on preview hosts.
