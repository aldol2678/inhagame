-- INHA WORLD P0 Life Skill Authority.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a8500000-0000-4000-8000-0000000000a8','authenticated','authenticated','life-a@example.test',now(),false),
 ('b8500000-0000-4000-8000-0000000000b8','authenticated','authenticated','life-b@example.test',now(),false),
 ('c8500000-0000-4000-8000-0000000000c8','authenticated','authenticated',null,null,true),
 ('d8500000-0000-4000-8000-0000000000d8','authenticated','authenticated','life-d@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a8500000-0000-4000-8000-0000000000a8','생활A',false),
 ('b8500000-0000-4000-8000-0000000000b8','생활B',false),
 ('c8500000-0000-4000-8000-0000000000c8','생활게스트',false),
 ('d8500000-0000-4000-8000-0000000000d8','생활정지',true);

-- ---- schema / mirror ----
select has_table('private','world_life_skill_catalog','Life Skill catalog mirror exists');
select has_table('private','world_life_skill_thresholds','Life Skill thresholds exist');
select has_table('private','world_player_life_skills','player Life Skill projection exists');
select has_table('private','world_life_skill_xp_transactions','Life Skill XP ledger exists');
select col_is_pk('private','world_life_skill_catalog',array['skill_id'],'skill id is primary key');
select col_is_pk('private','world_life_skill_thresholds',array['curve_id','level'],'curve level is primary key');
select col_is_pk('private','world_player_life_skills',array['user_id','skill_id'],
  'one projection row per account/skill');
select col_is_unique('private','world_life_skill_xp_transactions',array['idempotency_key'],
  'Life Skill XP idempotency key is globally unique');

select is((select count(*) from private.world_life_skill_catalog),11::bigint,'11 long-term Life Skills are mirrored');
select is((select count(*) from private.world_life_skill_catalog where status='COMING_SOON'),10::bigint,
  'only Fishing is activated (20261004139000)');
select results_eq($$
  select skill_id,curve_id,status from private.world_life_skill_catalog order by skill_id
$$,$$values
  ('life.archaeology'::text,'life.common.v1'::text,'COMING_SOON'::text),
  ('life.cooking','life.common.v1','COMING_SOON'),
  ('life.crafting','life.common.v1','COMING_SOON'),
  ('life.farming','life.common.v1','COMING_SOON'),
  ('life.fishing','life.common.v1','ACTIVE'),
  ('life.gathering','life.common.v1','COMING_SOON'),
  ('life.mining','life.common.v1','COMING_SOON'),
  ('life.photography','life.common.v1','COMING_SOON'),
  ('life.research','life.common.v1','COMING_SOON'),
  ('life.woodcutting','life.common.v1','COMING_SOON'),
  ('life.woodworking','life.common.v1','COMING_SOON')
$$,'DB skill mirror matches the code authority subset');
select is((select count(*) from private.world_life_skill_thresholds where curve_id='life.common.v1'),20::bigint,
  'committed common curve publishes Lv1..20');
select results_eq($$
  select curve_id,level,min_total_xp,cumulative_sp from private.world_life_skill_thresholds
   where level in (1,2,4,5,20) order by curve_id,level
$$,$$values ('life.common.v1'::text,1,0::bigint,0),('life.common.v1',2,100,1),
  ('life.common.v1',4,600,3),('life.common.v1',5,1000,5),('life.common.v1',20,19000,23)$$,
  'committed common curve is 50*L*(L-1) with cumulative per-skill SP');

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_life_skill_catalog'::regclass,
  'private.world_life_skill_thresholds'::regclass,
  'private.world_player_life_skills'::regclass,
  'private.world_life_skill_xp_transactions'::regclass
)), 'Life Skill tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array[
       'private.world_life_skill_catalog',
       'private.world_life_skill_thresholds',
       'private.world_player_life_skills',
       'private.world_life_skill_xp_transactions'
     ]) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r,
  'private.world_life_skill_xp_apply_v1(uuid,text,bigint,text,text,text)','execute'),
  format('%s cannot call internal Life Skill XP apply',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,
  'private.world_life_skills_list_v1(uuid)','execute'),
  format('%s cannot call private Life Skill list',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(to_regprocedure('public.world_life_skill_xp_apply_v1(uuid,text,bigint,text,text,text)') is null,
  'no generic public Life Skill XP write RPC exists');

-- ---- fresh read does not provision state ----
select is((private.world_life_skill_snapshot_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing')->>'totalXp')::bigint,0::bigint,
  'fresh skill snapshot reads 0 XP');
select is((private.world_life_skill_snapshot_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing')->>'level')::int,1,
  'fresh skill snapshot derives Lv1');
select is((select count(*) from private.world_player_life_skills
  where user_id='a8500000-0000-4000-8000-0000000000a8'),0::bigint,
  'read-only fresh snapshot provisions no player row');

-- ---- COMING_SOON write gate (fixture: Fishing back to COMING_SOON, rolled back) ----
update private.world_life_skill_catalog set status='COMING_SOON' where skill_id='life.fishing';
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'a8500000-0000-4000-8000-0000000000a8','life.fishing',10,
    'activity','activity.fishing.inkyung:attempt_001','life-xp:a:fishing:prelive')
$$,'P0001','LIFE_SKILL_INACTIVE','COMING_SOON skill cannot receive permanent XP');
select is((select count(*) from private.world_player_life_skills),0::bigint,
  'refused pre-live XP creates no projection');

-- ---- curve contract: all extra thresholds below are test-only and rollback ----
select throws_ok($$
  insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp)
  values ('life.common.v1',22,30000)
$$,'23514','LIFE_SKILL_CURVE_INVALID','curve append must be sequential');
select throws_ok($$
  update private.world_life_skill_thresholds set min_total_xp=90
   where curve_id='life.common.v1' and level=2
$$,'42501','LIFE_SKILL_CURVE_IMMUTABLE','published threshold rows cannot be rewritten');
select throws_ok($$
  delete from private.world_life_skill_thresholds
   where curve_id='life.common.v1' and level=4
$$,'42501','LIFE_SKILL_CURVE_IMMUTABLE','published threshold rows cannot be deleted');

insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp) values ('life.test.v1',1,0);
insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp) values ('life.test.v1',2,50);
select throws_ok($$
  insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp)
  values ('life.test.v2',2,50)
$$,'23514','LIFE_SKILL_CURVE_INVALID','a new curve must start at Lv1=0');

-- Test activation only. Rollback restores the committed statuses.
update private.world_life_skill_catalog
   set status='ACTIVE'
 where skill_id in ('life.fishing','life.gathering','life.archaeology');

-- ---- XP apply / level derivation / idempotency ----
select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing',120,
  'activity','activity.fishing.inkyung:attempt_001','life-xp:a:fishing:001')->>'status',
  'SUCCESS','first verified Fishing XP grant succeeds');
select results_eq($$
  select total_xp,version from private.world_player_life_skills
   where user_id='a8500000-0000-4000-8000-0000000000a8' and skill_id='life.fishing'
$$,$$values (120::bigint,1::bigint)$$,'Fishing projection stores XP only, not Level');
select results_eq($$
  select amount,xp_before,xp_after,level_before,level_after,source_type,source_id
    from private.world_life_skill_xp_transactions
   where idempotency_key='life-xp:a:fishing:001'
$$,$$values (120::bigint,0::bigint,120::bigint,1,2,'activity'::text,
  'activity.fishing.inkyung:attempt_001'::text)$$,'ledger snapshots the server-derived level-up');

select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing',120,
  'activity','activity.fishing.inkyung:attempt_001','life-xp:a:fishing:001')->>'status',
  'ALREADY_PROCESSED','same XP key replays without adding XP');
select is((select total_xp from private.world_player_life_skills
  where user_id='a8500000-0000-4000-8000-0000000000a8' and skill_id='life.fishing'),
  120::bigint,'XP replay leaves projection unchanged');

update private.world_life_skill_catalog set status='DISABLED' where skill_id='life.fishing';
select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing',120,
  'activity','activity.fishing.inkyung:attempt_001','life-xp:a:fishing:001')->>'status',
  'ALREADY_PROCESSED','exact committed replay survives a later skill disable');
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'a8500000-0000-4000-8000-0000000000a8','life.fishing',10,
    'activity','activity.fishing.inkyung:attempt_disabled','life-xp:a:fishing:disabled')
$$,'P0001','LIFE_SKILL_INACTIVE','a disabled skill refuses new XP');
update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';

select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'a8500000-0000-4000-8000-0000000000a8','life.fishing',121,
    'activity','activity.fishing.inkyung:attempt_001','life-xp:a:fishing:001')
$$,'23505','IDEMPOTENCY_CONFLICT','XP key cannot change amount');

select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing',500,
  'activity','activity.fishing.inkyung:attempt_002','life-xp:a:fishing:002')->>'status',
  'SUCCESS','one verified result may jump multiple levels');
select results_eq($$
  select total_xp,version,
         (private.world_life_skill_snapshot_v1(user_id,skill_id)->>'level')::int
    from private.world_player_life_skills
   where user_id='a8500000-0000-4000-8000-0000000000a8' and skill_id='life.fishing'
$$,$$values (620::bigint,2::bigint,4)$$,'620 XP derives Lv4 from the published curve');
select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing',19000,
  'activity','activity.fishing.inkyung:attempt_003','life-xp:a:fishing:003')->>'status',
  'SUCCESS','a large verified grant crosses the highest defined threshold');
