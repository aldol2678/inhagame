# INHA WORLD Authority Map

Canonical owner, read path and mutation path for every piece of persistent player / world state,
plus the CI guards that keep them from drifting.

- Basis: public `main` at `b40ee769` (2026-10-05) plus this Gathering P0 candidate, read from the migrations and code, not from
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
   orchestrator. Outcome-dependent outputs go through the Activity settlement path
   (`world_activity_settle_v1`, section 7.4). Existing exceptions are listed explicitly in section 3 with a reason.
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
| Activity attempt | Activity | `private.world_activity_attempts` | none for players yet | `world_activity_start / finalize_v1`; `world_life_activity_*_with_creature_v1` | trusted server (service_role); Fishing F2 through the Life -> Creature bridge | no (the browser calls `/api/world-fishing`; the server supplies the actor) | Fishing ACTIVE (`20261004161000`, candidate policy; HTTP behind `WORLD_FISHING_API_ENABLED`) |
| Activity settlement | Activity | `private.world_activity_settlements` (append-only receipt per attempt / `result_ref`) | embedded in domain reads / server replies | `private.world_activity_settle_v1` (plan → Inventory grant, Collection discover, Life Skill XP, receipt; one transaction) | reviewed server-only domain adapters deriving the plan from frozen authority: `world_fishing_settle_v1`, `world_gathering_harvest_v1` | no | foundation (section 7.4) |
| Fishing position evidence | trusted world server → Fishing | `private.world_fishing_positions`; canonical geometry `world_fishing_spots` | internal gate only | `world_fishing_observe_position_v1` | trusted authoritative server only (service_role + service claim + account guard); no player HTTP operation | no; browser pose/Realtime/heartbeat is not evidence | F3 consumer implemented; authoritative producer unconnected, exposure HOLD |
| Fishing occupancy | Fishing / Activity | `private.world_fishing_spot_leases` (one account per semantic bank, attempt TTL + trusted session) | internal start/HOOK gate | `world_fishing_start_v1` acquires/reclaims; `private.world_fishing_commit_v1` releases its own lease | existing server Fishing lifecycle only, under account and spot locks | no | F3 consumer implemented; Production SQL not applied by deploy |
| Gathering harvest | Gathering / Activity | `private.world_gathering_runtime`, `world_gathering_source_catalog`, `world_gathering_attempt_snapshots`; shared Activity attempt/settlement ledgers | server-only reply from `world_gathering_harvest_v1`; no player read/HTTP surface | `world_gathering_harvest_v1` freezes semantic source/output then uses Life→Creature Activity start/finalize + shared settlement | trusted server (`service_role`) only | no | P0 foundation; runtime/source/Life/Collection CLOSED, trusted position exposure deferred |
| Life progression | Life | per-skill XP: `private.world_player_life_skills`, `world_life_skill_xp_transactions`; skill curve `world_life_skill_thresholds` (`life.common.v1` Lv1–20, with cumulative per-skill SP); aggregate display curve `world_life_progression_thresholds` (Lv1 only, never an SP source) | private snapshots; players read their ACTIVE skills through the self-only `get_my_world_life_skills_v1()` (Life Skill Book) | `private.world_life_skill_xp_apply_v1` | Activity settlement path only | no | Fishing ACTIVE; the other 10 skills COMING_SOON |
| Life Skill Point | Life | **Per-skill pools**: `private.world_life_sp_transactions` (spend ledger keyed by `skill_id` = pool; composite FK to the node's own skill), `world_player_life_nodes`, `world_life_skill_tree_catalog` / `_edges` (tree v1: 18 multi-rank nodes for Fishing / Woodcutting / Farming; Fishing `steady_hands` + `fish_sense` ACTIVE, remaining 16 COMING_SOON). Earned SP = `cumulative_sp` of the skill's own curve at its derived Skill Level | private snapshots; players read their ACTIVE trees through the self-only `get_my_world_life_skill_tree_v1(skill)` | `private.world_life_node_unlock_v1` (spends only the node's skill pool, gates on that skill's level); `private.world_life_tree_reset_v1` (free reset) | self-only `unlock_my_world_life_node_v1`, `reset_my_world_life_tree_v1`; Fishing start consumes current ranks server-side | via self-only RPCs (server decides); effect values never come from browser | P1: first two Fishing timing effects implemented (section 7.1) |
| Creature ownership / growth | Creature Core | `private.world_player_creatures`, party state / history, observation events, activity events, XP transactions, memory tags, evolution candidates / events; catalogs | `world_creature_core_snapshot_v1` (service_role); `get_my_duck_companion_v1()` (self) | `world_creature_grant / observe / party_set / activity_accept / evolution_*_v1` | service_role wrappers; Life → Creature and Combat → Creature bridges (same transaction as the source finalize); Duck Companion P1 (`world_inkyung_duck_observe_v1` via service_role / edge function `world-duck-observe`, `bond_my_duck_companion_v1` self-only) | via self-only `bond_my_duck_companion_v1` (server re-counts observations) | Duck Companion P1 live in schema (duck species + `duck.base` ACTIVE); other species, bridges (XP 0) and evolution foundation |
| Quest progression | Quest | `private.world_quest_progress_v1` (CHECK: 3 quest ids), `private.world_event_progress` (MCM 2026 only) | Cloud Run quest handler → `advance_*` with event `status`; `get_my_mcm_2026_event_v1()` | `advance_world_quest_v1`, `advance_world_navigation_quest_v1`, `advance_world_first_style_quest_v1`, `advance_mcm_2026_event_v1` (service_role; one RPC per quest) | Cloud Run quest service (`npc-factory/quest-store.mjs`) | **indirect**: the browser asserts `visit_*` / `talk_*` events; the server enforces only the order | production (Main 1, Main 2, MCM 2026) |
| Reward | Reward | `private.world_reward_definitions` / `_grants` (catalog), `world_reward_transactions` / `_entries` | `world_reward_get_result_v1` (service_role); results embedded in quest / claim responses | `private.world_reward_grant_v1` (CURRENCY, ITEM, EXP only) | Main 1 / Main 2 completion, Daily Quiz pass, Attendance claim, MCM claims, service_role wrapper | no | production |
| Collection | Collection | `private.world_player_collection_discoveries`, `world_collection_discovery_events`, `world_collection_entry_catalog` | `world_collection_list_v1` (service_role) | `private.world_collection_discover_v1` | service_role wrapper | no | foundation (only `collection.place.biryong_tower`, derived from its owner) |
| Achievement | Achievement (Classic / Hub) | `public.user_achievements` (key CHECK list) | `get_my_achievements()` | SQL functions / triggers on verified Classic records and Inha mail verification | database-internal | no | production for Classic / verification; World achievements planned |
| GM / permission | Ops | `private.world_staff_assignments` (world_admin, sound_gm), `world_staff_role_permissions` | `get_my_world_admin_access_v1()`; display-only `get_world_staff_badges_v1(uuid[])` | ops via `service_role` table DML only (no RPC) | operators | no | production |
| Biryong NPC relationship | Biryong Relationship | `private.world_player_biryong_npc_relationships`, `world_biryong_npc_relationship_events`; NPC/fact catalogs | `get_my_biryong_npc_relationship_v1(text)`, `get_my_biryong_npc_relationships_v1()` (self-only read) | `private.world_biryong_relationship_advance_v1` via `public.world_biryong_npc_relationship_advance_v1` | trusted server (`service_role`), one verified stage at a time | no mutation from browser | P0 live in schema/runtime |
| Campus player↔NPC relationship | Campus NPC Relationship | `private.world_player_campus_npc_relationships`, `private.world_campus_npc_relationship_events`, HERO NPC catalog | `get_my_world_campus_npc_relationship_v1(text)`, `get_my_world_campus_npc_relationships_v1()` (self-only read) | `private.world_campus_npc_relationship_apply_v1` via `public.world_campus_npc_relationship_apply_v1` | trusted Cloud Run relationship adapter verifies the permanent account and maps dialogue `OPEN` / `TOPIC` into server-computed affinity events; browser supplies no delta or signal | no mutation from browser | P1 dialogue source adapter behind `NPC_RELATIONSHIP_ENABLED`; other gameplay sources deferred |
| NPC shared runtime state | Shared NPC Authority | `npc-shared-authority-p0.mjs`, `npc-shared-authority-server.mjs`, `/api/npc-shared-state`, client consumer | current Place Zone snapshot over read-only HTTP; no DB persistence in P0 | server deterministic schedule / meeting projection; client consumes revisioned snapshot | `NPC_SHARED_AUTHORITY_P0` gate | pilot 003/012 renderer authority | P0 merged; Production activation OFF |
| NPC dialogue state | Personal Narrative / Client | `npc-dialogue-session.mjs` (state machine), `npc-dialogue-context.mjs` (context + candidates); AI: `/api/npc-dialogue-route` (Jev, `EXPERIMENT_ONLY`, `authorityEffect: NONE`), `/api/npc-ai` (pilot) | player-local/browser session | none persistent | — | browser-only state | authored / observed dialogue production; Jev experiment |
| Legacy NPC shared tick v1 | Historical dormant | `private.world_npc_shared_ticks_v1`, `get/claim/commit_world_npc_shared_*_v1` from public baseline | latest committed decision JSON | service_role-only claim/commit | no current World runtime caller | none | **SUPERSEDED FOR RUNTIME AUTHORITY**; retained pending explicit Production cleanup |

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
| Life | `world_life_skill_xp_apply_v1`, `world_life_node_unlock_v1`, `world_life_tree_reset_v1` |
| Collection | `world_collection_discover_v1` |
| Creature | `world_creature_grant_v1`, `_observe_v1`, `_party_set_v1`, `_activity_accept_v1`, `_evolution_candidate_v1`, `_evolution_context_gate_v1`, `_evolution_commit_v1` |
| Activity | `world_activity_start_v1`, `world_activity_finalize_v1`, `world_activity_settle_v1` |
| Combat | `world_combat_start_v1`, `world_combat_state_write_v1`, `world_combat_finalize_v1` |
| Biryong Relationship | `world_biryong_relationship_advance_v1` |
| Campus NPC Relationship | `world_campus_npc_relationship_apply_v1` |

Allowed callers on `8b7bf39`. The exact list with a reason per row is in test 93.

- **Wallet**: Reward orchestrator; `purchase_world_shop_listing_v1`; service_role `world_wallet_credit/debit_v1`.
- **EXP**: Reward orchestrator; service_role `world_exp_grant_v1`.
- **Inventory grant**: Reward; Inventory mutate; Shop purchase; Activity settlement; service_role `world_inventory_grant_item_v1` and `world_inventory_ensure_default_items_v1`. **Consume**: Inventory mutate only.
- **Collection discover**: service_role wrapper; Activity settlement.
- **Life Skill XP**: Activity settlement only.
- **Activity settlement**: `public.world_fishing_settle_v1` (service_role + service claim; frozen catch) and `public.world_gathering_harvest_v1` (service_role; frozen semantic source/output).
- **Reward**: `advance_world_quest_v1`, `advance_world_navigation_quest_v1`, `answer_my_world_daily_quiz_v1`, `world_attendance_claim_v1`, `world_mcm_claim_reward_v1`, service_role wrapper.
- **Creature observe / grant / party set**: service_role wrappers, plus Duck Companion P1:
  `world_inkyung_duck_observe_v1` → observe; `world_duck_companion_bond_v1` → grant and, only
  when the party is empty, party set.
- **Creature activity accept**: service_role wrapper, plus the Life → Creature and Combat → Creature
  P1 bridges. Each bridge accepts only the `result_ref` its own finalize just produced, in the same
  transaction.
- **Activity / Combat lifecycle**: service_role wrappers and the two Creature bridges.
- **Biryong Relationship**: only `public.world_biryong_npc_relationship_advance_v1` (service_role) may call the relationship advance primitive; browser RPCs are read-only.
- **Campus NPC Relationship**: only `public.world_campus_npc_relationship_apply_v1` (service_role) may call the affinity primitive. The browser only reads its own projection; gameplay-source callers are intentionally absent in P0.
- **Life Skill Tree**: `world_life_node_unlock_v1` ← `public.unlock_my_world_life_node_v1`;
  `world_life_tree_reset_v1` ← `public.reset_my_world_life_tree_v1` (Life Skill Book, self-only, caller =
  `auth.uid()`, only a node / skill id and a request id; ACTIVE skills / nodes only).
- **No callers yet** (deliberately): `world_inventory_mutate_v1`.

Client reachability: the only functions `anon` / `authenticated` can execute that reach any
primitive, at any depth, are `purchase_world_shop_listing_v1`, `answer_my_world_daily_quiz_v1`,
`claim_my_world_attendance_v1`, `claim_my_mcm_2026_main_reward_v1`,
`claim_my_mcm_landlord_first_clear_reward_v1`, `bond_my_duck_companion_v1`,
`unlock_my_world_life_node_v1` and `reset_my_world_life_tree_v1`. Each decides its outcome on the server.

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
  `world_life_sp_transactions`, `world_player_life_nodes` ← `world_life_node_unlock_v1`;
  `world_life_tree_resets` ← `world_life_tree_reset_v1` (`world_life_tree_reset_policy` is a catalog)
- Collection: `world_player_collection_discoveries`, `world_collection_discovery_events` ← `world_collection_discover_v1`
- Creature: creature, party, observation, activity event, XP, memory and evolution tables ← their Creature primitive;
  `world_player_creatures.bond_entitled` and `world_creature_acquisition_claims` ← `world_duck_companion_bond_v1`
- Activity / Combat: `world_activity_attempts`, `world_combat_encounters` ← their lifecycle primitives;
  `world_activity_settlements` ← `world_activity_settle_v1`
- Fishing F3: `world_fishing_positions` ← trusted server `world_fishing_observe_position_v1` only;
  `world_fishing_spot_leases` ← `world_fishing_start_v1` acquires/reclaims and
  `world_fishing_commit_v1` releases; `world_fishing_spots` is a migration-only geometry catalog.
- Biryong Relationship: `world_biryong_npc_relationship_events`, `world_player_biryong_npc_relationships` ← `world_biryong_relationship_advance_v1`; NPC/fact catalogs are migration-only
- Campus NPC Relationship: `world_campus_npc_relationship_events`, `world_player_campus_npc_relationships` ← `world_campus_npc_relationship_apply_v1`; HERO catalog is migration-only; tier is derived, never stored
- Quest: `world_quest_progress_v1` ← the three `advance_world_*_quest_v1` (Main 1, Main 2, Main 3 M3.1 first style; M3.1 grants no reward);
  `world_event_progress` ← `advance_mcm_2026_event_v1`, `world_mcm_try_complete_v1`
- Appearance: `world_player_appearance_loadout` ← equip / unequip. Shop ledger: `world_purchase_transactions` ← purchase
- Staff: `world_staff_assignments`, `world_staff_role_permissions` ← no function (ops DML only)

Definition catalogs (currencies, items, level / life curves, reward definitions and grants, shops,
life / combat / creature / collection / Gathering source / Biryong relationship catalogs, bridge catalogs) are written only by migrations.
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
| `authenticated` | Self-only RPCs where the caller is `auth.uid()` and the server decides the outcome (purchase, quiz, attendance, MCM claims, equip, social, housing, Life Skill Book). Never passes another user id. Never reaches a primitive except through the eight RPCs in section 3. | exact authenticated EXECUTE surface; no `private` usage; no `private` function; transitive reach check in test 93 |
| `service_role` | Trusted server code (Cloud Run quest / NPC services, future resolvers) calling `public.*_v1(p_user, …)` wrappers. Most wrappers also re-check `auth.role() = 'service_role'` in the body; four rely on the GRANT alone (section 8). Cannot execute private primitives directly. | service-role-only lists in `01_grants_contract` (economy, quest, activity, collection, combat, creature, Biryong relationship, bridges, NPC ticks); private EXECUTE surface = the two staff helpers; private table DML surface recorded exactly |

## 7. Target contracts and implemented boundaries

These rules are the current architectural contract. Each subsection states what is implemented and what remains deferred.

### 7.1 Life Skill Point: per-skill pools (implemented)
- Implemented by `20261004130000_world_life_skill_curve_v1_sp_pools`: `life.common.v1` Lv2–20 with
  cumulative SP, `skill_id` pool column on the SP ledger, `world_life_skill_sp_snapshot_v1`, and a
  pool-scoped `world_life_node_unlock_v1`. The aggregate Life Level curve rejects any row with
  `cumulative_sp <> 0`. Guard test: `98_world_life_skill_sp_pools`.
- Each Life Skill has its own SP pool, for example Fishing SP, Gathering SP, Woodcutting
  (Logging) SP, Farming SP, Crafting SP and Sailing SP.
- SP is earned from that skill's own Life Skill Level and spent only in that skill's tree.
- SP earned in one skill **cannot** unlock nodes in another skill's tree.
- A separate shared / mastery progression may be added later. It must be its own pool and ledger,
  never mixed into the per-skill Life SP.
- **Life Level is display / aggregate only.** It is derived from summed per-skill XP on
  `life.progression.v1` (Lv1 only today). It is never an SP source (its `cumulative_sp` must stay 0)
  and never a second copy of any skill's level.
- **SP is a per-skill pool.** Earned SP is derived (never stored) from the owning skill's curve:
  `cumulative_sp` at its Skill Level. Spent SP is the sum of that skill's rows in the SP ledger.
- **Tree gates use the owning skill's level** (`required_skill_level`). `required_life_level` stays
  as an optional aggregate gate; nodes use 1 until the aggregate display curve gets more levels.
- **Nodes are multi-rank** (`20261004135000_world_life_skill_tree_ranks`):
  - A node has `max_rank`; `sp_cost` is per rank; `required_skill_level` gates every rank.
  - An edge requires a minimum prerequisite rank (`required_rank`) and must stay inside one skill.
  - Each acquired rank is one append-only row in `world_player_life_nodes` and one SP spend row.
    The current rank is the highest acquired rank. `world_life_node_unlock_v1` acquires exactly the
    next rank; no caller names a rank.
  - Published nodes and edges are immutable (only a node's `status` may change), enforced by
    triggers. Guard test: `98_world_life_skill_tree_ranks`.
- **Tree v1 nodes** (`20261004136000_world_life_skill_tree_nodes_v1`, code mirror
  `life-skill-tree-nodes-v1.js`): 18 nodes from #91 for Fishing, Woodcutting and Farming. Fishing
  `steady_hands` and `fish_sense` are ACTIVE through
  `20261005185000_world_fishing_skill_effects_p1`; the remaining 16 nodes stay `COMING_SOON`.
  Each tree costs 17 SP to max, which its skill has earned exactly at skill Lv15 (the last gate).
  Active Fishing timing effects are consumed only by the authoritative Fishing start resolver;
  deferred `effectRefs` are names, not implemented effects. Sailing's 6 nodes wait for a
  `life.sailing` skill. Guard tests: `98_world_life_skill_tree_nodes_v1`,
  `99_world_fishing_skill_effects_p1`.
- **Reset (respec)** (`20261004137000_world_life_skill_tree_reset`, `world_life_tree_reset_v1`):
  - Free and per skill. One reset per (account, skill) per cooldown window; resetting Fishing never
    blocks resetting Mining.
  - Reset epochs: SP spends and acquired ranks carry the epoch they were made in, and only the
    current epoch counts. A reset appends one `world_life_tree_resets` row (epoch + 1, refunded SP,
    cleared ranks), so the refund is exact and no row is ever updated or deleted. It still refunds
    after the skill or its nodes are disabled.
  - A reset with nothing to refund is refused (`LIFE_TREE_RESET_EMPTY`) and starts no cooldown.
  - **The cooldown is data, not code**: `world_life_tree_reset_policy.cooldown_seconds`, seeded at
    86400 (24 h). Change it with a forward migration or ops DML; no function writes it. Each reset row
    records the cooldown it was granted under. The tree snapshot reports `reset.nextResetAt`.
  - Guard test: `98_world_life_skill_tree_reset`.
- **Life Skill Book P0** (`20261004138000_world_life_skill_book_p0`, `src/life-skills/life-skill-book-*.js`):
  - Self-only reads `get_my_world_life_skills_v1()` and `get_my_world_life_skill_tree_v1(skill)`, and
    actions `unlock_my_world_life_node_v1(node, request_id)` / `reset_my_world_life_tree_v1(skill, request_id)`.
    Caller = `auth.uid()` of a permanent, non-banned account; the idempotency key is derived on the
    server from the request id, so a lost response replays.
  - Only ACTIVE skills and nodes are visible; unknown and hidden ids look the same
    (`LIFE_SKILL_NOT_FOUND` / `LIFE_NODE_NOT_FOUND`). The menu entry stays hidden until the server lists
    a skill.
  - The tree view carries the server's `canUnlock` / `lockReason` / `nextRankCost` per node and
    `canReset` / `resetBlockedBy` / `nextResetAt` per tree, computed in the same order as the primitives.
    The client never decides a cost or an unlock; the actions re-check everything.
  - Guard tests: `98_world_life_skill_book_p0`, `life-skill-book.integration` (Data API + client parsers).
- **Fishing is the first ACTIVE Life Skill** (`20261004161000_world_fishing_first_life_skill`):
  - ACTIVE: `life.fishing`, `collection.fish.carp`, and the Fishing F2 runtime with a **candidate**
    policy (`fishing.candidate.v1`: bite after 3–9 s, 1.5 s window, 30 s TTL, 20 XP per carp,
    2 s between casts). The policy is one data row; a change applies to new attempts only.
  - Fishing tree P1 (`20261005185000_world_fishing_skill_effects_p1`): `steady_hands` and
    `fish_sense` are ACTIVE. At cast start the DB reads the current reset epoch and freezes a private
    effect snapshot into that attempt. Candidate tuning is +250 ms HOOK response window per
    `steady_hands` rank and -250 ms minimum/maximum bite wait per `fish_sense` rank, both up to
    rank 3. The browser never supplies ranks or modifiers. A later reset affects the next cast only.
  - Still COMING_SOON: `baitcraft`, `rare_fish_sense`, `boat_fishing`,
    `deep_sea_fishing`, `creature.bridge.activity.fishing` (NOOP decisions), and every other
    Life Skill.
  - Player path: 🎣 at the two Inkyung pond spots (`src/activity/fishing-spots.js`) opens the fishing
    panel; `fishing-client.js` calls `/api/world-fishing` (start / HOOK / CANCEL / settle / read). The
    server verifies the account, samples the timing, decides the result at receipt and settles through
    7.4. The client sends only ids and shows the server's bite window. F3 start/active HOOK require
    fresh trusted position evidence and an atomic bank lease; browser pose is never that evidence.
    The authoritative producer is not connected, so the default gate blocks play until integration.
  - The HTTP endpoint stays off until `WORLD_FISHING_API_ENABLED=1` is set in the server environment;
    while it answers 404 no 🎣 action is offered.
  - Deployment boundary: public `main` and Vercel deployment do not apply Production SQL.
    Activation above describes a database after its forward migration; Production schema,
    catalog/runtime and RPC grants must be read back independently before enabling HTTP.
    F3 is the default exposure prerequisite; a T1 prototype exception requires owner approval.
  - F3 contract and rollout plan: `apps/world/server/fishing-f3.md` and
    `docs/implementation/fishing-production-migration-plan.md`; Production foundation, activation
    and player exposure are separate steps. Presence enforcement defaults true, never a browser option.
  - Guard tests: `87_world_fishing_f2`, `99_world_fishing_f3`,
    `99_world_fishing_skill_effects_p1`, `fishing.integration`, `fishing-f3.integration`,
    `fishing-client.integration` (browser client → production handler → local Data API),
    `fishing-client-panel`, `fishing-f3` geometry/API boundary.
- **Gathering P0** (`20261005202000_world_gathering_p0`):
  - Publishes one semantic source, `gathering.campus.leaf_pile_01`, mirroring
    `gathering-source-registry.js`.
  - Frozen output identity is `material.campus_leaf ×1` + `collection.plant.campus_leaf` +
    `life.gathering` XP. XP tuning and minimum harvest interval are operator policy, not client input.
  - `world_gathering_harvest_v1` is service-role only and performs start → freeze → finalize →
    shared Activity settlement in one statement. Exact retries replay one receipt; failed settlement
    rolls back the whole harvest.
  - CLOSED by default: runtime disabled, source / Life Skill / Collection entry `COMING_SOON`.
    No browser/HTTP action or trusted spatial evidence is added in P0.
  - Player exposure requires a later trusted world-presence gate for the semantic source; browser
    pose relayed behind a service credential is not sufficient.
  - Guard tests: `99_world_gathering_p0`, `gathering-source-registry`,
    `gathering.integration`.
- Still open: authoritative consumers for the four deferred Fishing nodes; trusted authoritative
  position producer integration for Fishing and Gathering player exposure; Production forward-
  migration rehearsal/application and activation; candidate balance tuning.

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

### 7.4 Settlement (Activity P0 implemented)
- Outcome-dependent outputs of a verified Activity result go through one server-side path:
  `private.world_activity_settle_v1(user, attempt, plan)`
  (`20261004131000_world_activity_settlement_p0`).
  - It requires the attempt to be SUCCEEDED with a `result_ref`.
  - It applies Inventory grant, Collection discovery and Life Skill XP, and writes one append-only
    receipt in `world_activity_settlements`, all in one transaction.
  - It replays the receipt for the same plan and refuses a different plan.
- The plan is computed by the domain resolver from its frozen server outcome (Fishing F2: the
  snapshotted catch). The path never takes a plan from a client role; its callers are reviewed in
  test 93.
- Creature growth stays on the Life / Combat -> Creature bridges, decided in the same transaction as
  the source finalize. Fishing F2 starts through `world_life_activity_start_with_creature_v1`
  (requires `life.fishing` ACTIVE, binds the Creature party revision) and finalizes through
  `world_life_activity_finalize_with_creature_v1`. While `creature.bridge.activity.fishing` is
  COMING_SOON (XP 0), each finalize records a NOOP decision, so activating the bridge later never
  grants growth retroactively. Settlement (items / discovery / Life XP) is a separate, later
  transaction and does not touch Creature state. Combat outputs (drops, gear) will use this path once the Combat resolver
  exists; adding an output kind extends the plan schema.

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
- **`world_life_node_unlock_v1` took an un-namespaced advisory lock (resolved).** Since
  `20261004135000` it uses `'world_life:' || user`, like every other domain.
- **Legacy Shared NPC DB v1 is dormant and superseded for runtime authority.** Production readback on 2026-10-06 found `world_npc_shared_ticks_v1` with 0 rows and service-role-only `get/claim/commit_world_npc_shared_*_v1`. The October P0 runtime does not call these RPCs and uses a 250 ms canonical snapshot + Place Zone interest contract instead. Keep the DB objects dormant until an explicitly approved Production cleanup migration; do not reuse the legacy 60 s action vocabulary as a second canonical clock. Reconciliation: `SHARED_NPC_AUTHORITY_RECONCILIATION_2026-10-06.md`.
- **Four service-role wrappers rely on the GRANT alone, with no `auth.role()` check in the body**: `world_exp_grant_v1`, `world_progression_get_v1`, `claim_world_npc_shared_tick_v1`, `commit_world_npc_shared_tick_v1`. The GRANT is correct today and is asserted in `01_grants_contract`; the in-body check is the missing second layer.
- **Append-only triggers that also block DELETE broke account deletion (resolved).** The
  `auth.users` FK cascade failed if any such row existed; economy ledgers block UPDATE only. Every
  DELETE-guarding append-only trigger now allows a DELETE only once the owning account row is gone:
  Creature ledgers (incl. Duck Companion observations / claims and the bridge contexts / decisions)
  and Activity settlement receipts (`20261004133000`); Biryong relationship events, the Life SP
  ledger and unlocked Life nodes (`20261004134000`); Life tree resets (`20261004137000`). Direct UPDATE / DELETE of a live account's rows
  is still refused. Guard test: `79_account_delete_ledger_cascade` (through
  `delete_my_inhagame_account_v1`). A new append-only table that guards DELETE must use the same
  rule.
- **The Life Skill tree catalog and edges had no immutability trigger (resolved).** Since
  `20261004135000`, published node costs, gates, skill and max rank and every edge are frozen; edges
  are same-skill only and cannot require more than the prerequisite's max rank.
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
