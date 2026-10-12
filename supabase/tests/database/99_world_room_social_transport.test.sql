-- Disposable local Supabase only. Use the real partitioned provider table/publisher and RLS.
-- Everything, including the temporary feature activation and fixture policies, is rolled back.
-- This does not prove WebSocket delivery or the provider's documented three-day cleanup SLA.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select ok(not (select enabled from private.world_room_chat_config where singleton), 'transport fixture starts CLOSED');
select is((select relkind::text from pg_class where oid='realtime.messages'::regclass), 'p',
  'transport test requires the real partitioned provider table, never a stand-in');
select ok(not has_function_privilege(r, 'realtime.send(jsonb,text,text,boolean)', 'execute'),
  r || ' cannot invoke trusted provider publisher') from unnest(array['anon','authenticated']) r;
select is_empty($$select column_name from information_schema.columns where table_schema='private'
  and table_name in ('world_room_chat_config','world_room_chat_sessions','world_room_chat_limits')
  and column_name in ('text','body','message','payload','history')$$, 'application metadata stores no transcript body');

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
select ('e1000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'authenticated','authenticated',
  'room-social-transport-' || i || '@example.test',now(),false from generate_series(1,3) i;
insert into public.profiles(user_id,nickname,is_banned)
select ('e1000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'전송검증' || i,false from generate_series(1,3) i;
update private.world_room_chat_config set enabled=true where singleton;

set local role authenticated;
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.join_world_club_room_v1('ROOM_CLUBHOUSE_01','e2000000-0000-4000-8000-000000000001')->>'allowed','true','sender club admission');
select set_config('rs.sender',(public.join_world_room_chat_v1('club','ROOM_CLUBHOUSE_01','e2000000-0000-4000-8000-000000000001')->>'leaseId'),true);
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select is(public.join_world_club_room_v1('ROOM_CLUBHOUSE_01','e2000000-0000-4000-8000-000000000002')->>'allowed','true','recipient club admission');
select set_config('rs.recipient',(public.join_world_room_chat_v1('club','ROOM_CLUBHOUSE_01','e2000000-0000-4000-8000-000000000002')->>'leaseId'),true);
select set_config('rs.topic','world:room-chat:' || current_setting('rs.recipient'),true);
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.send_world_room_chat_v1(current_setting('rs.sender')::uuid,'실제 전송 검증')->>'ok','true','server chat send accepted');
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01','e2000000-0000-4000-8000-000000000001','action',
  '{"v":1,"id":7,"type":"jump","payload":{}}')->>'sent','true','server numeric action accepted');
reset role;

select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),1::bigint,
  'real provider persisted one server chat envelope');
select ok((select bool_and(private and extension='broadcast' and event='room_chat_v1'
  and payload->>'userId'='e1000000-0000-4000-8000-000000000001' and payload->>'name'='전송검증1'
  and payload->>'text'='실제 전송 검증') from realtime.messages where topic=current_setting('rs.topic')),
  'provider envelope is private, canonical and attributed to the authenticated sender');
select is((select payload#>'{p,id}' from realtime.messages
  where topic='world:club:ROOM_CLUBHOUSE_01:e2000000-0000-4000-8000-000000000002'), '7'::jsonb,
  'real provider preserves the numeric action ID');

-- Deliberately permissive unrelated policies must never bypass either restrictive guard.
create policy "room social fixture permissive read" on realtime.messages for select to authenticated using(true);
create policy "room social fixture permissive write" on realtime.messages for insert to authenticated with check(true);
set local role authenticated;
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select set_config('realtime.topic',current_setting('rs.topic'),true);
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),1::bigint,'recipient reads own chat inbox');
select is((select count(*) from realtime.messages where topic='world:club:ROOM_CLUBHOUSE_01:e2000000-0000-4000-8000-000000000002'),0::bigint,
  'chat subscription cannot read the same account club inbox');
select throws_ok($$select realtime.send('{}'::jsonb,'room_chat_v1',current_setting('rs.topic'),true)$$,'42501',null,
  'authenticated client cannot directly broadcast through provider function');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private)
  values(current_setting('rs.topic'),'broadcast','room_chat_v1','{}',true)$$,'42501',null,
  'client cannot INSERT into its own chat inbox even with permissive policy');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private)
  values('world:campus:AREA_MAIN_HALL','broadcast','room_chat_v1','{}',true)$$,'42501',null,
  'chat subscription cannot hide a client write behind campus row topic');
set local realtime.topic='world:campus:AREA_MAIN_HALL';
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),0::bigint,
  'campus subscription cannot read stored chat rows through permissive policy');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private)
  values(current_setting('rs.topic'),'broadcast','room_chat_v1','{}',true)$$,'42501',null,
  'campus subscription cannot write stored chat topic');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private)
  values('world:club:ROOM_CLUBHOUSE_01:e2000000-0000-4000-8000-000000000002','broadcast','club-packet','{}',true)$$,'42501',null,
  'campus subscription cannot write stored club topic');
set local realtime.topic='world:club:ROOM_CLUBHOUSE_01:e2000000-0000-4000-8000-000000000002';
select is((select count(*) from realtime.messages where topic=current_setting('realtime.topic')),1::bigint,'recipient reads own club inbox');
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),0::bigint,'club subscription cannot read chat inbox');
select throws_ok($$insert into realtime.messages(topic,extension,event,payload,private)
  values('world:campus:AREA_MAIN_HALL','broadcast','club-packet','{}',true)$$,'42501',null,
  'club subscription cannot hide a write behind campus row topic');
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}';
select set_config('realtime.topic',current_setting('rs.topic'),true);
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),0::bigint,'third account cannot read known chat inbox UUID');
set local realtime.topic='world:club:ROOM_CLUBHOUSE_01:e2000000-0000-4000-8000-000000000002';
select is((select count(*) from realtime.messages where topic=current_setting('realtime.topic')),0::bigint,'third account cannot read known club inbox UUID');
reset role;

-- Both block directions suppress fanout without requiring a cached subscriber to reconnect.
insert into public.world_user_blocks(blocker_id,blocked_id) values
 ('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.send_world_room_chat_v1(current_setting('rs.sender')::uuid,'역방향 차단')->>'ok','true','sender can send while blocked recipient receives nothing');
reset role;
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),1::bigint,'recipient block suppresses next provider send');
delete from public.world_user_blocks where blocker_id='e1000000-0000-4000-8000-000000000002' and blocked_id='e1000000-0000-4000-8000-000000000001';
insert into public.world_user_blocks(blocker_id,blocked_id) values
 ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.send_world_room_chat_v1(current_setting('rs.sender')::uuid,'정방향 차단')->>'ok','true','forward blocked recipient also receives nothing');
reset role;
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),1::bigint,'sender block suppresses next provider send');
update private.world_room_chat_config set enabled=false where singleton;
set local role authenticated;
select is(public.send_world_room_chat_v1(current_setting('rs.sender')::uuid,'비활성화')->>'ok','false','deactivation fails closed before rate or delivery');
set local request.jwt.claims='{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select set_config('realtime.topic',current_setting('rs.topic'),true);
select is((select count(*) from realtime.messages where topic=current_setting('rs.topic')),0::bigint,'deactivation revokes retained provider rows from client reads');
reset role;
select * from finish();
rollback;
