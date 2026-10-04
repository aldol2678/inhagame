-- INHA WORLD Duck Companion P1 vertical slice.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9600000-0000-4000-8000-0000000000a9','authenticated','authenticated','duck-a@example.test',now(),false),
 ('b9600000-0000-4000-8000-0000000000b9','authenticated','authenticated','duck-b@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9600000-0000-4000-8000-0000000000a9','오리A',false),
 ('b9600000-0000-4000-8000-0000000000b9','오리B',false);

select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'state'),'UNSEEN',
  'fresh account starts UNSEEN');

select throws_ok($$
  select private.world_duck_companion_bond_v1(
    'a9600000-0000-4000-8000-0000000000a9','duck-claim:a:early')
$$,'P0001','DUCK_BOND_OBSERVATION_REQUIRED',
  'bond is refused before verified observations');

select is(private.world_inkyung_duck_observe_v1(
  'a9600000-0000-4000-8000-0000000000a9',
  'inkyung_duck_white_01','duck-observation:a:01','duck-observe:a:01')->>'status',
  'SUCCESS','first verified ordinary duck observation succeeds');
select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'state'),'SIGHTED',
  'one distinct duck makes SIGHTED');

select is(private.world_inkyung_duck_observe_v1(
  'a9600000-0000-4000-8000-0000000000a9',
  'inkyung_duck_white_01','duck-observation:a:01b','duck-observe:a:01b')->>'status',
  'SUCCESS','a second verified event for the same duck may be recorded');
select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'observationCount')::int,1,
  'same duck does not inflate distinct observation progress');

select is(private.world_inkyung_duck_observe_v1(
  'a9600000-0000-4000-8000-0000000000a9',
  'inkyung_duck_white_02','duck-observation:a:02','duck-observe:a:02')->>'status',
  'SUCCESS','second distinct duck observation succeeds');
select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'state'),'OBSERVED',
  'two distinct ducks make OBSERVED');

select is(private.world_inkyung_duck_observe_v1(
  'a9600000-0000-4000-8000-0000000000a9',
  'inkyung_duck_mallard_01','duck-observation:a:03','duck-observe:a:03')->>'status',
  'SUCCESS','third distinct duck observation succeeds');
select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'state'),'BOND_ELIGIBLE',
  'three distinct ducks make BOND_ELIGIBLE');

select throws_ok($$
  select private.world_inkyung_duck_observe_v1(
    'a9600000-0000-4000-8000-0000000000a9',
    'inkyung_duck_mechanical_01','duck-observation:a:mechanical','duck-observe:a:mechanical')
$$,'P0001','INKYUNG_DUCK_NOT_OBSERVABLE',
  'mechanical duck is not ordinary companion observation credit');

select is(private.world_duck_companion_bond_v1(
  'a9600000-0000-4000-8000-0000000000a9','duck-claim:a:001')->>'status',
  'SUCCESS','eligible account bonds duck.base');

select is((select count(*) from private.world_player_creatures
  where user_id='a9600000-0000-4000-8000-0000000000a9'
    and species_id='creature.species.duck'
    and current_form_id='creature.form.duck.base'
    and bond_entitled=true),1::bigint,
  'bond creates exactly one entitled duck.base');

select is((private.world_duck_companion_status_v1(
  'a9600000-0000-4000-8000-0000000000a9')->>'state'),'OWNED',
  'bonded account reads OWNED');

select is((select count(*) from private.world_creature_party_state
  where user_id='a9600000-0000-4000-8000-0000000000a9'
    and active_creature_id is not null),1::bigint,
  'first Creature auto-occupies ACTIVE slot');

select is((private.world_duck_companion_bond_v1(
  'a9600000-0000-4000-8000-0000000000a9','duck-claim:a:001')->>'status'),
  'ALREADY_PROCESSED','same bond key replays safely');
select is((private.world_duck_companion_bond_v1(
  'a9600000-0000-4000-8000-0000000000a9','duck-claim:a:another')->>'status'),
  'ALREADY_PROCESSED','different retry key cannot create a second companion');
select is((select count(*) from private.world_creature_acquisition_claims
  where user_id='a9600000-0000-4000-8000-0000000000a9'),1::bigint,
  'one account/rule has exactly one acquisition claim');

select throws_ok($$
  select private.world_duck_companion_bond_v1(
    'b9600000-0000-4000-8000-0000000000b9','duck-claim:b:early')
$$,'P0001','DUCK_BOND_OBSERVATION_REQUIRED',
  'another account cannot borrow observation progress');

select throws_ok($$
  select private.world_inkyung_duck_observe_v1(
    'b9600000-0000-4000-8000-0000000000b9',
    'not_a_duck','duck-observation:b:bad','duck-observe:b:bad')
$$,'22023','INVALID_INKYUNG_DUCK_ID',
  'invalid duck subject id is refused');

select * from finish();
rollback;