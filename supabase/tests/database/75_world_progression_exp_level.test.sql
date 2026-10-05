-- Economy P0-F0: server-authoritative EXP ledger + derived Level.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a5000000-0000-4000-8000-0000000000a5', 'authenticated', 'authenticated', 'progress-a@example.test', now(), false),
 ('b5000000-0000-4000-8000-0000000000b5', 'authenticated', 'authenticated', 'progress-b@example.test', now(), false),
 ('c5000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', null, null, true),
 ('d5000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated', 'progress-d@example.test', now(), false),
 ('e5000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'progress-e@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a5000000-0000-4000-8000-0000000000a5', '진행A', false),
 ('b5000000-0000-4000-8000-0000000000b5', '진행B', false),
 ('c5000000-0000-4000-8000-0000000000c5', '진행게스트', false),
 ('d5000000-0000-4000-8000-0000000000d5', '진행정지', true),
 ('e5000000-0000-4000-8000-0000000000e5', '진행E', false);

-- ---- schema + canonical thresholds ----
select has_table('private', 'world_level_thresholds', 'level threshold table exists');
select has_table('private', 'world_player_progression', 'progression projection exists');
select has_table('private', 'world_exp_transactions', 'EXP ledger exists');
select col_is_pk('private', 'world_player_progression', array['user_id'], 'one progression row per account');
select col_is_unique('private', 'world_exp_transactions', array['idempotency_key'], 'EXP idempotency key is globally unique');
select col_type_is('private', 'world_player_progression', 'total_exp', 'bigint', 'total EXP is integer authority');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_level_thresholds'::regclass,
  'private.world_player_progression'::regclass,
  'private.world_exp_transactions'::regclass)), 'progression tables have RLS');
select results_eq($$
  select level, min_total_exp from private.world_level_thresholds order by level
$$, $$values
  (1,0::bigint),(2,100),(3,300),(4,600),(5,1000),
  (6,1500),(7,2100),(8,2800),(9,3600),(10,4500)
$$, 'v1 level curve is the canonical 1..10 threshold set');

-- ---- raw authority boundary ----
select ok(not has_table_privilege(r, t, p), format('%s cannot %s %s', r, p, t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['private.world_level_thresholds','private.world_player_progression','private.world_exp_transactions']) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon','authenticated']) r, unnest(array[
  'public.world_exp_grant_v1(uuid,bigint,text,text,text)',
  'public.world_progression_get_v1(uuid)'
]) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f))
from unnest(array[
  'public.world_exp_grant_v1(uuid,bigint,text,text,text)',
  'public.world_progression_get_v1(uuid)'
]) f;
select ok(has_function_privilege('authenticated', 'public.get_my_world_progression_v1()', 'execute'),
  'authenticated account can read own progression');
select ok(not has_function_privilege('anon', 'public.get_my_world_progression_v1()', 'execute'),
  'anon cannot call progression read');
select ok(not has_function_privilege(r, 'private.world_exp_apply_v1(uuid,bigint,text,text,text)', 'execute'),
  format('%s cannot call internal EXP apply', r))
from unnest(array['anon','authenticated','service_role']) r;

-- ---- level derivation boundaries ----
select is(private.world_level_for_exp_v1(0), 1, '0 EXP -> Lv1');
select is(private.world_level_for_exp_v1(99), 1, '99 EXP -> Lv1');
select is(private.world_level_for_exp_v1(100), 2, '100 EXP -> Lv2');
select is(private.world_level_for_exp_v1(299), 2, '299 EXP -> Lv2');
select is(private.world_level_for_exp_v1(300), 3, '300 EXP -> Lv3');
select is(private.world_level_for_exp_v1(599), 3, '599 EXP -> Lv3');
select is(private.world_level_for_exp_v1(600), 4, '600 EXP -> Lv4');
select is(private.world_level_for_exp_v1(8000), 10, 'EXP above v1 cap remains stored and derives current max Lv10');
select throws_ok($$select private.world_level_for_exp_v1(-1)$$,
  '22023', 'INVALID_TOTAL_EXP', 'negative total EXP is invalid');

-- ---- reads do not provision ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a5000000-0000-4000-8000-0000000000a5","is_anonymous":false}';
select is(public.get_my_world_progression_v1(), jsonb_build_object(
  'totalExp',0,'level',1,'currentLevelStartExp',0,'nextLevelExp',100,
  'progressExp',0,'progressRequired',100,'maxDefinedLevel',10,'isMaxLevel',false),
  'fresh permanent account reads 0 EXP / Lv1');
