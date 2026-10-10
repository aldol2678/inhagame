# INHA WORLD · Student Center Shop World Entry P0

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

| Item | Status |
| --- | --- |
| Student Center Shop UI (P0-F3b) | **IMPLEMENTED** (`docs/world/SHOP_P0F3B_STUDENT_CENTER_UI.md`) |
| Wallet balance read | **IMPLEMENTED** (`docs/world/SHOP_WALLET_BALANCE_UI.md`) |
| Student Center world entry | **IMPLEMENTED** (this document) |
| ☰ menu entry (`🛍 상점`) | kept, secondary entry |
| Shop NPC | FOLLOW-UP |
| Dorm Furniture Shop (`shop.dorm_furniture`) | FOLLOW-UP |
| Department MCM Shop (`shop.department_mcm`) | FOLLOW-UP |
| Inventory read-only UI P0 | **IMPLEMENTED** (`docs/world/INVENTORY_UI_P0.md`) |
| Reward EXP detail toast | FOLLOW-UP |

`shop.student_center` can now be opened in the World in front of 학생회관, not only from the ☰ menu.
There is no shop NPC, vendor model or interior room: the entry is a spot in front of the terrace plus
the shared Context Action. Both entries open the **same** `shopPanel` on the same `shop` / `wallet`
clients, so they behave identically. No DB migration, no new RPC, no Shop / Wallet / Reward change.

## Anchor

`apps/world/src/student-center-front.js` → `studentCenterFrontPoint()`: `student_terrace_2` of
`STUDENT_TERRACES` (runtime terrace geometry on the campus facility footprint, the steps players walk
on), `terrace.frame.at(0.5, terrace.landing + 3)`, the foot of the terrace steps. The NPC destination
`poi.student-center` (`학생회관 앞`, `npc-factory/purposeful-student-destinations.mjs`) now uses the same
helper, so the NPC point and the shop entry are one anchor. No new coordinates, no GIS evidence
geometry as authority. The point lies in Place Zone `AREA_INKYUNG_STUDENT_CENTER`.

## Interaction

`apps/world/src/shop/shop-world-interaction.js` (no DOM, no RPC, no key handling):

- `STUDENT_CENTER_SHOP_ENTRY`: anchor, `shopId`, `placeZoneId`, `interactionRadius = metersToWorld(3.5)`
  (1.75 world units ≈ 3.5 m: the terrace foot and its first steps, not the pond promenade).
- `observe(position, { blocked, placeZoneId })` → action or `null`; `open()`; `nearby`, `distance`, `status()`.
- Blocked (no action): outside the radius, inside a room, mounted, shop panel already open, lobby shell or
  lobby transition, or any Place Zone other than `AREA_INKYUNG_STUDENT_CENTER`. While any overlay is open
  the whole slot is suspended by the existing `worldActionsSuspended()`.

| Account | Action |
| --- | --- |
| Member (bound account, member client) | `🛍 학생회관 상점`, F, runs `shopPanel.setOpen(true)` |
| Guest / signed out | `🔒 로그인 후 상점`, disabled, opens nothing |

Proximity never reads the shop or the wallet. Opening the panel runs the existing flow (shop and wallet
re-read on open, modal input lock, world actions suspended); the world entry adds no input lock of its own.

**PC / mobile.** The action is a candidate in the shared interaction slot (`contextActions`, id
`student-center-shop`). PC `F` → `interactionAction()` → `contextActions.trigger()`; mobile taps the same
`#context-action` button. Touch shows no keyboard hint.

### Priority

`STUDENT_CENTER_SHOP_CONTEXT_PRIORITY = 190` (higher wins):

| Action | Priority |
| --- | --- |
| MCM event / minigame | 305–310 |
| NPC talk | 300 |
| Stand up / sit | 280 / 260 |
| Guestbook | 255 |
| Biryong NPC / shout | 250 / 245 |
| Mechanical duck | 240 |
| Follow stop | 200 |
| **Student Center shop entry** | **190** |
| Room doors | 150 |
| Event info | 140 |

The entry never hides a conversation, event, seat, the guestbook or an explicit Follow stop. At the tree
benches next to the terrace the seat prompt wins; one step back towards the terrace shows the shop.

## Marker

`apps/world/src/shop/shop-world-label.js` + `#shop-world-label` (reuses the guestbook marker styles):
a floating `🛍 학생회관 상점` label above the entry, `F · 상점 열기` when near on keyboard devices,
`버튼으로 상점 열기` on touch, `로그인 후 이용` for guests. Discovery only; hidden inside rooms, in the lobby,
while the shop is open and outside the Place Zone. The marker point is a transform-only entity (no mesh).

## Verification

- `apps/world/tests/shop-world-interaction.test.mjs`: anchor = terrace geometry = `poi.student-center`,
  Place Zone, no magic coordinates or GIS authority, 3.5 m radius, far / near, member trigger, F and the
  mobile button share one trigger, guest locked, zero Shop / Wallet RPCs from proximity, blocked states,
  wrong Place Zone, priority table, one panel for both entries, marker copy and projection.
- `apps/world/qa.mjs`: slot wiring, same panel, one marker, menu entry kept.
- Browser QA (local, real `/campus/` boot on WebGPU with a fake member session) at 1280×720 and 360×740:
  17 m away no action; at the anchor (0 m) `🛍 학생회관 상점`; F opens; the `#context-action` button opens;
  close restores World control; purchase, Level lock and wallet balance in the opened panel; ☰ menu still
  opens; bench next to the anchor keeps `seat`; mounted hides the action; guest locked, F does nothing,
  zero Shop / Wallet RPCs; action label and panel fit at 360px. P0-F3a, P0-F3b and wallet QA re-run.

## Not in scope

Shop NPC or any 3D vendor / stall, other shops, a Student Center interior room, Inventory UI, shop quests,
catalog changes, DB / RPC / Shop / Wallet / Reward authority changes. The ☰ menu entry stays.
