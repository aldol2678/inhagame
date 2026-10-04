# INHA WORLD Authority Map

Canonical owner, read path and mutation path for every piece of persistent player / world state,
plus the CI guards that keep them from drifting.

- Basis: public `main` at `8b7bf39` (2026-10-04), read from the migrations and code, not from
  older design documents. Where this document and the code disagree, the code and the guard tests
  win; fix the document in the same PR.
- Enforced by:
  - `supabase/tests/database/93_authority_primitive_callers.test.sql`: primitive call graph,
    protected table writers, client reachability (sections 3 and 4).
  - `supabase/tests/database/94_authority_schema_validity.test.sql`: every plpgsql body compiles
    against the replayed schema; SECURITY DEFINER pins `search_path` (section 5).
  - `supabase/tests/database/01_grants_contract.test.sql`: role surfaces (section 6).
  - `.github/ci/migration-contract-lint.mjs`: migration contract collisions (section 5).
- Anything marked UNKNOWN could not be confirmed from this repository. Do not fill it in by guessing.

Maturity: **production** = reachable by players today · **foundation** = server authority exists,
nothing is ACTIVE / no settlement path · **planned** = no backing schema yet · **unknown**.

## 1. Principles

1. **One owner per state.** Each table below is written by exactly one domain's primitive. Other
   domains read it, or ask the owner through an allowlisted call. They never write the table.
2. **Derived values are not stored.** Character Level, Life Skill Level, Life Level, earned SP and
   (target) Combat TP are derived from ledgers and immutable curves. No second copy exists to drift.
3. **Content domains do not move progression directly.** Quest, Combat, Activity, Creature and NPC
   do not call the Wallet, EXP or Inventory primitives. Fixed rewards go through the Reward
   orchestrator. Outcome-dependent outputs will go through a settlement path that does not exist
   yet (section 7.4). Existing exceptions are listed explicitly in section 3 with a reason.
4. **Clients present; servers decide.** The browser may predict, animate and display. Grants,
   unlocks, completions and combat results are decided by server code (SECURITY DEFINER SQL or
   trusted server APIs using `service_role`).
5. **Generative AI has no authority.** NPC model output selects among deterministic candidates or
   produces wording. It never names a quest, reward, item or state change that a deterministic
   authority has not already validated.

## 2. State authority map

