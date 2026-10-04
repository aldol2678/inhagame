-- READ ONLY. Run against the identified GAMES Production project before preparing any DDL.
-- No auth/user payloads, secrets, grants, catalog mutation or migration-history writes.
select version,name from supabase_migrations.schema_migrations order by version desc limit 12;

select jsonb_build_object(
  'checked_at',clock_timestamp(),
  'sp_transactions',(select count(*) from private.world_life_sp_transactions),
  'player_nodes',(select count(*) from private.world_player_life_nodes),
  'tree_definitions',(select count(*) from private.world_life_skill_tree_catalog),
  'curve_levels',(select count(*) from private.world_life_skill_thresholds where curve_id='life.common.v1'),
  'skill_status',(select status from private.world_life_skill_catalog where skill_id='life.fishing'),
  'carp_status',(select status from private.world_collection_entry_catalog where entry_id='collection.fish.carp'),
  'runtime_present',to_regclass('private.world_fishing_runtime') is not null,
  'settlements_present',to_regclass('private.world_activity_settlements') is not null,
  'f3_positions_present',to_regclass('private.world_fishing_positions') is not null,
  'book_present',to_regprocedure('public.get_my_world_life_skills_v1()') is not null
) as preflight;

select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
  md5(p.prosrc) as body_md5,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname in (
  'world_activity_account_ok_v1','world_activity_start_v1','world_activity_finalize_v1',
  'world_life_activity_start_with_creature_v1','world_life_activity_finalize_with_creature_v1',
  'world_inventory_grant_v1','world_collection_discover_v1','world_life_skill_xp_apply_v1',
  'world_life_skill_snapshot_v1','world_life_skill_account_ok_v1')
order by p.proname;

select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='private' and table_name in (
  'world_activity_attempts','world_life_progression_thresholds','world_life_skill_thresholds',
  'world_life_skill_tree_catalog','world_life_skill_tree_edges','world_life_sp_transactions',
  'world_player_life_nodes') order by table_name,ordinal_position;
