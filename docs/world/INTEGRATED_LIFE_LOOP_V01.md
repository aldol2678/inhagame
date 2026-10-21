# INHA WORLD · Integrated Life Loop v0.1 [CURRENT DESIGN]

> **Status:** product/design canon, implementation planned.  
> **Reviewed against:** public `main` `a70c26f900178145c14616210e9156ec5c8feb96` (2026-10-06).  
> **Implementation canon:** the repository's current `main`, migrations, tests and
> `docs/architecture/AUTHORITY_MAP.md`. If this design and implemented authority disagree,
> implementation remains authoritative until the corresponding reviewed PR changes it.

This document is the canonical cross-system design for the first closed INHA WORLD loop connecting
**Life → Housing → Combat → Housing → Life**. It combines the previously separate B1–B4 design
threads into one implementation target.

Nothing in this document by itself activates a feature, changes a database schema, grants an item,
or changes Production.

## 1. Product goal

The first complete loop is:

```text
Inkyung fishing
  → material.fish_carp
  → Personal Room cooking station
  → grilled carp meal
  → Building 5 authoritative combat
  → resonance fragment reward
  → Personal Room workbench
  → reinforced fishing line
  → next 3 Fishing starts gain a small timing bonus
  → back to Fishing
```

The goal is not to maximize feature count. The goal is to make one system's verified output become
another system's meaningful input, then return value to the original activity.

The loop must remain **optional synergy**, not mutual coercion:
- Fishing is not required to enter Combat.
- Combat is not required to continue ordinary Fishing.
- Housing remains useful for expression even when a furniture item has no gameplay capability.
- Loop rewards may improve convenience or preparation, but may not become mandatory admission keys.

## 2. Scope and non-goals

### In scope for v0.1

- Functional furniture capability layer.
- One cooking recipe: carp → grilled carp.
- One consumable meal preparing the next Building 5 combat.
- First server-authoritative Building 5 combat vertical slice and one fixed reward definition.
- One workbench recipe: resonance fragment → reinforced fishing line.
- One fishing preparation effect with 3 charges.
- Server-side idempotency, frozen effect snapshots and current domain authority boundaries.

### Explicitly deferred

- Cooking Life Skill activation or Cooking XP.
- Crafting Life Skill activation or Crafting XP.
- Generic “use any item” RPC.
- Generic client-supplied recipe/mutation plans.
- Recipe quality, critical success, failures or random output.
- Tool durability.
- Fishing rod / reel / line equipment slots.
- `baitcraft`, rare fish, boat fishing or deep-sea fishing activation.
- Open-world authoritative combat position.
- More Building 5 encounters, bosses or loot tables.
- Trading / market.
- Housing score or furniture-stat stacking.
- Aquarium implementation. It remains a follow-up capability consumer.

## 3. Shared design rules

1. **Clients present; servers decide.** The browser may show proximity prompts, predict combat
   presentation and open panels. It never decides grants, consumption, damage, victory, recipe
   outputs, Life XP, effect strength or remaining charges.
2. **Definition data is not placement data.** Furniture placement persists
   `{id,itemId,surface,x,z,yaw}` only. Capability is derived from the canonical furniture/item
   definition and is never accepted from a saved placement.
3. **Narrow commands, no generic mutation surface.** Cooking, item preparation and authoritative
   combat use domain-specific commands. No public generic Inventory mutation RPC is introduced.
4. **Retry-safe by identity.** Any value-moving command has a stable idempotency identity. A lost
   response may replay the prior receipt but may not move value twice.
5. **Freeze at use/start boundaries.** Skill, meal, preparation and reward context that affects an
   in-flight attempt is frozen when that attempt begins. Later balance/config changes affect the next
   attempt, not the current one.
6. **No silent authority shortcuts.** A domain never writes another domain's protected tables
   directly. New primitive callers or protected writers require the Authority Map and guard tests to
   change in the same implementation PR.

## 4. B1 · Functional Furniture Capability

### 4.1 Purpose

Promote selected placed furniture from decorative 3D objects into entry points for gameplay while
reusing the existing Personal Room placement/save system and shared `F` Context Action slot.

### 4.2 Target capability vocabulary

