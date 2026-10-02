-- INHA WORLD P0 Collection Discovery Authority.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('a8400000-0000-4000-8000-0000000000a8','authenticated','authenticated','collection-a@example.test',now(),false),
 ('b8400000-0000-4000-8000-0000000000b8','authenticated','authenticated','collection-b@example.test',now(),false),
 ('c8400000-0000-4000-8000-0000000000c8','authenticated','authenticated',null,null,true),
 ('d8400000-0000-4000-8000-0000000000d8','authenticated','authenticated','collection-d@example.test',now(),false);
insert into public.profiles(user_id,nickname,is_banned) values
 ('a8400000-0000-4000-8000-0000000000a8','도감A',false),
 ('b8400000-0000-4000-8000-0000000000b8','도감B',false),
 ('c8400000-0000-4000-8000-0000000000c8','도감게스트',false),
 ('d8400000-0000-4000-8000-0000000000d8','도감정지',true);

-- ---- schema / canonical mirror ----
select has_table('private','world_collection_entry_catalog','collection entry mirror exists');
select has_table('private','world_collection_discovery_events','discovery event ledger exists');
select has_table('private','world_player_collection_discoveries','player discovery projection exists');
select col_is_pk('private','world_collection_entry_catalog',array['entry_id'],'entry id is primary key');
select col_is_unique('private','world_collection_discovery_events',array['idempotency_key'],
  'discovery idempotency key is globally unique');
select col_is_pk('private','world_player_collection_discoveries',array['user_id','entry_id'],
  'one discovery projection per account/entry');

select results_eq($$
  select entry_id,category,persistence_mode,owner_domain,owner_ref,status,definition_version
    from private.world_collection_entry_catalog
   order by entry_id
$$,$$values
  ('collection.artifact.campus_fragment_01'::text,'ARTIFACT'::text,'SERVER_PERSISTED'::text,null::text,null::text,'COMING_SOON'::text,1),
  ('collection.fish.carp','FISH','SERVER_PERSISTED',null,null,'COMING_SOON',1),
  ('collection.place.biryong_tower','PLACE','DERIVED_FROM_OWNER','BIRYONG','BR01','ACTIVE',1),
  ('collection.plant.campus_leaf','PLANT','SERVER_PERSISTED',null,null,'COMING_SOON',1)
$$,'DB mirror matches the four P0 code-registry authority rows');

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.world_collection_entry_catalog'::regclass,
  'private.world_collection_discovery_events'::regclass,
  'private.world_player_collection_discoveries'::regclass
)), 'collection discovery tables have RLS');
select ok(not has_table_privilege(r,t,p),format('%s cannot %s %s',r,p,t))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array[
       'private.world_collection_entry_catalog',
       'private.world_collection_discovery_events',
       'private.world_player_collection_discoveries'
     ]) t,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

select ok(not has_function_privilege(r,
  'private.world_collection_discover_v1(uuid,text,text,text,text,text,jsonb)','execute'),
  format('%s cannot call private discovery commit',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,
  'private.world_collection_list_v1(uuid)','execute'),
  format('%s cannot call private collection read',r))
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,
  'public.world_collection_discover_v1(uuid,text,text,text,text,text,jsonb)','execute'),
  format('%s cannot call server discovery adapter',r))
from unnest(array['anon','authenticated']) r;
select ok(not has_function_privilege(r,
  'public.world_collection_list_v1(uuid)','execute'),
  format('%s cannot call server collection read',r))
from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role',
  'public.world_collection_discover_v1(uuid,text,text,text,text,text,jsonb)','execute'),
  'service_role can call verified discovery adapter');
select ok(has_function_privilege('service_role',
  'public.world_collection_list_v1(uuid)','execute'),
  'service_role can read collection projection');

-- ---- write gates: not-live + owner-derived ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$
  select public.world_collection_discover_v1(
    'a8400000-0000-4000-8000-0000000000a8',
    'collection.fish.carp','ACTIVITY','activity.fishing.inkyung',
    'fishing_result:prelive','collection:test:prelive',null)
