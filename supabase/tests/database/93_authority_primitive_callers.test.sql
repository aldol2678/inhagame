-- Authority guard: who may call a progression / state mutation primitive, and who may write the
-- tables those primitives own. Contract: docs/architecture/AUTHORITY_MAP.md (sections 3 and 4).
--
-- The call graph is read from the replayed catalog, not from migration text:
--   * plpgsql bodies: plpgsql_check's parsed dependency list (plpgsql_show_dependency_tb);
--   * every body (any language, incl. dynamic SQL strings and trigger functions): the current
--     prosrc with comments removed, matched on the primitive name followed by "(".
-- Only the definition that exists after all migrations is inspected, so superseded versions of a
-- function never produce findings.
--
-- To add a caller or writer: add one row below with the reason, and the matching line to the
-- Authority Map. A new edge without a row fails this test; a removed edge fails it too, so the
-- list never keeps stale permissions.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;
select * from no_plan();

-- ---- protected primitives (all in schema private) ----
create temp table authority_primitive(name text primary key, owner text not null) on commit drop;
insert into authority_primitive(name, owner) values
  ('world_wallet_apply_v1',                  'Economy / Wallet'),
  ('world_exp_apply_v1',                     'Progression / Character EXP'),
  ('world_inventory_grant_v1',               'Inventory'),
  ('world_inventory_consume_v1',             'Inventory'),
  ('world_inventory_mutate_v1',              'Inventory'),
  ('world_reward_grant_v1',                  'Reward'),
  ('world_life_skill_xp_apply_v1',           'Life / Skill XP'),
  ('world_life_node_unlock_v1',              'Life / Skill Point + Tree'),
  ('world_collection_discover_v1',           'Collection'),
  ('world_creature_grant_v1',                'Creature / Ownership'),
  ('world_creature_observe_v1',              'Creature / Observation'),
  ('world_creature_party_set_v1',            'Creature / Party'),
  ('world_creature_activity_accept_v1',      'Creature / Growth'),
  ('world_creature_evolution_candidate_v1',  'Creature / Evolution'),
  ('world_creature_evolution_context_gate_v1','Creature / Evolution'),
  ('world_creature_evolution_commit_v1',     'Creature / Evolution'),
  ('world_activity_start_v1',                'Activity / Attempt'),
  ('world_activity_finalize_v1',             'Activity / Attempt'),
  ('world_combat_start_v1',                  'Combat / Encounter'),
  ('world_combat_state_write_v1',            'Combat / Encounter'),
  ('world_combat_finalize_v1',               'Combat / Encounter'),
  ('world_biryong_relationship_advance_v1',  'Biryong / NPC Relationship');

select ok(to_regproc('private.' || name) is not null, format('protected primitive private.%s exists', name))
from authority_primitive;

-- Body text with SQL comments removed (dollar-quoted bodies keep their own text otherwise).
create function pg_temp.authority_body(p_src text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(p_src, '')), '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g')
$$;

create temp table authority_fn on commit drop as
select p.oid, n.nspname || '.' || p.proname as fn, l.lanname, p.prorettype,
       (select t.tgrelid from pg_trigger t where t.tgfoid = p.oid limit 1) as trigger_rel,
       pg_temp.authority_body(p.prosrc) as body
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('public', 'private')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

create temp table authority_edge on commit drop as
select distinct f.fn as caller, 'private.' || a.name as primitive
from authority_fn f
join authority_primitive a
  on f.body ~ ('(^|[^a-z0-9_])' || a.name || '"?\s*\(')
where f.fn <> 'private.' || a.name
union
select distinct f.fn, d.schema || '.' || d.name
from authority_fn f
cross join lateral extensions.plpgsql_show_dependency_tb(f.oid, coalesce(f.trigger_rel, 0)) d
where f.lanname = 'plpgsql'
  and (f.prorettype <> 'trigger'::regtype or f.trigger_rel is not null)
  and d.type = 'FUNCTION' and d.schema = 'private'
  and d.name in (select name from authority_primitive)
  and f.fn <> d.schema || '.' || d.name;

