-- INHA WORLD Biryong NPC Relationship Authority P0.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a9700000-0000-4000-8000-0000000000a9','authenticated','authenticated','biryong-rel-a@example.test',now(),false),
 ('b9700000-0000-4000-8000-0000000000b9','authenticated','authenticated','biryong-rel-b@example.test',now(),false),
 ('c9700000-0000-4000-8000-0000000000c9','authenticated','authenticated','biryong-rel-c@example.test',now(),true);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a9700000-0000-4000-8000-0000000000a9','관계A',false),
 ('b9700000-0000-4000-8000-0000000000b9','관계B',false),
 ('c9700000-0000-4000-8000-0000000000c9','익명C',false);

insert into private.world_biryong_npc_relationship_fact_catalog(
  fact_id,npc_id,unlock_stage,topic_id,topic_label,fact_text,dialogue_line,generative_safe,status,definition_version)
values
 ('biryong.relationship.br_npc_001.s2.test_secret','BR_NPC_001',2,'trust_test','신뢰 테스트',
  'Stage 2 테스트 사실','Stage 2 테스트 대사',false,'ACTIVE',1),
 ('biryong.relationship.br_npc_001.s3.test_secret','BR_NPC_001',3,'responsibility_test','책임 테스트',
  'Stage 3 테스트 사실','Stage 3 테스트 대사',false,'ACTIVE',1);

select is(
  (private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->>'stage')::int,
  1,'fresh permanent account begins at implicit Stage 1');

select is(
  jsonb_array_length(private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->'unlockedFacts'),
  0,'Stage 1 receives no Stage 2/3 private facts');

select throws_ok($$
  select private.world_biryong_relationship_advance_v1(
    'b9700000-0000-4000-8000-0000000000b9','BR_NPC_001',3::smallint,
    'QUEST','quest.test.stage3','quest-result:b:3','relationship:b:3')
$$,'P0001','RELATIONSHIP_STAGE_STEP_REQUIRED',
  'a fresh account cannot jump directly from Stage 1 to Stage 3');

select is(
  private.world_biryong_relationship_advance_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001',2::smallint,
    'QUEST','quest.test.stage2','quest-result:a:2','relationship:a:2')->>'status',
  'ADVANCED','verified quest evidence advances Stage 1 to Stage 2');

select is(
  (private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->>'stage')::int,
  2,'Stage 2 projection persists');

select is(
  jsonb_array_length(private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->'unlockedFacts'),
  1,'Stage 2 receives only Stage 2 fact payload');

select is(
  private.world_biryong_relationship_advance_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001',2::smallint,
    'QUEST','quest.test.stage2','quest-result:a:2','relationship:a:2')->>'status',
  'ALREADY_PROCESSED','same advancement idempotency key replays safely');

select throws_ok($$
  select private.world_biryong_relationship_advance_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_002',2::smallint,
    'QUEST','quest.test.stage2',null,'relationship:a:missing-result')
$$,'22023','RELATIONSHIP_RESULT_REF_REQUIRED',
  'QUEST advancement requires a verified result reference');

select is(
  private.world_biryong_relationship_advance_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001',3::smallint,
    'EVENT','event.test.stage3','event-result:a:3','relationship:a:3')->>'status',
  'ADVANCED','verified event evidence advances Stage 2 to Stage 3');

select is(
  (private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->>'stage')::int,
  3,'Stage 3 projection persists');

select is(
  jsonb_array_length(private.world_biryong_relationship_snapshot_v1(
    'a9700000-0000-4000-8000-0000000000a9','BR_NPC_001')->'unlockedFacts'),
  2,'Stage 3 receives Stage 2 and Stage 3 fact payloads');

select is(
  (private.world_biryong_relationship_snapshot_v1(
    'b9700000-0000-4000-8000-0000000000b9','BR_NPC_001')->>'stage')::int,
  1,'another account cannot borrow relationship progress');

select throws_ok($$
  select private.world_biryong_relationship_snapshot_v1(
    'c9700000-0000-4000-8000-0000000000c9','BR_NPC_001')
$$,'22023','ACCOUNT_UNAVAILABLE',
  'anonymous Auth accounts cannot read persistent Biryong relationships');

select throws_ok($$
  update private.world_biryong_npc_relationship_events
     set source_ref='tampered'
   where user_id='a9700000-0000-4000-8000-0000000000a9'
$$,'42501','BIRYONG_RELATIONSHIP_EVENT_APPEND_ONLY',
  'advancement provenance is append-only');

select throws_ok($$
  update private.world_player_biryong_npc_relationships
     set stage=2, revision=revision+1, updated_at=now()
   where user_id='a9700000-0000-4000-8000-0000000000a9'
     and npc_id='BR_NPC_001'
$$,'23514','BIRYONG_RELATIONSHIP_PROJECTION_INVALID',
  'projection cannot be manually moved backwards or outside one-step semantics');

select ok(
  has_function_privilege('authenticated','public.get_my_biryong_npc_relationship_v1(text)','EXECUTE'),
  'authenticated may read one own relationship');
select ok(
  has_function_privilege('authenticated','public.get_my_biryong_npc_relationships_v1()','EXECUTE'),
  'authenticated may read own relationship list');
select ok(
  not has_function_privilege('anon','public.get_my_biryong_npc_relationships_v1()','EXECUTE'),
  'anon role cannot read persistent relationships');
select ok(
  not has_function_privilege(
    'authenticated',
    'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)',
    'EXECUTE'),
  'authenticated browser cannot advance relationship stage');
select ok(
  has_function_privilege(
    'service_role',
    'public.world_biryong_npc_relationship_advance_v1(uuid,text,smallint,text,text,text,text)',
    'EXECUTE'),
  'service role alone receives public advancement RPC access');
select ok(
  not has_table_privilege(
    'authenticated','private.world_player_biryong_npc_relationships','SELECT'),
  'browser receives no direct private relationship table access');
select ok(
  not has_table_privilege(
    'service_role','private.world_biryong_npc_relationship_fact_catalog','SELECT'),
  'even service role has no direct private fact-table grant; definer functions own access');

select * from finish();
rollback;