$$,'P0001','COLLECTION_ENTRY_INACTIVE','COMING_SOON entry cannot be persistently discovered');

select throws_ok($$
  select public.world_collection_discover_v1(
    'a8400000-0000-4000-8000-0000000000a8',
    'collection.place.biryong_tower','SYSTEM','BR01',
    null,'collection:test:biryong',null)
$$,'P0001','COLLECTION_WRITE_NOT_ALLOWED','owner-derived Biryong fact cannot be duplicated');
reset role;

select is((select count(*) from private.world_collection_discovery_events),0::bigint,
  'refused writes create no discovery events');
select is((select count(*) from private.world_player_collection_discoveries),0::bigint,
  'refused writes create no projections');

-- Test activation only; transaction rollback preserves committed COMING_SOON state.
update private.world_collection_entry_catalog
   set status='ACTIVE'
 where entry_id='collection.fish.carp';

-- ---- first discovery / replay ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_collection_discover_v1(
  'a8400000-0000-4000-8000-0000000000a8',
  'collection.fish.carp','ACTIVITY','activity.fishing.inkyung',
  'fishing_result:catch_001','collection:fish:catch_001',
  '{"qualityBand":"COMMON"}'::jsonb)->>'status',
  'DISCOVERED','first verified result creates discovery');

select is(public.world_collection_discover_v1(
  'a8400000-0000-4000-8000-0000000000a8',
  'collection.fish.carp','ACTIVITY','activity.fishing.inkyung',
  'fishing_result:catch_001','collection:fish:catch_001',
  '{"qualityBand":"COMMON"}'::jsonb)->>'status',
  'ALREADY_PROCESSED','same verified result replay is idempotent');

select throws_ok($$
  select public.world_collection_discover_v1(
    'a8400000-0000-4000-8000-0000000000a8',
    'collection.fish.carp','ACTIVITY','activity.fishing.inkyung.spoof',
    'fishing_result:catch_001','collection:fish:catch_001',
    '{"qualityBand":"COMMON"}'::jsonb)
$$,'23505','IDEMPOTENCY_CONFLICT','same discovery key cannot change source identity');
reset role;

select is((select count(*) from private.world_collection_discovery_events
  where idempotency_key='collection:fish:catch_001'),1::bigint,
  'replay creates one event');
select results_eq($$
  select discovery_count,version,first_source_type,first_source_ref,first_result_ref
    from private.world_player_collection_discoveries
   where user_id='a8400000-0000-4000-8000-0000000000a8'
     and entry_id='collection.fish.carp'
$$,$$values (1::bigint,1::bigint,'ACTIVITY'::text,'activity.fishing.inkyung'::text,'fishing_result:catch_001'::text)$$,
  'first projection stores immutable first provenance');

select set_config('test.collection_first_time',(
  select first_discovered_at::text
    from private.world_player_collection_discoveries
   where user_id='a8400000-0000-4000-8000-0000000000a8'
     and entry_id='collection.fish.carp'
),true);

-- ---- rediscovery increments count but preserves first provenance ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.world_collection_discover_v1(
  'a8400000-0000-4000-8000-0000000000a8',
  'collection.fish.carp','ACTIVITY','activity.fishing.inkyung',
  'fishing_result:catch_002','collection:fish:catch_002',
  '{"qualityBand":"UNCOMMON"}'::jsonb)->>'status',
  'REDISCOVERED','new verified result increments existing discovery');
reset role;

select results_eq($$
  select discovery_count,version,first_source_type,first_source_ref,first_result_ref,
         first_discovered_at::text=current_setting('test.collection_first_time')
    from private.world_player_collection_discoveries
   where user_id='a8400000-0000-4000-8000-0000000000a8'
     and entry_id='collection.fish.carp'
$$,$$values (2::bigint,2::bigint,'ACTIVITY'::text,'activity.fishing.inkyung'::text,
             'fishing_result:catch_001'::text,true)$$,
  'rediscovery preserves first provenance and increments count/version');