-- ---- 1. primitive call allowlist (caller -> primitive) ----
create temp table authority_allowed_call(caller text, primitive text, reason text) on commit drop;
insert into authority_allowed_call values
  -- Wallet: only Reward, Shop and the service-role server wrappers move balances.
  ('private.world_reward_grant_v1',            'private.world_wallet_apply_v1', 'Reward orchestrator CURRENCY grant'),
  ('public.purchase_world_shop_listing_v1',    'private.world_wallet_apply_v1', 'Shop purchase debit (price from listing, buyer = auth.uid())'),
  ('public.world_wallet_credit_v1',            'private.world_wallet_apply_v1', 'service_role server API wrapper'),
  ('public.world_wallet_debit_v1',             'private.world_wallet_apply_v1', 'service_role server API wrapper'),
  -- Character EXP
  ('private.world_reward_grant_v1',            'private.world_exp_apply_v1',    'Reward orchestrator EXP grant'),
  ('public.world_exp_grant_v1',                'private.world_exp_apply_v1',    'service_role server API wrapper'),
  -- Inventory
  ('private.world_reward_grant_v1',            'private.world_inventory_grant_v1', 'Reward orchestrator ITEM grant'),
  ('private.world_inventory_mutate_v1',        'private.world_inventory_grant_v1', 'Inventory-internal atomic N-consume/M-grant'),
  ('public.purchase_world_shop_listing_v1',    'private.world_inventory_grant_v1', 'Shop purchase delivery (same transaction as the debit)'),
  ('public.world_inventory_ensure_default_items_v1', 'private.world_inventory_grant_v1', 'service_role default-item bootstrap'),
  ('public.world_inventory_grant_item_v1',     'private.world_inventory_grant_v1', 'service_role server API wrapper'),
  ('private.world_inventory_mutate_v1',        'private.world_inventory_consume_v1', 'Inventory-internal atomic N-consume/M-grant'),
  -- Reward: fixed RewardDefinitions are executed only for these verified sources.
  ('public.advance_world_quest_v1',            'private.world_reward_grant_v1', 'Main 1 completion reward (same transaction as stage 4 -> 5)'),
  ('public.advance_world_navigation_quest_v1', 'private.world_reward_grant_v1', 'Main 2 completion reward (same transaction as the final stage)'),
  ('public.answer_my_world_daily_quiz_v1',     'private.world_reward_grant_v1', 'Daily quiz PASS reward, judged by the server'),
  ('private.world_attendance_claim_v1',        'private.world_reward_grant_v1', 'Attendance claim, day from the DB clock'),
  ('private.world_mcm_claim_reward_v1',        'private.world_reward_grant_v1', 'MCM 2026 verified completion claims'),
  ('public.world_reward_grant_v1',             'private.world_reward_grant_v1', 'service_role server API wrapper'),
  -- Collection
  ('public.world_collection_discover_v1',      'private.world_collection_discover_v1', 'service_role server API wrapper'),
  -- Creature: external domains reach Creature only through the bridge functions, never the tables.
  ('public.world_creature_grant_v1',           'private.world_creature_grant_v1', 'service_role server API wrapper'),
  ('public.world_creature_observe_v1',         'private.world_creature_observe_v1', 'service_role server API wrapper'),
  ('public.world_creature_party_set_v1',       'private.world_creature_party_set_v1', 'service_role server API wrapper'),
  ('public.world_creature_activity_accept_v1', 'private.world_creature_activity_accept_v1', 'service_role server API wrapper'),
  ('private.world_life_activity_finalize_with_creature_v1', 'private.world_creature_activity_accept_v1',
     'Life -> Creature bridge P1: same transaction as the Activity finalize that produced result_ref'),
  ('private.world_combat_finalize_with_creature_v1', 'private.world_creature_activity_accept_v1',
     'Combat -> Creature bridge P1: same transaction as the Combat finalize that produced result_ref'),
  ('private.world_inkyung_duck_observe_v1',   'private.world_creature_observe_v1',
     'Duck Companion P1: records a verified Inkyung duck observation (service_role wrapper only)'),
  ('private.world_duck_companion_bond_v1',     'private.world_creature_grant_v1',
     'Duck Companion P1 acquisition rule: grants duck.base after re-counting server observations'),
  ('private.world_duck_companion_bond_v1',     'private.world_creature_party_set_v1',
     'Duck Companion P1: auto-activates the bonded duck only when the party is empty'),
  ('public.world_creature_evolution_candidate_v1',    'private.world_creature_evolution_candidate_v1', 'service_role server API wrapper'),
  ('public.world_creature_evolution_context_gate_v1', 'private.world_creature_evolution_context_gate_v1', 'service_role server API wrapper'),
  ('public.world_creature_evolution_commit_v1',       'private.world_creature_evolution_commit_v1', 'service_role server API wrapper'),
  -- Activity / Combat lifecycle
  ('public.world_activity_start_v1',           'private.world_activity_start_v1', 'service_role server API wrapper'),
  ('public.world_activity_finalize_v1',        'private.world_activity_finalize_v1', 'service_role server API wrapper'),
  ('private.world_life_activity_start_with_creature_v1', 'private.world_activity_start_v1', 'Life -> Creature bridge P1 start (binds party revision)'),
  ('private.world_life_activity_finalize_with_creature_v1', 'private.world_activity_finalize_v1', 'Life -> Creature bridge P1 finalize'),
  ('public.world_combat_start_v1',             'private.world_combat_start_v1', 'service_role server API wrapper'),
  ('public.world_combat_state_write_v1',       'private.world_combat_state_write_v1', 'service_role server API wrapper'),
  ('public.world_combat_finalize_v1',          'private.world_combat_finalize_v1', 'service_role server API wrapper'),
  ('private.world_combat_start_with_creature_v1', 'private.world_combat_start_v1', 'Combat -> Creature bridge P1 start (binds party revision)'),
  ('private.world_combat_finalize_with_creature_v1', 'private.world_combat_finalize_v1', 'Combat -> Creature bridge P1 finalize'),
  -- Biryong NPC relationship: only the trusted service-role wrapper may advance persistent stage.
  ('public.world_biryong_npc_relationship_advance_v1', 'private.world_biryong_relationship_advance_v1',
     'Biryong NPC relationship P0: service_role wrapper advances exactly one verified stage');
