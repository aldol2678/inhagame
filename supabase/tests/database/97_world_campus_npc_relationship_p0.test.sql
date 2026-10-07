-- INHA WORLD Campus NPC Relationship Authority P0.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('ca100000-0000-4000-8000-0000000000a1','authenticated','authenticated','campus-rel-a@example.test',now(),false),
 ('ca200000-0000-4000-8000-0000000000b2','authenticated','authenticated','campus-rel-b@example.test',now(),false),
 ('ca300000-0000-4000-8000-0000000000c3','authenticated','authenticated','campus-rel-c@example.test',now(),true);
insert into public.profiles(user_id,nickname,is_banned) values
 ('ca100000-0000-4000-8000-0000000000a1','관계A',false),
 ('ca200000-0000-4000-8000-0000000000b2','관계B',false),
 ('ca300000-0000-4000-8000-0000000000c3','관계C',false);

select is((select count(*) from private.world_campus_npc_relationship_npc_catalog where status='ACTIVE'),10::bigint,
  'P0 catalog has exactly ten active HERO NPCs');
select set_eq(
  $$select npc_id from private.world_campus_npc_relationship_npc_catalog order by npc_id$$,
  array['INKYUNG-NPC-001','INKYUNG-NPC-002','INKYUNG-NPC-005','INKYUNG-NPC-008','INKYUNG-NPC-012',
        'INKYUNG-NPC-016','INKYUNG-NPC-029','INKYUNG-NPC-034','INKYUNG-NPC-042','INKYUNG-NPC-046'],
  'catalog identity is stable npc_id only');

select is(private.world_campus_npc_relationship_tier_v1(0),'STRANGER','0 = STRANGER');
select is(private.world_campus_npc_relationship_tier_v1(10),'FAMILIAR','10 = FAMILIAR');
select is(private.world_campus_npc_relationship_tier_v1(25),'FRIENDLY','25 = FRIENDLY');
select is(private.world_campus_npc_relationship_tier_v1(45),'FRIEND','45 = FRIEND');
select is(private.world_campus_npc_relationship_tier_v1(70),'TRUSTED','70 = TRUSTED');

select ok(has_function_privilege('authenticated','public.get_my_world_campus_npc_relationship_v1(text)','execute'),
  'authenticated may read one own campus NPC relationship');
select ok(has_function_privilege('authenticated','public.get_my_world_campus_npc_relationships_v1()','execute'),
  'authenticated may read own campus NPC relationships');
select ok(not has_function_privilege('authenticated',
  'public.world_campus_npc_relationship_apply_v1(uuid,text,integer,text,text,integer,smallint,text,text,text)','execute'),
  'browser cannot mutate campus NPC relationship');
select ok(has_function_privilege('service_role',
  'public.world_campus_npc_relationship_apply_v1(uuid,text,integer,text,text,integer,smallint,text,text,text)','execute'),
  'service role owns verified campus NPC relationship apply surface');
select ok(not has_table_privilege('authenticated','private.world_player_campus_npc_relationships','select'),
  'browser has no direct private projection access');

set local role authenticated;
set local request.jwt.claims='{"sub":"ca100000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is(public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'tier','STRANGER',
  'missing row reads as STRANGER');
select is((public.get_my_world_campus_npc_relationships_v1()->'relationships'->0->>'affinity')::int,0,
  'list read starts at zero affinity');
reset role;

set local role service_role;
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'FIRST_MEETING',null,1,2::smallint,'DIALOGUE','npc:first_meeting:001','campus-rel:a:first')->>'status',
  'APPLIED','verified first meeting applies once');
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'FIRST_MEETING',null,1,2::smallint,'DIALOGUE','npc:first_meeting:001','campus-rel:a:first')->>'status',
  'ALREADY_PROCESSED','same idempotency key replays safely');
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'FIRST_MEETING',null,1,2::smallint,'DIALOGUE','npc:first_meeting:001b','campus-rel:a:first-2')->>'status',
  'ALREADY_MET','a second first-meeting event cannot farm affinity');
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'MEANINGFUL_DIALOGUE','CAMPUS_DISCOVERY',1,1::smallint,'DIALOGUE','npc:dialogue:001:1','campus-rel:a:talk-1')->>'status',
  'APPLIED','meaningful dialogue applies');
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'PERSONAL_QUEST_COMPLETE','CAMPUS_DISCOVERY',1,8::smallint,'QUEST','quest:nayul:memory','campus-rel:a:quest-1')->>'status',
  'APPLIED','verified personal quest can advance affinity');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"ca100000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'affinity')::int,11,
  '2 + 1 + 8 = 11 affinity');
select is(public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'tier','FAMILIAR',
  'server derives FAMILIAR after threshold crossing');
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'encounterCount')::int,1,
  'first meeting increments encounter count once');
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'meaningfulInteractionCount')::int,2,
  'meaningful dialogue and quest increment meaningful count');
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'revision')::int,3,
  'only applied relationship events advance revision');
reset role;

select is((select count(*) from private.world_campus_npc_relationship_events
  where user_id='ca100000-0000-4000-8000-0000000000a1' and npc_id='INKYUNG-NPC-001'),3::bigint,
  'ledger contains exactly the three applied events');
select is((select applied_delta from private.world_campus_npc_relationship_events
  where idempotency_key='campus-rel:a:quest-1'),8::smallint,
  'ledger records applied delta');

set local role service_role;
select is(public.world_campus_npc_relationship_apply_v1(
  'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
  'NEGATIVE_CHOICE',null,1,-5::smallint,'WORLD','choice:nayul:negative','campus-rel:a:negative')->>'status',
  'APPLIED','negative verified choice can reduce affinity');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"ca100000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'affinity')::int,6,
  'negative choice updates server affinity');
select is(public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'tier','STRANGER',
  'tier may move downward when affinity crosses a boundary');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"ca200000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is((public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')->>'affinity')::int,0,
  'relationship state is account scoped');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"ca300000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.get_my_world_campus_npc_relationship_v1('INKYUNG-NPC-001')$$,
  '22023','ACCOUNT_UNAVAILABLE','anonymous account cannot read persistent relationship state');
reset role;

select throws_ok(
  $$select private.world_campus_npc_relationship_apply_v1(
    'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',2,
    'REUNION',null,1,1::smallint,'WORLD','bad:version','campus-rel:bad:version')$$,
  '22023','RELATIONSHIP_DEFINITION_VERSION_MISMATCH','stale rule definition is rejected');
select throws_ok(
  $$select private.world_campus_npc_relationship_apply_v1(
    'ca100000-0000-4000-8000-0000000000a1','INKYUNG-NPC-001',1,
    'REPEAT_DIALOGUE',null,1,1::smallint,'DIALOGUE','spam','campus-rel:bad:spam')$$,
  '22023','INVALID_CAMPUS_NPC_RELATIONSHIP_EVENT','repeat dialogue is never persisted');

select throws_ok(
  $$update private.world_campus_npc_relationship_events set source_ref='tampered'
    where user_id='ca100000-0000-4000-8000-0000000000a1'$$,
  '42501','CAMPUS_NPC_RELATIONSHIP_EVENT_APPEND_ONLY','relationship ledger is append-only for live accounts');
select throws_ok(
  $$update private.world_player_campus_npc_relationships
       set affinity=7
     where user_id='ca100000-0000-4000-8000-0000000000a1' and npc_id='INKYUNG-NPC-001'$$,
  '23514','CAMPUS_NPC_RELATIONSHIP_PROJECTION_INVALID','projection cannot be directly nudged around the primitive');

select * from finish();
rollback;