select is((select count(*) from private.world_collection_discovery_events
  where user_id='a8400000-0000-4000-8000-0000000000a8'
    and entry_id='collection.fish.carp'),2::bigint,
  'two verified results produce two append-only events');

-- ---- read model keeps DERIVED distinct from UNKNOWN ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select results_eq($$
  select
    x->>'entryId',
    x->>'persistenceMode',
    x->>'discoveryState',
    x->>'discovered'
  from jsonb_array_elements(
    public.world_collection_list_v1('a8400000-0000-4000-8000-0000000000a8')->'entries'
  ) x
  order by 1
$$,$$values
  ('collection.artifact.campus_fragment_01'::text,'SERVER_PERSISTED'::text,'UNKNOWN'::text,'false'::text),
  ('collection.fish.carp','SERVER_PERSISTED','DISCOVERED','true'),
  ('collection.place.biryong_tower','DERIVED_FROM_OWNER','OWNER_DERIVED',null::text),
  ('collection.plant.campus_leaf','SERVER_PERSISTED','UNKNOWN','false')
$$,'server read distinguishes persisted unknown/discovered from owner-derived');

select is((
  select x->>'discoveryState'
    from jsonb_array_elements(
      public.world_collection_list_v1('b8400000-0000-4000-8000-0000000000b8')->'entries'
    ) x
   where x->>'entryId'='collection.fish.carp'
),'UNKNOWN','another account does not inherit discovery');
reset role;

-- ---- append-only / projection guards ----
select throws_ok($$
  update private.world_collection_discovery_events
     set source_ref='changed'
   where idempotency_key='collection:fish:catch_001'
$$,'42501','COLLECTION_DISCOVERY_EVENT_APPEND_ONLY','discovery event cannot be rewritten');

select throws_ok($$
  update private.world_player_collection_discoveries
     set first_source_ref='changed',
         discovery_count=discovery_count+1,
         version=version+1,
         last_discovered_at=now(),
         updated_at=now()
   where user_id='a8400000-0000-4000-8000-0000000000a8'
     and entry_id='collection.fish.carp'
$$,'42501','COLLECTION_FIRST_PROVENANCE_IMMUTABLE','first provenance cannot be rewritten');

select throws_ok($$
  update private.world_player_collection_discoveries
     set discovery_count=discovery_count+2,
         version=version+1,
         last_discovered_at=now(),
         updated_at=now()
   where user_id='a8400000-0000-4000-8000-0000000000a8'
     and entry_id='collection.fish.carp'
$$,'23514','COLLECTION_PROJECTION_INVALID','projection count/version advance by one verified event');

-- ---- invalid accounts ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$
  select public.world_collection_discover_v1(
    'c8400000-0000-4000-8000-0000000000c8',
    'collection.fish.carp','SYSTEM','test',null,'collection:guest:001',null)
$$,'22023','ACCOUNT_UNAVAILABLE','guest has no persistent Collection Discovery');
select throws_ok($$
  select public.world_collection_discover_v1(
    'd8400000-0000-4000-8000-0000000000d8',
    'collection.fish.carp','SYSTEM','test',null,'collection:banned:001',null)
$$,'22023','ACCOUNT_UNAVAILABLE','banned account has no persistent Collection Discovery');
reset role;

-- ---- account lifecycle: player state is deleted, catalog survives ----
delete from auth.users where id='a8400000-0000-4000-8000-0000000000a8';
select is((select count(*) from private.world_collection_discovery_events
  where user_id='a8400000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes discovery events');
select is((select count(*) from private.world_player_collection_discoveries
  where user_id='a8400000-0000-4000-8000-0000000000a8'),0::bigint,
  'account deletion removes discovery projection');
select is((select count(*) from private.world_collection_entry_catalog),4::bigint,
  'account deletion never removes the Collection Entry catalog');

select * from finish();
rollback;