-- Intentionally NO callers yet: world_inventory_mutate_v1, world_life_skill_xp_apply_v1,
-- world_life_node_unlock_v1 (foundations without a settlement path; see the Authority Map).

select set_eq(
  'select caller || '' -> '' || primitive from authority_edge',
  'select caller || '' -> '' || primitive from authority_allowed_call',
  'primitive call graph equals the Authority Map allowlist (extra row = unreviewed caller, missing row = stale entry)');

select is_empty(
  $$select caller || ' -> ' || primitive from authority_allowed_call
    where caller not in (select fn from authority_fn)$$,
  'every allowlisted caller exists');

-- No function a client role (anon / authenticated) can execute may reach a primitive, directly or
-- through any chain of helpers, except the reviewed self-only RPCs below. The full function call
-- graph is the plpgsql dependency list plus, for non-plpgsql bodies, a name match.
create temp table authority_call on commit drop as
select distinct f.fn as caller, d.schema || '.' || d.name as callee
from authority_fn f
cross join lateral extensions.plpgsql_show_dependency_tb(f.oid, coalesce(f.trigger_rel, 0)) d
where f.lanname = 'plpgsql'
  and (f.prorettype <> 'trigger'::regtype or f.trigger_rel is not null)
  and d.type = 'FUNCTION' and d.schema in ('public', 'private')
union
select distinct f.fn, g.fn
from authority_fn f
join authority_fn g on f.body ~ ('(^|[^a-z0-9_])' || split_part(g.fn, '.', 2) || '"?\s*\(')
where f.lanname <> 'plpgsql' and f.fn <> g.fn
union
select caller, primitive from authority_edge;

select set_eq(
  $$with recursive reach(root, fn) as (
      select f.fn, f.fn from authority_fn f
      join pg_proc p on p.oid = f.oid
      where f.fn like 'public.%'
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      union
      select r.root, c.callee from reach r join authority_call c on c.caller = r.fn
    )
    select distinct r.root from reach r
    where r.fn in (select 'private.' || name from authority_primitive)$$,
  array[
    'public.purchase_world_shop_listing_v1',              -- price and item come from the server listing
    'public.answer_my_world_daily_quiz_v1',               -- correctness judged by the server, one PASS per day
    'public.claim_my_world_attendance_v1',                -- day from the DB clock, one claim per day
    'public.claim_my_mcm_2026_main_reward_v1',            -- requires server-recorded event completion
    'public.claim_my_mcm_landlord_first_clear_reward_v1', -- requires a server-judged landlord clear
    'public.bond_my_duck_companion_v1'                    -- caller = auth.uid(); bond re-counts the server observation ledger
  ],
  'client-executable functions that reach a primitive (transitively) are exactly the reviewed self-only RPCs');