Initial capability identities:

- `COOKING_STATION`
- `WORKBENCH`
- `DISPLAY_AQUARIUM` (follow-up consumer)
- `WARDROBE` (follow-up consumer)
- `PET_HOME` (follow-up consumer)

Decorative furniture has no capability.

Capability definitions own:
- capability id;
- ACTIVE / COMING_SOON state;
- owner action presentation;
- optional visitor-view action;
- room-local interaction radius.

The placement JSON and H2 save RPC do **not** gain a `capability` field.

### 4.3 Interaction contract

A Personal Room-only provider resolves:
1. saved placed objects;
2. ACTIVE capabilities;
3. owner / visitor eligibility;
4. objects within the room-local interaction radius;
5. nearest eligible object, then placement UUID as deterministic tie-break.

It publishes one candidate into the existing shared Context Action controller.

Candidate priority target: **170**.

This intentionally stays:
- below NPC / seat / guestbook / other high-intent actions;
- above Personal Room door priority 150.

Furniture interaction is suppressed while:
- furniture editing is open;
- a room transition is busy;
- the saved layout is unavailable;
- the current space is not `ROOM_PERSONAL_BASIC`;
- `WORLD_ACTION` input is unavailable.

The trigger revalidates the live object and access state before opening a consumer.

### 4.4 B1 implementation state

**PLANNED.** No capability registry/provider is implemented by this design document.

## 5. B2 · Recipe transformation and first food

### 5.1 Shared Recipe target

Cooking and workbench crafting use one semantic recipe catalog rather than separate incompatible
recipe systems.

Target catalog identity: `private.world_recipe_catalog`.

Each recipe freezes semantic server-owned data:
- `recipe_id`;
- mutation type (`COOK`, `CRAFT`, later compatible types);
- required furniture capability;
- status / definition version;
- canonical Inventory mutation plan.

The client submits a recipe id and request id only. It never supplies consumes, outputs, quantities
or mutation types.

### 5.2 First recipe

`recipe.carp_grill`

- Required capability: `COOKING_STATION`
- Consume: `material.fish_carp ×1`
- Grant: `consumable.grilled_carp ×1`
- Mutation type: `COOK`
- Source: canonical recipe identity

The existing `private.world_inventory_mutate_v1` remains the atomic Inventory owner for decrement
and grant. Cooking domain validation happens before that primitive.

### 5.3 CONSUMABLE item category

The current inventory presentation already reserves a Consumable tab, while the current item
catalog does not yet admit `CONSUMABLE`.

The B2 implementation PR should add `CONSUMABLE` as a proper semantic Item Catalog category instead
of disguising food as MATERIAL.

First item:

- `consumable.grilled_carp`
- display: `인경호 붕어구이`
- STACKABLE
- initial max stack: **20 candidate**
- acquisition: recipe / crafting
- gameplay item, not cosmetic-only

The exact max stack is candidate balance, not immutable product canon.

### 5.4 Cooking station authority

The B2 server command must verify that the player's own saved Personal Room layout contains the
required cooking-station item. Proximity remains a client UX gate until a trusted interior-position
authority exists.

A friend's room or another account's furniture never grants crafting eligibility.

### 5.5 Cooking Life Skill

`life.cooking` remains **COMING_SOON** in this loop. B2 transforms Inventory only. Cooking XP,
Cooking SP and a Cooking tree require a separate activation slice.

## 6. B3 · Meal preparation and first authoritative combat

### 6.1 Meal effect

`consumable.grilled_carp` may prepare one upcoming Building 5 encounter.

Target effect:
- identity: `effect.combat.carp_meal_v1`
- scope: first Building 5 authoritative encounter only
- candidate effect: **+10% max HP**
- stacking: none
- consumed/bound when the eligible encounter starts
- cancellation or defeat after start does not refund the meal

A player may enter the encounter without a meal.

### 6.2 Persistent combat preparation

Using the food consumes exactly one item and creates server-owned pending preparation state in one
transaction. If preparation creation fails, Inventory consumption rolls back.

A second meal cannot overwrite an active v0.1 preparation.

The effect is frozen into the encounter context at Combat start. Balance changes after start do not
rewrite that encounter.

