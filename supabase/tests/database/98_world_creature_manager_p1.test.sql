-- INHA WORLD Creature Manager P1 · self-only snapshot + revisioned party mutation.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9800000-0000-4000-8000-0000000000a9','authenticated','authenticated','creature-manager-a@example.test',now(),false),
 ('b9800000-0000-4000-8000-0000000000b9','authenticated','authenticated','creature-manager-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9800000-0000-4000-8000-0000000000a9','동료A',false),
 ('b9800000-0000-4000-8000-0000000000b9','동료B',false);

create temp table creature_manager_ids(label text primary key, id uuid);
grant select on creature_manager_ids to authenticated;

insert into creature_manager_ids
select 'a1',(private.world_creature_grant_v1(
  'a9800000-0000-4000-8000-0000000000a9',
  'creature.species.duck','creature.form.duck.base',
  'creature.test.manager','manager:a:1')->'creature'->>'creatureId')::uuid;
insert into creature_manager_ids
select 'a2',(private.world_creature_grant_v1(
  'a9800000-0000-4000-8000-0000000000a9',
  'creature.species.duck','creature.form.duck.base',
  'creature.test.manager','manager:a:2')->'creature'->>'creatureId')::uuid;
insert into creature_manager_ids
select 'b1',(private.world_creature_grant_v1(
  'b9800000-0000-4000-8000-0000000000b9',
  'creature.species.duck','creature.form.duck.base',
  'creature.test.manager','manager:b:1')->'creature'->>'creatureId')::uuid;

select is(
  private.world_creature_party_set_v1(
    'a9800000-0000-4000-8000-0000000000a9',
    (select id from creature_manager_ids where label='a1'),
    (select id from creature_manager_ids where label='a2'),
    null,0,'manager-party:a:seed')->>'status',
  'SUCCESS','seed account A party');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9800000-0000-4000-8000-0000000000a9","role":"authenticated","is_anonymous":false}';

select is(
  jsonb_array_length(public.get_my_creature_core_v1()->'creatures'),
  2,'self snapshot returns only caller-owned Creatures');
select is(
  public.get_my_creature_core_v1()->'party'->>'activeCreatureId',
  (select id::text from creature_manager_ids where label='a1'),
  'self snapshot exposes server ACTIVE slot');

select is(
  public.set_my_creature_party_v1(
    (select id from creature_manager_ids where label='a2'),
    (select id from creature_manager_ids where label='a1'),
    null,1,'manager-party:a:swap')->'status',
  'SUCCESS','owner can revision-safely swap owned ACTIVE and Reserve');
select is(
  public.get_my_creature_core_v1()->'party'->>'activeCreatureId',
  (select id::text from creature_manager_ids where label='a2'),
  'swapped ACTIVE persists through self read');

select throws_ok(
  format(
    'select public.set_my_creature_party_v1(%L::uuid,null,null,2,%L)',
    (select id::text from creature_manager_ids where label='b1'),
    'manager-party:a:foreign'
  ),
  '42501','CREATURE_NOT_OWNED',
  'caller cannot activate another account Creature');

select throws_ok(
  format(
    'select public.set_my_creature_party_v1(%L::uuid,%L::uuid,null,1,%L)',
    (select id::text from creature_manager_ids where label='a2'),
    (select id::text from creature_manager_ids where label='a1'),
    'manager-party:a:stale'
  ),
  '40001','CREATURE_PARTY_REVISION_CONFLICT',
  'stale expected revision is refused');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b9800000-0000-4000-8000-0000000000b9","role":"authenticated","is_anonymous":false}';
select is(
  jsonb_array_length(public.get_my_creature_core_v1()->'creatures'),
  1,'another account sees only its own Creature');

reset role;
select ok(
  has_function_privilege('authenticated','public.get_my_creature_core_v1()','EXECUTE'),
  'authenticated may read own Creature Core snapshot');
select ok(
  has_function_privilege('authenticated','public.set_my_creature_party_v1(uuid,uuid,uuid,bigint,text)','EXECUTE'),
  'authenticated may request own revisioned party mutation');
select ok(
  not has_function_privilege('anon','public.get_my_creature_core_v1()','EXECUTE'),
  'anon cannot read persistent Creature Core');
select ok(
  not has_function_privilege('anon','public.set_my_creature_party_v1(uuid,uuid,uuid,bigint,text)','EXECUTE'),
  'anon cannot mutate Creature party');
select ok(
  not has_table_privilege('authenticated','private.world_player_creatures','SELECT'),
  'browser still has no direct Creature ownership table access');

select * from finish();
rollback;
