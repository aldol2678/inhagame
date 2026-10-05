-- Authority guard: the replayed schema is internally consistent.
-- Contract: docs/architecture/AUTHORITY_MAP.md (section 5, migration collision guard).
--
-- Postgres validates a plpgsql body only when it runs. A superseded migration that re-runs
-- `create table if not exists` (silently skipped) and then `create or replace function` against
-- its own, different column set therefore replays cleanly and breaks at runtime (the #91 / #98
-- shape). plpgsql_check compiles every body against the schema the migrations actually produced.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists plpgsql_check with schema extensions;
select * from no_plan();

-- Every error plpgsql_check reports for the plpgsql functions in the given schemas.
-- Trigger functions are checked against the table they are attached to; unattached trigger
-- functions cannot be compiled without one and are skipped.
create function pg_temp.authority_compile_errors(p_schemas text[]) returns setof text
language sql volatile as $$
  select p.oid::regprocedure::text || coalesce(' line ' || r.lineno, '') || ': ' || r.message
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
  left join lateral (select t.tgrelid from pg_trigger t where t.tgfoid = p.oid limit 1) t on true
  cross join lateral extensions.plpgsql_check_function_tb(
    p.oid, coalesce(t.tgrelid, 0),
    fatal_errors => false, other_warnings => false, extra_warnings => false,
    performance_warnings => false, security_warnings => false) r
  where n.nspname = any (p_schemas)
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and (p.prorettype <> 'trigger'::regtype or t.tgrelid is not null)
    and r.level = 'error'
$$;

-- ---- 1. the real schema ----
select is_empty(
  $$select * from pg_temp.authority_compile_errors(array['public', 'private'])$$,
  'every plpgsql function in public/private compiles against the replayed schema');

select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$$,
  'every SECURITY DEFINER function pins search_path');

-- ---- 2. self-test: the detector catches the #91 / #98 collision ----
-- Condensed reproduction, created and rolled back inside this transaction.
create schema authority_fixture;

-- Canonical contract (shape of #98 20261004083000_world_life_progression_p0).
create table authority_fixture.life_progression_thresholds (
  curve_id text not null, level integer not null,
  min_total_skill_xp bigint not null, cumulative_sp integer not null,
  primary key (curve_id, level));

-- Superseded migration (shape of #91 20261003170000): different contract, same name.
create table if not exists authority_fixture.life_progression_thresholds (
  curve_id text not null, level integer not null,
  min_total_xp bigint not null, skill_points_reward integer not null,
  primary key (curve_id, level));

-- ... whose replacement function is then installed against the skipped definition.
create or replace function authority_fixture.life_progression_snapshot(p_total bigint)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_level integer; v_reward integer;
begin
  select t.level, t.skill_points_reward into v_level, v_reward
    from authority_fixture.life_progression_thresholds t
   where t.min_total_xp <= p_total
   order by t.level desc limit 1;
  return jsonb_build_object('level', v_level, 'sp', v_reward);
end;
$$;

select ok(
  to_regprocedure('authority_fixture.life_progression_snapshot(bigint)') is not null,
  'fixture: the incompatible replacement replays without an error (why a compile check is needed)');

select ok(
  exists (select 1 from pg_temp.authority_compile_errors(array['authority_fixture']) e
          where e like '%min_total_xp%does not exist%' or e like '%skill_points_reward%does not exist%'),
  'fixture: the compile check reports the column the skipped table never got');

-- A compatible follow-up (ALTER + new function version) is not a finding.
alter table authority_fixture.life_progression_thresholds add column sp_pool_id text not null default 'life.global';
create or replace function authority_fixture.life_progression_snapshot(p_total bigint)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_level integer; v_sp integer;
begin
  select t.level, t.cumulative_sp into v_level, v_sp
    from authority_fixture.life_progression_thresholds t
   where t.min_total_skill_xp <= p_total and t.sp_pool_id = 'life.global'
   order by t.level desc limit 1;
  return jsonb_build_object('level', v_level, 'sp', v_sp);
end;
$$;
select is_empty(
  $$select * from pg_temp.authority_compile_errors(array['authority_fixture'])$$,
  'fixture: an intended ALTER TABLE + function follow-up compiles cleanly');

select * from finish();
rollback;