-- ---- 2. protected table writers ----
create temp table authority_table(tbl text primary key, kind text not null check (kind in ('STATE','CATALOG'))) on commit drop;
insert into authority_table values
  ('world_wallets','STATE'), ('world_currency_transactions','STATE'),
  ('world_player_progression','STATE'), ('world_exp_transactions','STATE'),
  ('world_player_items','STATE'), ('world_item_grants','STATE'), ('world_item_consumptions','STATE'),
  ('world_inventory_mutations','STATE'), ('world_inventory_mutation_entries','STATE'),
  ('world_reward_transactions','STATE'), ('world_reward_transaction_entries','STATE'),
  ('world_player_life_skills','STATE'), ('world_life_skill_xp_transactions','STATE'),
  ('world_life_sp_transactions','STATE'), ('world_player_life_nodes','STATE'),
  ('world_player_collection_discoveries','STATE'), ('world_collection_discovery_events','STATE'),
  ('world_player_creatures','STATE'), ('world_creature_xp_transactions','STATE'),
  ('world_creature_memory_tags','STATE'), ('world_creature_activity_events','STATE'),
  ('world_creature_observation_events','STATE'),
  ('world_creature_party_state','STATE'), ('world_creature_party_history','STATE'),
  ('world_creature_evolution_candidates','STATE'), ('world_creature_evolution_events','STATE'),
  ('world_creature_acquisition_claims','STATE'),
  ('world_activity_attempts','STATE'), ('world_combat_encounters','STATE'),
  ('world_biryong_npc_relationship_events','STATE'), ('world_player_biryong_npc_relationships','STATE'),
  ('world_quest_progress_v1','STATE'), ('world_event_progress','STATE'),
  ('world_player_appearance_loadout','STATE'), ('world_purchase_transactions','STATE'),
  ('world_staff_assignments','STATE'), ('world_staff_role_permissions','STATE'),
  -- Definitions: written only by migrations (top-level statements), never by a function.
  ('world_currencies','CATALOG'), ('world_item_catalog','CATALOG'), ('world_level_thresholds','CATALOG'),
  ('world_reward_definitions','CATALOG'), ('world_reward_grants','CATALOG'),
  ('world_shops','CATALOG'), ('world_shop_listings','CATALOG'),
  ('world_life_skill_catalog','CATALOG'), ('world_life_skill_thresholds','CATALOG'),
  ('world_life_progression_thresholds','CATALOG'), ('world_life_skill_tree_catalog','CATALOG'),
  ('world_life_skill_tree_edges','CATALOG'), ('world_collection_entry_catalog','CATALOG'),
  ('world_combat_definition_catalog','CATALOG'), ('world_creature_species_catalog','CATALOG'),
  ('world_creature_form_catalog','CATALOG'), ('world_creature_activity_bridge_catalog','CATALOG'),
  ('world_creature_evolution_rule_catalog','CATALOG'), ('world_life_creature_bridge_catalog','CATALOG'),
  ('world_combat_creature_bridge_catalog','CATALOG'),
  ('world_creature_acquisition_rule_catalog','CATALOG'), ('world_inkyung_duck_observation_subjects','CATALOG'),
  ('world_biryong_npc_relationship_npc_catalog','CATALOG'), ('world_biryong_npc_relationship_fact_catalog','CATALOG');

select ok(to_regclass('private.' || tbl) is not null, format('protected table private.%s exists', tbl))
from authority_table;

create temp table authority_write on commit drop as
select distinct m[2] as tbl, f.fn as writer
from authority_fn f
cross join lateral regexp_matches(f.body,
  '(insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+(?:only\s+)?(?:"?private"?\s*\.\s*)?"?(world_[a-z0-9_]+)"?',
  'g') m
where m[2] in (select tbl from authority_table);