| State | Canonical owner | Backing tables / functions | Read path | Mutation path | Allowed callers | Client write | Maturity |
|---|---|---|---|---|---|---|---|
| Identity | Supabase Auth | `auth.users` | JWT; `public.is_permanent_account()` | Auth sign-up / sign-in; `delete_my_inhagame_account_v1(text)` (FK cascade removes owned rows) | Auth service; the account owner | sign-in / delete own account only | production |
| Profile | Profile (public) | `public.profiles` (nickname, department_id, title, avatar_key, is_banned) | `get_my_profile()`, `get_world_public_profile(uuid)` | RLS self insert/update on the column grants `nickname, department_id, title, avatar_key` | the profile owner; `is_banned` only via ops (`service_role`) | **yes**: listed columns only | production |
| Character EXP | Progression | `private.world_player_progression`, `private.world_exp_transactions` (append-only) | `get_my_world_progression_v1()` | `private.world_exp_apply_v1` | Reward orchestrator; `public.world_exp_grant_v1` (service_role) | no | production |
| Character Level | Progression (derived) | `private.world_level_thresholds` (immutable, append-only) × `total_exp` | `get_my_world_progression_v1()`; client never computes it (`progression-client.js`) | none, derived | — | no | production |
| Wallet | Economy | `private.world_wallets`, `private.world_currency_transactions`, `private.world_currencies` | `get_my_world_wallet_v1()` | `private.world_wallet_apply_v1` | Reward orchestrator; Shop purchase; `world_wallet_credit/debit_v1` (service_role) | no (purchase RPC prices from the server listing) | production |
| Inventory | Inventory | `private.world_player_items` (UNIQUE user,item), `world_item_grants`, `world_item_consumptions`, `world_inventory_mutations(_entries)`, `world_item_catalog` | `get_my_world_inventory_v1()` | `private.world_inventory_grant_v1` (only increase), `world_inventory_consume_v1`, `world_inventory_mutate_v1` (atomic N-consume / M-grant) | Reward; Shop; Inventory-internal mutate; service_role wrappers | no | production (cosmetics / collectibles); MATERIAL rows foundation |
| Cosmetic equipment | Appearance | `private.world_player_appearance_loadout` (9 slots), `world_appearance_transactions` | `get_my_world_appearance_loadout_v1()` | `equip_my_world_item_v1`, `unequip_my_world_item_v1` (ownership checked) | the owner (authenticated, self-only) | via self-only RPC | production |
| Combat equipment | Equipment (planned) | none. Combat v0.3 needs gear instances (8 slots, +20 enhancement, sets); `world_player_items` cannot hold instances | — | — | — | — | planned (static build catalog `src/combat/combat-v03-catalog.js`, #112; no schema) |
| Combat progression | Combat (planned) | none. **Target**: Combat TP derived from Character Level (section 7.2) | — | — | — | — | planned |
| Combat encounter | Combat | `private.world_combat_encounters`, `world_combat_definition_catalog` (empty) | `world_combat_snapshot_v1` (service_role) | `world_combat_start / state_write / finalize_v1`; `world_combat_*_with_creature_v1` bridges | trusted server resolver (service_role). **No resolver runtime exists yet** | no | foundation (no ACTIVE definitions) |
| Activity attempt | Activity | `private.world_activity_attempts` | none for players yet | `world_activity_start / finalize_v1`; `world_life_activity_*_with_creature_v1` | trusted server (service_role) | no | foundation (no ACTIVE activity) |
| Life progression | Life | per-skill XP: `private.world_player_life_skills`, `world_life_skill_xp_transactions`; skill curve `world_life_skill_thresholds` (Lv1 only); aggregate curve `world_life_progression_thresholds` (Lv1 only) | private snapshots only (`world_life_skill_snapshot_v1`, `world_life_progression_snapshot_v1`); **no public read RPC** | `private.world_life_skill_xp_apply_v1` | **none yet** (no settlement path) | no | foundation (all 11 skills COMING_SOON) |
| Life Skill Point | Life | `private.world_life_sp_transactions` (spend ledger), `world_player_life_nodes`, `world_life_skill_tree_catalog` / `_edges` (0 nodes). Earned SP = `cumulative_sp` of the **aggregate** Life Level today | private snapshot only | `private.world_life_node_unlock_v1` | **none yet** | no | foundation. **Target contract is per-skill pools** (section 7.1) |
| Creature ownership / growth | Creature Core | `private.world_player_creatures`, party state / history, observation events, activity events, XP transactions, memory tags, evolution candidates / events; catalogs | `world_creature_core_snapshot_v1` (service_role); `get_my_creature_core_v1()` / `get_my_duck_companion_v1()` (self) | `world_creature_grant / observe / party_set / activity_accept / evolution_*_v1` | service_role wrappers; Life → Creature and Combat → Creature bridges (same transaction as the source finalize); Duck Companion P1 (`world_inkyung_duck_observe_v1` via service_role / edge function `world-duck-observe`, `bond_my_duck_companion_v1` self-only); Creature Manager P1 `set_my_creature_party_v1` self-only | via self-only bond and revisioned party RPCs; server validates owned Creature ids | Duck Companion P1 + Creature Manager P1 live; other species, bridges (XP 0) and evolution foundation |
| Quest progression | Quest | `private.world_quest_progress_v1` (CHECK: 2 quest ids), `private.world_event_progress` (MCM 2026 only) | Cloud Run quest handler → `advance_*` with event `status`; `get_my_mcm_2026_event_v1()` | `advance_world_quest_v1`, `advance_world_navigation_quest_v1`, `advance_mcm_2026_event_v1` (service_role; one RPC per quest) | Cloud Run quest service (`npc-factory/quest-store.mjs`) | **indirect**: the browser asserts `visit_*` / `talk_*` events; the server enforces only the order | production (Main 1, Main 2, MCM 2026) |
| Reward | Reward | `private.world_reward_definitions` / `_grants` (catalog), `world_reward_transactions` / `_entries` | `world_reward_get_result_v1` (service_role); results embedded in quest / claim responses | `private.world_reward_grant_v1` (CURRENCY, ITEM, EXP only) | Main 1 / Main 2 completion, Daily Quiz pass, Attendance claim, MCM claims, service_role wrapper | no | production |
| Collection | Collection | `private.world_player_collection_discoveries`, `world_collection_discovery_events`, `world_collection_entry_catalog` | `world_collection_list_v1` (service_role) | `private.world_collection_discover_v1` | service_role wrapper | no | foundation (only `collection.place.biryong_tower`, derived from its owner) |
| Achievement | Achievement (Classic / Hub) | `public.user_achievements` (key CHECK list) | `get_my_achievements()` | SQL functions / triggers on verified Classic records and Inha mail verification | database-internal | no | production for Classic / verification; World achievements planned |
| GM / permission | Ops | `private.world_staff_assignments` (world_admin, sound_gm), `world_staff_role_permissions` | `get_my_world_admin_access_v1()`; display-only `get_world_staff_badges_v1(uuid[])` | ops via `service_role` table DML only (no RPC) | operators | no | production |
| Biryong NPC relationship | Biryong Relationship | `private.world_player_biryong_npc_relationships`, `world_biryong_npc_relationship_events`; NPC/fact catalogs | `get_my_biryong_npc_relationship_v1(text)`, `get_my_biryong_npc_relationships_v1()` (self-only read) | `private.world_biryong_relationship_advance_v1` via `public.world_biryong_npc_relationship_advance_v1` | trusted server (`service_role`), one verified stage at a time | no mutation from browser | P0 live in schema/runtime |
| NPC dialogue state | Client (no server authority) | `npc-factory/npc-dialogue-session.mjs` (state machine), `npc-dialogue-context.mjs` (context + candidates); AI: `/api/npc-dialogue-route` (Jev, `EXPERIMENT_ONLY`, `authorityEffect: NONE`), `/api/npc-ai` (pilot, quota `claim_world_npc_ai_call_v1`, actions forced to `stay`) | in browser | none persistent; NPC shared schedule ticks via `claim/commit_world_npc_shared_tick_v1` (service_role) | — | browser-only state | authored / observed dialogue production; Jev experiment |

Not in scope of this map: housing rooms and furniture, guestbook, social / friends, telemetry,
the Classic / Grow / Survival games. They have their own grant contracts in `01_grants_contract`.

## 3. Primitive call allowlist

Protected primitives, all in schema `private`:

| Owner | Primitives |
|---|---|
| Wallet | `world_wallet_apply_v1` |
| Character EXP | `world_exp_apply_v1` |
| Inventory | `world_inventory_grant_v1`, `world_inventory_consume_v1`, `world_inventory_mutate_v1` |
| Reward | `world_reward_grant_v1` |
| Life | `world_life_skill_xp_apply_v1`, `world_life_node_unlock_v1` |
| Collection | `world_collection_discover_v1` |
| Creature | `world_creature_grant_v1`, `_observe_v1`, `_party_set_v1`, `_activity_accept_v1`, `_evolution_candidate_v1`, `_evolution_context_gate_v1`, `_evolution_commit_v1` |
| Activity | `world_activity_start_v1`, `world_activity_finalize_v1` |
| Combat | `world_combat_start_v1`, `world_combat_state_write_v1`, `world_combat_finalize_v1` |
| Biryong Relationship | `world_biryong_relationship_advance_v1` |

Allowed callers on `8b7bf39`. The exact list with a reason per row is in test 93.

- **Wallet**: Reward orchestrator; `purchase_world_shop_listing_v1`; service_role `world_wallet_credit/debit_v1`.
- **EXP**: Reward orchestrator; service_role `world_exp_grant_v1`.
- **Inventory grant**: Reward; Inventory mutate; Shop purchase; service_role `world_inventory_grant_item_v1` and `world_inventory_ensure_default_items_v1`. **Consume**: Inventory mutate only.
- **Reward**: `advance_world_quest_v1`, `advance_world_navigation_quest_v1`, `answer_my_world_daily_quiz_v1`, `world_attendance_claim_v1`, `world_mcm_claim_reward_v1`, service_role wrapper.
- **Creature observe / grant / party set**: service_role wrappers, plus Duck Companion P1 and Creature Manager P1:
  `world_inkyung_duck_observe_v1` → observe; `world_duck_companion_bond_v1` → grant and, only
  when the party is empty, party set; `set_my_creature_party_v1` → party set with `auth.uid()`, owned ids and expected revision re-validated by the primitive.
- **Creature activity accept**: service_role wrapper, plus the Life → Creature and Combat → Creature
  P1 bridges. Each bridge accepts only the `result_ref` its own finalize just produced, in the same
  transaction.
- **Activity / Combat lifecycle**: service_role wrappers and the two Creature bridges.
- **Biryong Relationship**: only `public.world_biryong_npc_relationship_advance_v1` (service_role) may call the relationship advance primitive; browser RPCs are read-only.
- **No callers yet** (deliberately): `world_inventory_mutate_v1`, `world_life_skill_xp_apply_v1`,
  `world_life_node_unlock_v1`. They get callers only through the settlement path in section 7.4.

Client reachability: the only functions `anon` / `authenticated` can execute that reach any
primitive, at any depth, are `purchase_world_shop_listing_v1`, `answer_my_world_daily_quiz_v1`,
`claim_my_world_attendance_v1`, `claim_my_mcm_2026_main_reward_v1`,
`claim_my_mcm_landlord_first_clear_reward_v1`, `bond_my_duck_companion_v1` and
`set_my_creature_party_v1`. Each decides or validates its outcome on the server.

How the test reads the call graph:
- Only the final catalog after replaying every migration is inspected. A superseded version of a
  function never produces a finding.
- plpgsql bodies are read through `plpgsql_check`'s parsed dependency list.
- All bodies, including SQL-language functions, trigger functions and dynamic SQL strings, are
  also matched on `<primitive name>(` after comments are removed. A call hidden in `EXECUTE format(...)`
  is still found.

## 4. Protected tables

State tables are written only by their owning primitive (the exact writer list is in test 93). A
new function that runs `insert / update / delete / merge / truncate` on one of them fails CI, even
if it never calls the primitive.

- Wallet: `world_wallets`, `world_currency_transactions` ← `world_wallet_apply_v1`
- EXP: `world_player_progression`, `world_exp_transactions` ← `world_exp_apply_v1`
- Inventory: `world_player_items`, `world_item_grants`, `world_item_consumptions`,
  `world_inventory_mutations(_entries)` ← the three Inventory primitives
- Reward: `world_reward_transactions(_entries)` ← `world_reward_grant_v1`
- Life: `world_player_life_skills`, `world_life_skill_xp_transactions` ← `world_life_skill_xp_apply_v1`;
  `world_life_sp_transactions`, `world_player_life_nodes` ← `world_life_node_unlock_v1`
- Collection: `world_player_collection_discoveries`, `world_collection_discovery_events` ← `world_collection_discover_v1`
- Creature: creature, party, observation, activity event, XP, memory and evolution tables ← their Creature primitive;
  `world_player_creatures.bond_entitled` and `world_creature_acquisition_claims` ← `world_duck_companion_bond_v1`
- Activity / Combat: `world_activity_attempts`, `world_combat_encounters` ← their lifecycle primitives
- Biryong Relationship: `world_biryong_npc_relationship_events`, `world_player_biryong_npc_relationships` ← `world_biryong_relationship_advance_v1`; NPC/fact catalogs are migration-only
- Quest: `world_quest_progress_v1` ← the two `advance_world_*_quest_v1`;
  `world_event_progress` ← `advance_mcm_2026_event_v1`, `world_mcm_try_complete_v1`
- Appearance: `world_player_appearance_loadout` ← equip / unequip. Shop ledger: `world_purchase_transactions` ← purchase
- Staff: `world_staff_assignments`, `world_staff_role_permissions` ← no function (ops DML only)

Definition catalogs (currencies, items, level / life curves, reward definitions and grants, shops,
life / combat / creature / collection / Biryong relationship catalogs, bridge catalogs) are written only by migrations.
**No function may write them.**

## 5. Migration collision guard

The failure mode, reproduced from #91 / #98:
1. A superseded migration re-declares a canonical table with a different contract.
2. Its `create table if not exists` is skipped on replay.
3. Its `create or replace function` then installs a body written for columns that do not exist.

Postgres compiles plpgsql lazily, so the replay succeeds and the function breaks at runtime. The
existing `migration-lint.mjs` only checks names and ordering, so a date-only rebase passes it.

Two layers:

| Layer | Runs in | Catches |
|---|---|---|
| `.github/ci/migration-contract-lint.mjs` (static) | `scripts/public-ci.sh`, no Docker | `CONTRACT_COLLISION`: `create table if not exists` on an existing table with a different column contract. `DUPLICATE_CREATE`: plain `create table` on an existing table. `UNKNOWN_COLUMN`: top-level `insert into T (cols)` naming a column T does not have. Table contracts are replayed through ALTER ADD / DROP / RENAME / TYPE, `rename to` and `drop table`. |
| `94_authority_schema_validity` (replayed DB) | `scripts/public-db.sh` → `supabase test db` | Any plpgsql function in `public` / `private` that does not compile against the real schema (`plpgsql_check`). Covers function bodies, which the static layer does not parse. Includes a self-test that reproduces the #91 / #98 shape and asserts the check reports it. |

Not findings: ALTER TABLE, indexes, policies, grants, comments, a `create or replace function`
follow-up that compiles, dropping and re-creating a table on purpose, and an identical
re-declaration (type aliases normalized).

Fixtures: `.github/ci/fixtures/migration-contract/pr91-collision` must fail;
`.github/ci/fixtures/migration-contract/benign-evolution` must pass.

## 6. Role contract

| Role | Intended authority | Enforced by |
|---|---|---|
| `anon` | Public read aggregates, guest telemetry, presence touch. No World progression or state mutation. | `01_grants_contract` exact anon EXECUTE surface; no `private` usage; no `private` function |
| `authenticated` | Self-only RPCs where the caller is `auth.uid()` and the server decides the outcome (purchase, quiz, attendance, MCM claims, equip, social, housing). Never passes another user id. Never reaches a primitive except through the reviewed self-only RPCs in section 3. | exact authenticated EXECUTE surface; no `private` usage; no `private` function; transitive reach check in test 93 |
| `service_role` | Trusted server code (Cloud Run quest / NPC services, future resolvers) calling `public.*_v1(p_user, …)` wrappers. Most wrappers also re-check `auth.role() = 'service_role'` in the body; four rely on the GRANT alone (section 8). Cannot execute private primitives directly. | service-role-only lists in `01_grants_contract` (economy, quest, activity, collection, combat, creature, Biryong relationship, bridges, NPC ticks); private EXECUTE surface = the two staff helpers; private table DML surface recorded exactly |

## 7. Target contracts (decided, not yet implemented)

These rules bind the next PRs. This PR does not change schema or gameplay for them.

### 7.1 Life Skill Point: per-skill pools
- Target: each Life Skill has its own SP pool, for example Fishing SP, Gathering SP, Woodcutting
  (Logging) SP, Farming SP, Crafting SP and Sailing SP.
- SP is earned from that skill's own Life Skill Level and spent only in that skill's tree.
- SP earned in one skill **cannot** unlock nodes in another skill's tree.
- A separate shared / mastery progression may be added later. It must be its own pool and ledger,
  never mixed into the per-skill Life SP.
- Today (`33dc483`) there is a single aggregate pool: `cumulative_sp` from the aggregate Life Level
  curve, spent by `world_life_node_unlock_v1`.
- The migration toward per-skill pools happens in a follow-up Life PR, while the SP ledger and tree
  catalog are still empty:
  - add a pool dimension to the SP ledger and the tree catalog;
  - derive earned SP from the per-skill curve;
  - gate nodes on the owning skill's level.
- #91 content that can be imported then is listed in `PR91_LIFE_PROGRESSION_SALVAGE.md`.

### 7.2 Combat TP: derived from Character Level
- Combat Tree Points are earned from Character Level (`world_player_progression` + `world_level_thresholds`).
- They are derived, not stored. There is no separate Combat EXP.
- The exact award curve is decided in the Combat progression PR. Spending gets its own ledger, as
  Life SP does.
- Combat TP and Life SP are separate systems and never convert into each other.

### 7.3 Combat authority: server-side deterministic resolver
- The client may render, animate and predict combat.
- The canonical authority for damage, victory / defeat, reward eligibility, drops, EXP and quest
  combat completion is a server-side deterministic combat resolver. It drives
  `world_combat_start / state_write / finalize_v1`.
- "The client computes the whole fight and the server only validates the result afterwards" is
  **not** the target architecture.
- `combat-contract.js` already lists the fields a client may never assert (`damage`, `hp`,
  `resultRef`, `loot`, `playerExp`, …).

### 7.4 Settlement (direction only)
- Outcome-dependent outputs (Life XP, materials, drops, Creature growth, Combat gear) will be
  applied by one server-side settlement path. It will be atomic, keyed by the verified source
  `result_ref`, and its output plan will be computed by the server resolver.
- It will not be ad-hoc per activity.
- Until it exists, the "no callers yet" primitives in section 3 stay without callers. A PR that
  adds one must update test 93 with a reason, and reviewers should expect it to be the settlement
  path.

## 8. Recorded findings (not changed in this PR)

- **Quest events are client-asserted.** The server enforces only the order of `visit_*` / `talk_*`
  events. Each quest needs its own RPC and a CHECK change. Rewards are one-time, so the current
  impact is bounded.
- **`service_role` holds INSERT / UPDATE on `private.world_quest_progress_v1`.** Server code could
  set a stage without the quest RPC, and therefore without its reward. Not reachable by clients.
  Recorded in `01_grants_contract`.
- **`/api/npc-dialogue-route` (Jev) has no per-user or global quota.** The pilot route has one.
  #120 added live shadow instrumentation (latency, disagreement logging); still `authorityEffect: NONE`.
  Whether it is enabled in production is UNKNOWN.
- **`profiles.title` is free text editable by its owner.** The server GM badge is separate, so a
  title can imitate "GM".
- **Duck Companion P1 writes `world_player_creatures` outside a Creature primitive.** `world_duck_companion_bond_v1`
  sets `bond_entitled` on the creature it just granted, in the same transaction. It is the owning
  domain and the write is allowlisted with that reason. When more acquisition rules arrive, moving
  `bond_entitled` into `world_creature_grant_v1` (or a Creature acquisition primitive) keeps one writer.
- **`world_life_node_unlock_v1` takes an un-namespaced advisory lock** (`hashtextextended(p_user::text, 0)`).
  Every other domain uses `'world_<domain>:' || user`.
- **Four service-role wrappers rely on the GRANT alone, with no `auth.role()` check in the body**: `world_exp_grant_v1`, `world_progression_get_v1`, `claim_world_npc_shared_tick_v1`, `commit_world_npc_shared_tick_v1`. The GRANT is correct today and is asserted in `01_grants_contract`; the in-body check is the missing second layer.
- **Reward source types** do not include `ACTIVITY` or `COMBAT`, and item grant sources do not
  include `COMBAT`. Source vocabularies differ across ledgers.

## 9. Changing this contract

1. Adding a caller of a primitive, or a writer of a protected table: add the row to test 93 with
   the reason, and the line to sections 3 / 4. Reviewers check the reason against principles 1–3.
2. Adding a primitive or a protected table: add it to test 93's lists and to sections 3 / 4.
3. Adding a client-callable RPC that reaches a primitive: add it to the reach list in test 93, the
   authenticated surface in `01_grants_contract`, and section 3. It must decide its outcome on the server.
4. Re-declaring a table: use ALTER TABLE. If `migration-contract-lint` reports
   `CONTRACT_COLLISION`, the migration is out of date with the canonical schema.

## 10. UNKNOWN

- Production values of `NPC_AI_ENABLED`, `NPC_QUEST_ENABLED`, `NPC_JEV_ENABLED`.
- Whether the Production migration lineage (separate repository) matches public `main` object-for-object.
- Whether operator-issued grants are attributed to an operator outside this repository. The Wallet / EXP / Item / Reward ledgers have no actor column (only `source_type = 'ADMIN'` / `reason`).
