# PR #91 Life Progression salvage list

PR #91 (`feat/world-life-progression-tree-p0`, head `a849bd4`) is **superseded by #98**
(`20261004083000_world_life_progression_p0.sql`, merged). It declares the same objects
(`private.world_life_progression_thresholds`, `private.world_life_skill_tree_catalog`,
`private.world_life_progression_snapshot_v1`, `private.world_life_skill_tree_snapshot_v1`,
the threshold trigger functions) with an incompatible contract. Applied on top of current `main`,
its first migration fails at `column "min_total_xp" of relation
"world_life_progression_thresholds" does not exist`. Its code must not be merged.

This file keeps the **data-only content** of #91 that does not exist in `main`, so a later Life
progression PR can import it into the canonical schema. It is not an implementation and is not
canonical balance: values are the #91 proposal, recorded as-is.

Source files on the #91 branch:
- `supabase/migrations/20261003170000_world_life_progression_skill_tree_p0.sql` (Sailing skill, tree catalog)
- `supabase/migrations/20261003202000_world_life_progression_curve_v1.sql` (curve)
- `supabase/migrations/20261003213000_world_life_skill_tree_nodes_v1.sql` (nodes, prerequisites)
- `apps/world/src/life-skills/life-skill-registry.js` (Sailing display copy)
- `apps/world/src/life-skills/life-skill-tree-registry.js` (code mirror of the nodes)

## 1. Progression curve v1 (Lv1–20)

**Imported.** This curve is now the canonical per-skill curve `life.common.v1`
(`20261004130000_world_life_skill_curve_v1_sp_pools`), with `cumulative_sp` per skill pool. The
table below stays as the record of the #91 proposal.

`min_total_xp(level) = 50 * level * (level - 1)`. SP award +1 per level-up and +2 at every 5th
level, so 23 SP by Lv20. Lv20 was the highest defined level, not a cap. In #91 this curve was for an
**aggregate** Life XP.

| Lv | min total XP | SP award | cumulative SP |
|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 |
| 2 | 100 | 1 | 1 |
| 3 | 300 | 1 | 2 |
| 4 | 600 | 1 | 3 |
| 5 | 1,000 | 2 | 5 |
| 6 | 1,500 | 1 | 6 |
| 7 | 2,100 | 1 | 7 |
| 8 | 2,800 | 1 | 8 |
| 9 | 3,600 | 1 | 9 |
| 10 | 4,500 | 2 | 11 |
| 11 | 5,500 | 1 | 12 |
| 12 | 6,600 | 1 | 13 |
| 13 | 7,800 | 1 | 14 |
| 14 | 9,100 | 1 | 15 |
| 15 | 10,500 | 2 | 17 |
| 16 | 12,000 | 1 | 18 |
| 17 | 13,600 | 1 | 19 |
| 18 | 15,300 | 1 | 20 |
| 19 | 17,100 | 1 | 21 |
| 20 | 19,000 | 2 | 23 |

## 2. Sailing skill

- `life.sailing`, curve `life.common.v1`, status `COMING_SOON`
- Display: `항해`, "선박 운용과 수상·원양 이동의 검증된 결과로 성장하는 탐험 숙련도."
- Category `EXPLORATION`, tags `life, sailing`, availability `availability.life.sailing`
- #91 note to keep: Sailing does not own submarine or vehicle technology. `deep_sea_navigation`
  is only a Life-skill prerequisite surface for later technology systems.

## 3. Tree catalog (13 trees, all COMING_SOON, definition_version 1)

`life_tree.general` (no skill), plus one tree per skill: `archaeology`, `cooking`, `crafting`,
`farming`, `fishing`, `gathering`, `mining`, `photography`, `research`, `sailing`, `woodcutting`,
`woodworking`.

## 4. Nodes (24, all COMING_SOON, definition_version 1)

Columns: max rank, SP cost per rank, required (aggregate) Life Level, effect key. No node had a
skill-level gate, because `life.common.v1` defines only Lv1. Each tree costs 17 SP to max out.