create temp table authority_allowed_write(tbl text, writer text) on commit drop;
insert into authority_allowed_write values
  ('world_wallets', 'private.world_wallet_apply_v1'),
  ('world_currency_transactions', 'private.world_wallet_apply_v1'),
  ('world_player_progression', 'private.world_exp_apply_v1'),
  ('world_exp_transactions', 'private.world_exp_apply_v1'),
  ('world_player_items', 'private.world_inventory_grant_v1'),
  ('world_player_items', 'private.world_inventory_consume_v1'),
  ('world_item_grants', 'private.world_inventory_grant_v1'),
  ('world_item_consumptions', 'private.world_inventory_consume_v1'),
  ('world_inventory_mutations', 'private.world_inventory_mutate_v1'),
  ('world_inventory_mutation_entries', 'private.world_inventory_mutate_v1'),
  ('world_reward_transactions', 'private.world_reward_grant_v1'),
  ('world_reward_transaction_entries', 'private.world_reward_grant_v1'),
  ('world_player_life_skills', 'private.world_life_skill_xp_apply_v1'),
  ('world_life_skill_xp_transactions', 'private.world_life_skill_xp_apply_v1'),
  ('world_life_sp_transactions', 'private.world_life_node_unlock_v1'),
  ('world_player_life_nodes', 'private.world_life_node_unlock_v1'),
  ('world_player_collection_discoveries', 'private.world_collection_discover_v1'),
  ('world_collection_discovery_events', 'private.world_collection_discover_v1'),
  ('world_player_creatures', 'private.world_creature_grant_v1'),
  ('world_player_creatures', 'private.world_creature_activity_accept_v1'),
  ('world_player_creatures', 'private.world_creature_evolution_commit_v1'),
  -- Creature-domain acquisition rule sets bond_entitled on the creature it just granted (same transaction).
  ('world_player_creatures', 'private.world_duck_companion_bond_v1'),
  ('world_creature_acquisition_claims', 'private.world_duck_companion_bond_v1'),
  ('world_creature_xp_transactions', 'private.world_creature_activity_accept_v1'),
  ('world_creature_memory_tags', 'private.world_creature_activity_accept_v1'),
  ('world_creature_activity_events', 'private.world_creature_activity_accept_v1'),
  ('world_creature_observation_events', 'private.world_creature_observe_v1'),
  ('world_creature_party_state', 'private.world_creature_party_set_v1'),
  ('world_creature_party_history', 'private.world_creature_party_set_v1'),
  ('world_creature_evolution_candidates', 'private.world_creature_evolution_candidate_v1'),
  ('world_creature_evolution_candidates', 'private.world_creature_evolution_context_gate_v1'),
  ('world_creature_evolution_candidates', 'private.world_creature_evolution_commit_v1'),
  ('world_creature_evolution_events', 'private.world_creature_evolution_commit_v1'),
  ('world_activity_attempts', 'private.world_activity_start_v1'),
  ('world_activity_attempts', 'private.world_activity_finalize_v1'),
  ('world_combat_encounters', 'private.world_combat_start_v1'),
  ('world_combat_encounters', 'private.world_combat_state_write_v1'),
  ('world_combat_encounters', 'private.world_combat_finalize_v1'),
  ('world_biryong_npc_relationship_events', 'private.world_biryong_relationship_advance_v1'),
  ('world_player_biryong_npc_relationships', 'private.world_biryong_relationship_advance_v1'),
  ('world_quest_progress_v1', 'public.advance_world_quest_v1'),
  ('world_quest_progress_v1', 'public.advance_world_navigation_quest_v1'),
  ('world_quest_progress_v1', 'public.advance_world_first_style_quest_v1'),
  ('world_event_progress', 'public.advance_mcm_2026_event_v1'),
  ('world_event_progress', 'private.world_mcm_try_complete_v1'),
  ('world_player_appearance_loadout', 'public.equip_my_world_item_v1'),
  ('world_player_appearance_loadout', 'public.unequip_my_world_item_v1'),
  ('world_purchase_transactions', 'public.purchase_world_shop_listing_v1');
-- world_staff_assignments / world_staff_role_permissions: no function writes them (ops only).

select set_eq(
  'select tbl || '' <- '' || writer from authority_write',
  'select tbl || '' <- '' || writer from authority_allowed_write',
  'writers of protected tables equal the Authority Map (state is written only by its owning primitive)');

select is_empty(
  $$select w.tbl || ' <- ' || w.writer from authority_write w
    join authority_table t on t.tbl = w.tbl where t.kind = 'CATALOG'$$,
  'no function writes a definition catalog');

select * from finish();
rollback;
