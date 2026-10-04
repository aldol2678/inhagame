begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9800000-0000-4000-8000-0000000000a9','authenticated','authenticated','combat-p4-a@example.test',now(),false),
 ('b9800000-0000-4000-8000-0000000000b9','authenticated','authenticated','combat-p4-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9800000-0000-4000-8000-0000000000a9','전투P4A',false),
 ('b9800000-0000-4000-8000-0000000000b9','전투P4B',false);

select results_eq($$
  select combat_id,category,availability,status,definition_version,outcome_schema_version
    from private.world_combat_definition_catalog
   where combat_id='combat.building5.training_drone'
$$,$$values ('combat.building5.training_drone'::text,'TRAINING'::text,'ACTIVE'::text,'ACTIVE'::text,1,1)$$,
'Building 5 is the first ACTIVE Combat definition');

select results_eq($$
  select d.reward_id,d.status,d.version,g.grant_type,g.target_id,g.amount
    from private.world_reward_definitions d
    join private.world_reward_grants g using(reward_id)
   where d.reward_id='reward.combat.building5_training_first_clear'
$$,$$values ('reward.combat.building5_training_first_clear'::text,'ACTIVE'::text,1,'EXP'::text,'exp.campus'::text,50::bigint)$$,
'Building 5 first-clear reward is fixed at 50 Campus EXP');

select is(
  pg_get_function_identity_arguments('public.world_combat_building5_action_v1'::regproc),
  'p_user uuid, p_encounter_id uuid, p_action text, p_action_key uuid',
  'Combat action API accepts no client HP/damage/BREAK/result/reward fields');

select ok(not has_function_privilege('authenticated',
  'public.world_combat_building5_start_v1(uuid,uuid)','execute'),
  'authenticated cannot call Building 5 start RPC');
select ok(not has_function_privilege('authenticated',
  'public.world_combat_building5_action_v1(uuid,uuid,text,uuid)','execute'),
  'authenticated cannot call Building 5 action RPC');
select ok(not has_function_privilege('authenticated',
  'public.world_combat_building5_snapshot_v1(uuid,uuid)','execute'),
  'authenticated cannot call Building 5 snapshot RPC');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a9800000-0000-4000-8000-0000000000a9","role":"authenticated","is_anonymous":false}';
select throws_ok($$
  select public.world_combat_building5_start_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    'a9800000-0000-4000-8000-000000000001')
$$,'42501','SERVER_ONLY','browser role cannot bypass the Edge gateway');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

create temp table p4_ids(name text primary key, encounter_id uuid, start_key uuid);
insert into p4_ids(name,start_key) values
 ('first','a9800000-0000-4000-8000-000000000001'),
 ('second','a9800000-0000-4000-8000-000000000002');

update p4_ids set encounter_id = (
  public.world_combat_building5_start_v1(
    'a9800000-0000-4000-8000-0000000000a9',start_key)
  ->'encounter'->>'encounterId')::uuid
where name='first';

select is(
  (public.world_combat_building5_start_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    'a9800000-0000-4000-8000-000000000001')
    ->'encounter'->>'encounterId')::uuid,
  (select encounter_id from p4_ids where name='first'),
  'start key replays the same encounter');

select results_eq($$
  select status,state_payload#>>'{player,hp}',state_payload#>>'{enemy,hp}'
    from private.world_combat_encounters
   where encounter_id=(select encounter_id from p4_ids where name='first')
$$,$$values ('ACTIVE'::text,'1000'::text,'4200'::text)$$,
'server creates the canonical initial state');

select lives_ok($
  select public.world_combat_building5_action_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    (select encounter_id from p4_ids where name='first'),
    'BASIC','a9800000-0000-4000-8000-000000000101')
$,'first Basic is server-resolved');

select is(
  (select (state_payload#>>'{enemy,hp}')::integer from private.world_combat_encounters
    where encounter_id=(select encounter_id from p4_ids where name='first')),
  4112,'server resolves Basic as 88 damage');

select lives_ok($
  select public.world_combat_building5_action_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    (select encounter_id from p4_ids where name='first'),
    'BASIC','a9800000-0000-4000-8000-000000000101')
$,'same action key replays stored response');