### 6.3 Building 5 authority boundary

The existing `building5-combat-training.js` remains local **no-reward training/presentation** and
must never become reward authority merely because the target reaches 0 HP in the browser.

The first rewarding Building 5 slice requires an ACTIVE Combat definition and a trusted deterministic
server resolver.

Target identity:

- Combat: `combat.building5.resonance_drone`
- source: Building 5 semantic training gate
- server decides HP, damage, BREAK, cooldowns, dodge timing, defeat and victory
- client may animate/predict and reconcile

The v0.1 server resolver may treat the encounter as an instanced training space and defer
authoritative free-movement position. Open-world Combat position authority remains a separate future
problem.

Client Combat commands may name only allowed semantic actions and idempotency keys. They may not
assert damage, HP, BREAK, victory, loot or reward values.

### 6.4 First Combat reward

Target RewardDefinition:

`reward.combat.building5_resonance_clear`

Candidate grants:
- `material.resonance_fragment ×1`
- Campus / World EXP **+30 candidate**

The Combat domain does not grant Inventory or EXP directly. A verified successful Combat result
routes through the Reward Orchestrator.

**Current architecture caveat:** current source vocabularies do not yet include `COMBAT` in the
Reward source set, and item grant source vocabularies likewise do not currently admit COMBAT.
The B3 implementation PR must make a reviewed forward vocabulary extension (and guard-test updates)
before this reward can be activated. Existing unrelated source types must not be repurposed as a
shortcut.

Reward context should be bound to the encounter at start or otherwise version-frozen so a reward
definition change cannot silently alter an encounter already in progress.

## 7. B4 · Workbench return loop and Fishing preparation

### 7.1 Workbench recipe

`recipe.reinforced_fishing_line`

- Required capability: `WORKBENCH`
- Consume: `material.resonance_fragment ×1`
- Grant: `consumable.reinforced_fishing_line ×1`
- Mutation type: `CRAFT`

The same Recipe + Inventory Mutation framework from B2 is reused.

### 7.2 Reinforced line effect

`consumable.reinforced_fishing_line`

Target preparation:
- effect: `fishing.effect.reinforced_line_v1`
- charges: **3 Fishing STARTs**
- candidate effect per charged start: **+250 ms HOOK response window**
- no stacking with another active reinforced-line preparation
- failed, cancelled and successful attempts all consume the charge because the line was used
- a start refused before a valid attempt is created consumes no charge

Charges are based on Fishing attempt starts, not successful catches.

### 7.3 Fishing integration

Current Fishing already resolves Life Skill effects at `world_fishing_start_v1` and freezes the
effective policy into the attempt.

The B4 target extends that pattern:

```text
base operator policy
  → Life Skill effects
  → server-owned Fishing preparation effect
  → validate effective policy
  → freeze policy/effect snapshots into attempt
```

Skill effects and preparation effects remain separate semantic snapshots.

Candidate v0.1 maximum:
- base response window: 1500 ms
- `steady_hands` rank 3: +750 ms
- reinforced line: +250 ms
- resulting maximum: **2500 ms**

The exact ceiling is candidate balance.

A preparation-use receipt is keyed by Fishing attempt id so an exact START replay never consumes a
second charge.

### 7.4 Fishing tree boundary

This loop does **not** activate:
- `baitcraft`;
- `rare_fish_sense`;
- `boat_fishing`;
- `deep_sea_fishing`.

Reinforced line preparation is not bait and is not evidence that those nodes have an implemented
consumer.

## 8. Cross-domain authority target

| Concern | Canonical owner / target |
| --- | --- |
| Fish catch | Fishing / Activity settlement |
| Personal Room placement | Housing |
| Furniture capability definition | Housing product registry; not placement JSON |
| Recipe semantics | Recipe/Crafting domain catalog, migration-owned |
| Item decrement / grant | Inventory primitives |
| Meal pending state | Combat preparation domain |
| Combat result | Trusted server Combat resolver |
| Combat reward | Reward Orchestrator after verified Combat success |
| Character EXP | Progression through Reward |
| Reinforced-line charges | Fishing preparation domain |
| Fishing effect application | Authoritative Fishing START |
| Life Skill XP | Existing Life authority only; not added by B2/B4 |