select is((private.world_life_skill_snapshot_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing')->>'level')::int,20,
  '19620 XP derives the highest defined Lv20');
select is(private.world_life_skill_snapshot_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing')->>'isMaxLevel',
  'true','XP beyond the highest defined threshold is retained at the current max-defined level');
select is(private.world_life_skill_snapshot_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.fishing')->>'nextLevelXp',
  null::text,'max-defined level has no invented next threshold');

-- ---- skill and account isolation ----
select is(private.world_life_skill_xp_apply_v1(
  'a8500000-0000-4000-8000-0000000000a8','life.gathering',50,
  'activity','activity.gathering.campus:attempt_001','life-xp:a:gathering:001')->>'status',
  'SUCCESS','Gathering uses the same core but a separate projection');
select is((select total_xp from private.world_player_life_skills
  where user_id='a8500000-0000-4000-8000-0000000000a8' and skill_id='life.gathering'),
  50::bigint,'Gathering XP is independent');
select is((select total_xp from private.world_player_life_skills
  where user_id='a8500000-0000-4000-8000-0000000000a8' and skill_id='life.fishing'),
  19620::bigint,'Gathering does not change Fishing XP');

select is(private.world_life_skill_xp_apply_v1(
  'b8500000-0000-4000-8000-0000000000b8','life.fishing',25,
  'activity','activity.fishing.inkyung:attempt_b001','life-xp:b:fishing:001')->>'status',
  'SUCCESS','another account has an independent Fishing projection');
select is((select total_xp from private.world_player_life_skills
  where user_id='b8500000-0000-4000-8000-0000000000b8' and skill_id='life.fishing'),
  25::bigint,'other account XP is isolated');

select is((private.world_life_skills_list_v1('a8500000-0000-4000-8000-0000000000a8')->'skills'->0->>'skillId'),
  'life.archaeology','server list is stable-sorted by skill id');
select is(jsonb_array_length(private.world_life_skills_list_v1(
  'a8500000-0000-4000-8000-0000000000a8')->'skills'),11,
  'server read returns all registry-mirrored skills');
select is((
  select x->>'status'
  from jsonb_array_elements(private.world_life_skills_list_v1(
    'a8500000-0000-4000-8000-0000000000a8')->'skills') x
  where x->>'skillId'='life.woodcutting'
),'COMING_SOON','P1-B skill remains visibly pre-activation');

-- ---- raw input / account boundaries ----
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'a8500000-0000-4000-8000-0000000000a8','life.fishing',0,
    'activity','x','life-xp:zero')
$$,'22023','INVALID_AMOUNT','zero XP is refused');
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'a8500000-0000-4000-8000-0000000000a8','life.fishing',10,
    'click','raw_button','life-xp:raw')
$$,'22023','INVALID_SOURCE','raw UI input is not an XP source vocabulary');
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'c8500000-0000-4000-8000-0000000000c8','life.fishing',10,
    'system','test','life-xp:guest')
$$,'22023','ACCOUNT_UNAVAILABLE','guest has no persistent Life Skill XP');
select throws_ok($$
  select private.world_life_skill_xp_apply_v1(
    'd8500000-0000-4000-8000-0000000000d8','life.fishing',10,
    'system','test','life-xp:banned')
$$,'22023','ACCOUNT_UNAVAILABLE','banned account has no persistent Life Skill XP');

select throws_ok($$
  update private.world_life_skill_xp_transactions
     set amount=999
   where idempotency_key='life-xp:a:fishing:001'
$$,'42501','LIFE_SKILL_XP_APPEND_ONLY','Life Skill XP ledger is append-only');

-- ---- World EXP remains untouched ----
select is((select count(*) from private.world_exp_transactions
  where user_id in (
    'a8500000-0000-4000-8000-0000000000a8',
    'b8500000-0000-4000-8000-0000000000b8'
  )),0::bigint,'Life Skill XP creates no Campus World EXP transaction');
select is((select count(*) from private.world_player_progression
  where user_id in (
    'a8500000-0000-4000-8000-0000000000a8',
    'b8500000-0000-4000-8000-0000000000b8'
  )),0::bigint,'Life Skill XP creates no Campus World progression projection');

-- ---- account lifecycle ----
delete from auth.users where id='a8500000-0000-4000-8000-0000000000a8';
select is((select count(*) from private.world_player_life_skills
  where user_id='a8500000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes Life Skill projections');
select is((select count(*) from private.world_life_skill_xp_transactions
  where user_id='a8500000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes account-scoped Life Skill XP history');

select * from finish();
rollback;