select throws_ok($
  select public.world_combat_building5_action_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    (select encounter_id from p4_ids where name='first'),
    'ACTIVE_1','a9800000-0000-4000-8000-000000000101')
$,'23505','IDEMPOTENCY_CONFLICT',
'same encounter/action key cannot change action identity');

select is(
  (select (state_payload#>>'{enemy,hp}')::integer from private.world_combat_encounters
    where encounter_id=(select encounter_id from p4_ids where name='first')),
  4112,'same action key cannot deal damage twice');
select is(
  (select count(*)::integer from private.world_combat_action_receipts
    where encounter_id=(select encounter_id from p4_ids where name='first')
      and action_key='a9800000-0000-4000-8000-000000000101'),
  1,'action receipt is unique per encounter/key');

create function pg_temp.clear_building5(p_user uuid,p_encounter uuid)
returns jsonb language plpgsql as $$
declare
  v jsonb;
  i integer;
begin
  for i in 1..80 loop
    v := public.world_combat_building5_action_v1(
      p_user,p_encounter,'BASIC',gen_random_uuid());
    exit when v->'encounter'->>'status' <> 'ACTIVE';
  end loop;
  return v;
end
$$;

select is(
  pg_temp.clear_building5(
    'a9800000-0000-4000-8000-0000000000a9',
    (select encounter_id from p4_ids where name='first'))
    ->'encounter'->>'status',
  'SUCCEEDED','server resolver decides victory');

select like(
  (select result_ref from private.world_combat_encounters
    where encounter_id=(select encounter_id from p4_ids where name='first')),
  'combat-result:%','server mints result_ref');

select results_eq($$
  select reward_status,reward_id
    from private.world_combat_settlements
   where encounter_id=(select encounter_id from p4_ids where name='first')
$$,$$values ('SUCCESS'::text,'reward.combat.building5_training_first_clear'::text)$$,
'verified result settles the first-clear reward');

select results_eq($$
  select total_exp,level
    from private.world_player_progression
   where user_id='a9800000-0000-4000-8000-0000000000a9'
$$,$$values (50::bigint,1)$$,
'first clear grants exactly 50 Campus EXP');

select results_eq($$
  select source_type,source_id,status
    from private.world_reward_transactions
   where user_id='a9800000-0000-4000-8000-0000000000a9'
     and reward_id='reward.combat.building5_training_first_clear'
$$,$$values ('COMBAT'::text,'combat.building5.training_drone'::text,'SUCCESS'::text)$$,
'Reward ledger records verified COMBAT provenance');

update p4_ids set encounter_id = (
  public.world_combat_building5_start_v1(
    'a9800000-0000-4000-8000-0000000000a9',start_key)
  ->'encounter'->>'encounterId')::uuid
where name='second';

select is(
  pg_temp.clear_building5(
    'a9800000-0000-4000-8000-0000000000a9',
    (select encounter_id from p4_ids where name='second'))
    ->'encounter'->>'status',
  'SUCCEEDED','repeat training can still be cleared');

select is(
  (select reward_status from private.world_combat_settlements
    where encounter_id=(select encounter_id from p4_ids where name='second')),
  'INELIGIBLE_REPEAT','repeat clear is not reward-eligible');

select is(
  (select total_exp from private.world_player_progression
    where user_id='a9800000-0000-4000-8000-0000000000a9'),
  50::bigint,'repeat clear cannot farm Campus EXP');

select is(
  (select count(*)::integer from private.world_reward_transactions
    where user_id='a9800000-0000-4000-8000-0000000000a9'
      and reward_id='reward.combat.building5_training_first_clear'),
  1,'first-clear reward transaction exists exactly once');

select is(
  (select count(*)::integer from private.world_currency_transactions
    where user_id='a9800000-0000-4000-8000-0000000000a9'),
  0,'Combat first clear grants no currency');
select is(
  (select count(*)::integer from private.world_item_grants
    where user_id='a9800000-0000-4000-8000-0000000000a9'),
  0,'Combat first clear grants no item');

select * from finish();
rollback;