reset role;
select is((select count(*) from private.world_player_progression
  where user_id='a5000000-0000-4000-8000-0000000000a5'), 0::bigint,
  'read does not create a progression row');

-- ---- server grants cross thresholds and write exactly one ledger row each ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',99,'quest','q1','progress:a:q1')->>'expAfter',
  '99', '+99 -> 99');
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',1,'quest','q2','progress:a:q2')->>'levelAfter',
  '2', '+1 crosses Lv2');
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',200,'event','e1','progress:a:e1')->>'levelAfter',
  '3', '+200 reaches Lv3');
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',300,'minigame','m1','progress:a:m1')->>'levelAfter',
  '4', '+300 reaches Lv4');
select is((public.world_progression_get_v1(
  'a5000000-0000-4000-8000-0000000000a5')->>'totalExp')::bigint, 600::bigint,
  'server read sees total EXP 600');
select is((public.world_progression_get_v1(
  'a5000000-0000-4000-8000-0000000000a5')->>'level')::int, 4,
  'server read derives Lv4');
reset role;

select results_eq($$
  select amount, exp_before, exp_after, level_before, level_after, source_type, source_id, idempotency_key
  from private.world_exp_transactions
  where user_id='a5000000-0000-4000-8000-0000000000a5'
  order by exp_before
$$, $$values
  (99::bigint,0::bigint,99::bigint,1,1,'quest'::text,'q1'::text,'progress:a:q1'::text),
  (1,99,100,1,2,'quest','q2','progress:a:q2'),
  (200,100,300,2,3,'event','e1','progress:a:e1'),
  (300,300,600,3,4,'minigame','m1','progress:a:m1')
$$, 'ledger is a gapless EXP chain with historical level transitions');
select is((select version from private.world_player_progression
  where user_id='a5000000-0000-4000-8000-0000000000a5'), 4::bigint,
  'progression version counts applied grants');

-- ---- idempotency ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',99,'quest','q1','progress:a:q1')->>'status',
  'ALREADY_PROCESSED', 'same key replays');
select is(public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',99,'quest','q1','progress:a:q1')->>'expAfter',
  '99', 'replay returns the original transaction result');
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',100,'quest','q1','progress:a:q1')$$,
  '23505','IDEMPOTENCY_CONFLICT','same key with different amount is refused');
select throws_ok($$select public.world_exp_grant_v1(
  'b5000000-0000-4000-8000-0000000000b5',99,'quest','q1','progress:a:q1')$$,
  '23505','IDEMPOTENCY_CONFLICT','same key cannot be reused by another account');
select is((public.world_progression_get_v1(
  'a5000000-0000-4000-8000-0000000000a5')->>'totalExp')::bigint,600::bigint,
  'replay/conflicts move no EXP');
reset role;
select is((select count(*) from private.world_exp_transactions
  where user_id='a5000000-0000-4000-8000-0000000000a5'),4::bigint,
  'replay/conflicts add no ledger rows');
select is((select count(*) from private.world_player_progression
  where user_id='b5000000-0000-4000-8000-0000000000b5'),0::bigint,
  'cross-account key conflict does not provision the other account');

-- ---- input/account validation ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',0,'quest','x','bad:zero')$$,
  '22023','INVALID_AMOUNT','zero EXP is refused');
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',-1,'quest','x','bad:negative')$$,
  '22023','INVALID_AMOUNT','negative EXP is refused');
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',1,'Bad Source','x','bad:source')$$,
  '22023','INVALID_SOURCE','source type is validated');
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',1,'quest','x',null)$$,
  '22023','INVALID_IDEMPOTENCY_KEY','idempotency key is required');
select throws_ok($$select public.world_exp_grant_v1(
  'c5000000-0000-4000-8000-0000000000c5',1,'quest','x','bad:guest')$$,
  '22023','ACCOUNT_UNAVAILABLE','anonymous account receives no EXP');
select throws_ok($$select public.world_exp_grant_v1(
  'd5000000-0000-4000-8000-0000000000d5',1,'quest','x','bad:banned')$$,
  '22023','ACCOUNT_UNAVAILABLE','banned account receives no EXP');
select throws_ok($$select public.world_exp_grant_v1(
  'f5000000-0000-4000-8000-0000000000f5',1,'quest','x','bad:missing')$$,
  '22023','ACCOUNT_UNAVAILABLE','unknown account receives no EXP');
reset role;

-- ---- client surface: own read only, no write/server read ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a5000000-0000-4000-8000-0000000000a5","is_anonymous":false}';
select is(public.get_my_world_progression_v1(), jsonb_build_object(
  'totalExp',600,'level',4,'currentLevelStartExp',600,'nextLevelExp',1000,
  'progressExp',0,'progressRequired',400,'maxDefinedLevel',10,'isMaxLevel',false),
  'player A reads own 600 EXP / Lv4');