| Node | Max rank | Cost / rank | Req. Life Lv | Effect key |
|---|---:|---:|---:|---|
| `life_node.fishing.steady_hands` | 3 | 1 | 2 | `fishing.bite_window.v1` |
| `life_node.fishing.fish_sense` | 3 | 1 | 3 | `fishing.fish_sense.v1` |
| `life_node.fishing.baitcraft` | 2 | 1 | 5 | `fishing.baitcraft.v1` |
| `life_node.fishing.rare_fish_sense` | 2 | 2 | 8 | `fishing.rare_fish_sense.v1` |
| `life_node.fishing.boat_fishing` | 1 | 2 | 10 | `fishing.boat_fishing.v1` |
| `life_node.fishing.deep_sea_fishing` | 1 | 3 | 15 | `fishing.deep_sea_fishing.v1` |
| `life_node.woodcutting.clean_cut` | 3 | 1 | 2 | `woodcutting.clean_cut.v1` |
| `life_node.woodcutting.timber_eye` | 3 | 1 | 4 | `woodcutting.timber_eye.v1` |
| `life_node.woodcutting.tool_care` | 2 | 1 | 5 | `woodcutting.tool_care.v1` |
| `life_node.woodcutting.hardwood_handling` | 2 | 2 | 8 | `woodcutting.hardwood_handling.v1` |
| `life_node.woodcutting.field_sawmill` | 1 | 2 | 10 | `woodcutting.field_sawmill.v1` |
| `life_node.woodcutting.master_forester` | 1 | 3 | 15 | `woodcutting.master_forester.v1` |
| `life_node.farming.soil_reading` | 3 | 1 | 2 | `farming.soil_reading.v1` |
| `life_node.farming.seed_selection` | 3 | 1 | 4 | `farming.seed_selection.v1` |
| `life_node.farming.water_sense` | 2 | 1 | 5 | `farming.water_sense.v1` |
| `life_node.farming.greenhouse` | 2 | 2 | 8 | `farming.greenhouse.v1` |
| `life_node.farming.crop_rotation` | 1 | 2 | 10 | `farming.crop_rotation.v1` |
| `life_node.farming.smart_farm` | 1 | 3 | 15 | `farming.smart_farm.v1` |
| `life_node.sailing.seamanship` | 3 | 1 | 2 | `sailing.seamanship.v1` |
| `life_node.sailing.coastal_navigation` | 3 | 1 | 4 | `sailing.coastal_navigation.v1` |
| `life_node.sailing.weather_reading` | 2 | 1 | 5 | `sailing.weather_reading.v1` |
| `life_node.sailing.offshore_navigation` | 2 | 2 | 8 | `sailing.offshore_navigation.v1` |
| `life_node.sailing.cargo_handling` | 1 | 2 | 10 | `sailing.cargo_handling.v1` |
| `life_node.sailing.deep_sea_navigation` | 1 | 3 | 15 | `sailing.deep_sea_navigation.v1` |

## 5. Prerequisite edges (25; `node ← prerequisite @ required rank`)

- Fishing:
  - `fish_sense ← steady_hands @1`
  - `baitcraft ← steady_hands @1`
  - `rare_fish_sense ← fish_sense @2`
  - `boat_fishing ← fish_sense @2`
  - `deep_sea_fishing ← rare_fish_sense @1`
  - `deep_sea_fishing ← boat_fishing @1`
- Woodcutting:
  - `timber_eye ← clean_cut @1`
  - `tool_care ← clean_cut @1`
  - `hardwood_handling ← timber_eye @2`
  - `field_sawmill ← tool_care @2`
  - `master_forester ← hardwood_handling @1`
  - `master_forester ← field_sawmill @1`
- Farming:
  - `seed_selection ← soil_reading @1`
  - `water_sense ← soil_reading @1`
  - `greenhouse ← seed_selection @2`
  - `crop_rotation ← water_sense @2`
  - `smart_farm ← greenhouse @1`
  - `smart_farm ← crop_rotation @1`
- Sailing:
  - `coastal_navigation ← seamanship @1`
  - `weather_reading ← seamanship @1`
  - `offshore_navigation ← coastal_navigation @2`
  - `offshore_navigation ← weather_reading @1`
  - `cargo_handling ← seamanship @2`
  - `deep_sea_navigation ← offshore_navigation @1`
  - `deep_sea_navigation ← cargo_handling @1`

## 6. Conversion notes for the import PR

The canonical target is `AUTHORITY_MAP.md` section 7.1: per-skill SP pools, with no SP crossing
between trees.

1. **IDs.** `main` requires `^life\.node\.<skill>\.<node>$`. Map `life_node.fishing.steady_hands`
   to `life.node.fishing.steady_hands`.
2. **Ranks.** #91 nodes have ranks (max 1–3, cost per rank). **Decided: rank dimension**
   (`20261004135000_world_life_skill_tree_ranks`). Import `maxRank` → `max_rank`, `pointCost` →
   `sp_cost` (per rank), and each prerequisite `requiredRank` → edge `required_rank`, unchanged.
3. **Gates.** #91 gates on aggregate Life Level. Under per-skill pools the gate is the owning
   skill's level (`required_skill_level`), which needs the per-skill curve
   (`life.common.v1` Lv2+) first. The #91 curve in section 1 is the candidate for that per-skill curve.
4. **SP budget.** Per skill, 23 SP by skill Lv20 against a 17 SP tree means one tree fully maxed
   per skill plus 6 spare. Spare SP stays in that skill's pool.
5. **`life_tree.general`** (no skill) conflicts with "no SP crossing". Keep it only as the
   candidate for a future separate shared / mastery progression with its own pool.
6. **Product requirements worth keeping**, not code:
   - an exact-refund tree reset that still works after a tree is disabled;
   - zero-delta empty resets;
   - immutable published node costs and edges.
7. **Not salvaged**:
   - #91 tables (`world_player_life_progression`, `world_life_xp_transactions`,
     `world_life_skill_point_transactions`, `world_life_skill_nodes`,
     `world_life_skill_node_prerequisites`, `world_player_life_skill_nodes`,
     `world_life_skill_tree_transactions`);
   - its rank-up / reset RPCs;
   - its aggregate Life XP ledger;
   - `life-progression-client.js` / `life-skill-panel.js` (bound to #91 RPCs);
   - the `read_fishing_active` migration, which activated Fishing.