No client-supplied arbitrary plan or amount crosses these boundaries.

## 9. Candidate content values

These values are intentionally small and may be tuned by reviewed implementation/balance changes:

| Value | v0.1 candidate |
| --- | ---: |
| Carp → grilled carp | 1 → 1 |
| Grilled carp stack | 20 |
| Meal effect | +10% max HP, next eligible Combat |
| Building 5 reward | 1 resonance fragment + 30 EXP |
| Fragment → reinforced line | 1 → 1 |
| Reinforced line charges | 3 Fishing starts |
| Line timing effect | +250 ms response window |
| Effective response-window ceiling | 2500 ms |

The semantic loop and authority boundaries are canon. These numbers are candidate tuning.

## 10. PR implementation order

Keep implementation PRs narrow. Database changes remain forward-only.

1. **ILL-01 / B1 — Functional Furniture Foundation**
   - capability registry + Personal Room interaction provider;
   - no persistent schema change;
   - no value movement.
2. **ILL-02 / B2a — Recipe + Consumable Foundation**
   - shared recipe catalog;
   - CONSUMABLE catalog category;
   - grilled carp definition;
   - narrow cooking command using Inventory Mutation.
3. **ILL-03 / B2b — Cooking Station UI**
   - activate cooking-station consumer;
   - panel/client wiring;
   - refresh Inventory from server result.
4. **ILL-04 / B3 — Authoritative Building 5 Vertical Slice**
   - meal preparation;
   - first ACTIVE Combat definition / trusted resolver;
   - Combat action idempotency;
   - Reward vocabulary extension + fixed reward route.
5. **ILL-05 / B4a — Workbench Recipe**
   - resonance fragment → reinforced line;
   - activate WORKBENCH consumer.
6. **ILL-06 / B4b — Fishing Preparation**
   - persistent 3-charge line effect;
   - START-time claim/freeze;
   - replay and failure-path tests.
7. **ILL-07 — Integrated QA**
   - one-account full loop;
   - retry / rollback / account-switch cases;
   - Production-first browser QA only after the implementation slices are merged/deployed through
     the normal delivery process.

## 11. Integrated acceptance criteria

The loop is complete only when all of the following are true:

1. A verified Fishing success can produce `material.fish_carp`.
2. The owner can use an owned/saved cooking station to transform one carp into one grilled carp.
3. Recipe retry cannot consume or grant twice.
4. Using grilled carp consumes one item and persists one pending Combat preparation atomically.
5. The player can still start Building 5 Combat without food.
6. An eligible encounter claims the meal exactly once and freezes its effect.
7. Browser-local training state alone cannot produce a persistent reward.
8. The trusted Combat resolver is the only source of victory semantics.
9. Verified victory grants the fixed reward exactly once through Reward authority.
10. The owner can use a workbench to transform one resonance fragment into one reinforced line.
11. Using the reinforced line creates exactly three Fishing-start charges.
12. A valid Fishing START consumes one charge; a refused START consumes none.
13. Exact Fishing START replay consumes no additional charge.
14. Skill and preparation effects combine server-side and freeze into the attempt.
15. After the third charged START the preparation is exhausted.
16. No cross-domain protected table is written outside its owner primitive.
17. Guests, banned accounts, another user's room and forged client amounts fail closed.
18. The full loop remains optional: ordinary Fishing and ordinary Combat still function without the
    cross-system preparations.

## 12. Relationship to existing canon

This design extends, but does not replace, the following current contracts:

- `docs/architecture/AUTHORITY_MAP.md`
- `docs/world/LIFE_SKILL_P0.md`
- `docs/world/FISHING_SKILL_EFFECTS_P1.md`
- `docs/world/ACTIVITY_P0_AUTHORITY.md`
- `docs/world/INVENTORY_MUTATION_P0.md`
- `docs/world/HOUSING_H0_BASELINE_AUDIT.md`
- `docs/world/HOUSING_H2_FURNITURE_SAVE.md`
- `apps/world/src/combat/combat-contract.js`

Where those documents describe implemented authority, they remain authoritative until an
implementation PR changes them and their guard tests.