select throws_ok($$select public.world_exp_grant_v1(
  'a5000000-0000-4000-8000-0000000000a5',1000,'client','forge','client:forge')$$,
  '42501',null,'player cannot grant EXP');
select throws_ok($$select public.world_progression_get_v1(
  'b5000000-0000-4000-8000-0000000000b5')$$,
  '42501',null,'player cannot use server progression read');
select throws_ok($$select * from private.world_player_progression$$,
  '42501',null,'player cannot read raw progression');
select throws_ok($$select * from private.world_exp_transactions$$,
  '42501',null,'player cannot read raw EXP ledger');
set local request.jwt.claims = '{"role":"authenticated","sub":"b5000000-0000-4000-8000-0000000000b5","is_anonymous":false}';
select is(public.get_my_world_progression_v1()->>'totalExp','0',
  'player B sees only own fresh progression');
set local request.jwt.claims = '{"role":"authenticated","sub":"c5000000-0000-4000-8000-0000000000c5","is_anonymous":true}';
select throws_ok($$select public.get_my_world_progression_v1()$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED','anonymous session cannot read progression');
set local request.jwt.claims = '{"role":"authenticated","sub":"d5000000-0000-4000-8000-0000000000d5","is_anonymous":false}';
select throws_ok($$select public.get_my_world_progression_v1()$$,
  '42501','ACCOUNT_UNAVAILABLE','banned account cannot read progression');
reset role;

-- ---- integrity + immutable config ----
select throws_ok($$update private.world_exp_transactions
  set amount=999 where user_id='a5000000-0000-4000-8000-0000000000a5'$$,
  '42501','LEDGER_APPEND_ONLY','EXP ledger rows are immutable');
select throws_ok($$insert into private.world_exp_transactions(
  user_id,amount,exp_before,exp_after,level_before,level_after,source_type,source_id,idempotency_key)
  values ('a5000000-0000-4000-8000-0000000000a5',5,0,50,1,1,'test','bad','bad:math')$$,
  '23514',null,'ledger math is enforced by the database');
select throws_ok($$update private.world_level_thresholds set min_total_exp=99 where level=2$$,
  '42501','PROGRESSION_CONFIG_IMMUTABLE','published threshold cannot be edited');
select throws_ok($$delete from private.world_level_thresholds where level=10$$,
  '42501','PROGRESSION_CONFIG_IMMUTABLE','published threshold cannot be deleted');
select throws_ok($$insert into private.world_level_thresholds(level,min_total_exp) values (12,6000)$$,
  '23514','PROGRESSION_CONFIG_INVALID','future thresholds must append the next level');
select lives_ok($$insert into private.world_level_thresholds(level,min_total_exp) values (11,5500)$$,
  'next sequential level can be appended');
select is(private.world_level_for_exp_v1(5500),11,'new threshold becomes immediately derivable');
select throws_ok($$update private.world_level_thresholds set min_total_exp=5600 where level=11$$,
  '42501','PROGRESSION_CONFIG_IMMUTABLE','newly appended threshold is immutable too');

-- ---- max-level snapshot preserves overflow EXP ----
insert into private.world_player_progression(user_id,total_exp,version)
values ('e5000000-0000-4000-8000-0000000000e5',8000,0);
select is((private.world_progression_snapshot_v1(
  'e5000000-0000-4000-8000-0000000000e5')->>'totalExp')::bigint,8000::bigint,
  'EXP above the highest threshold is preserved');
select is((private.world_progression_snapshot_v1(
  'e5000000-0000-4000-8000-0000000000e5')->>'level')::int,11,
  'snapshot uses the currently highest defined level after extension');
select is(private.world_progression_snapshot_v1(
  'e5000000-0000-4000-8000-0000000000e5')->>'isMaxLevel','true',
  'highest defined level is reported as max');

-- ---- account deletion cascades projection + ledger ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.world_exp_grant_v1(
  'b5000000-0000-4000-8000-0000000000b5',10,'test','delete','progress:b:delete');
reset role;
delete from auth.users where id='b5000000-0000-4000-8000-0000000000b5';
select is((select count(*) from private.world_player_progression
  where user_id='b5000000-0000-4000-8000-0000000000b5'),0::bigint,
  'account deletion removes progression projection');
select is((select count(*) from private.world_exp_transactions
  where user_id='b5000000-0000-4000-8000-0000000000b5'),0::bigint,
  'account deletion removes EXP ledger');

select * from finish();
rollback;
