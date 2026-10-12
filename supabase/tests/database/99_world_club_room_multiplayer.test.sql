-- Candidate only. Run with supabase test db against an explicitly approved disposable local DB.
-- Single-connection pgTAP checks are not evidence that a real two-connection race was executed.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
select ok(not (select enabled from private.world_club_rooms),'club candidate starts CLOSED');
update private.world_club_rooms set enabled=true;

create temp table fixture_admissions(session_id uuid primary key,admission_id uuid) on commit drop;
grant select,insert,update on fixture_admissions to authenticated;
create function pg_temp.admission(p_session uuid) returns uuid language sql as $$
  select coalesce((select admission_id from fixture_admissions where session_id=p_session),p_session)
$$;
create function pg_temp.join_club(p_room text,p_session uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  result := public.join_world_club_room_v1(p_room,p_session);
  if result->>'allowed'='true' then
    insert into fixture_admissions values(p_session,(result->>'admissionId')::uuid)
      on conflict(session_id) do update set admission_id=excluded.admission_id;
  end if;
  return result;
end;
$$;


select ok((select relrowsecurity from pg_class where oid = 'private.world_club_room_sessions'::regclass), 'sessions are RLS protected');
select ok(not has_table_privilege(r, 'private.world_club_room_sessions', 'select,insert,update,delete'), r || ' cannot read/write session rows')
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r, 'private.world_club_room_mutate_v1(text,text,uuid,text)', 'execute'), r || ' cannot call mutation primitive')
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r, 'private.world_club_room_fanout_v1(text,uuid,text,jsonb,jsonb)', 'execute'), r || ' cannot call fanout primitive')
  from unnest(array['anon','authenticated','service_role']) r;
select ok(has_function_privilege('authenticated', name, 'execute'), name || ' is authenticated RPC')
from unnest(array['public.join_world_club_room_v1(text,uuid)', 'public.heartbeat_world_club_room_v1(text,uuid)',
  'public.leave_world_club_room_v1(text,uuid)', 'public.claim_world_club_room_seat_v1(text,uuid,text)',
  'public.release_world_club_room_seat_v1(text,uuid,text)', 'public.publish_world_club_room_v1(text,uuid,text,jsonb)']) name;
select is_empty($$select oid::regprocedure::text from pg_proc where proname like '%world_club_room%'
  and prosecdef and not ('search_path=""' = any(proconfig))$$, 'all definers pin empty search path');
select ok((select pg_get_functiondef('private.world_club_room_mutate_v1(text,text,uuid,text)'::regprocedure) ~* 'for update'),
  'capacity and seats share the fixed room serialization lock');
select ok((select pg_get_functiondef('public.publish_world_club_room_v1(text,uuid,text,jsonb)'::regprocedure) ~* 'for update'),
  'publications also serialize with admission/replacement');

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
select ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'authenticated', 'authenticated',
  'club-fixture-' || i || '@example.test', now(), false from generate_series(1, 8) i;
insert into public.profiles(user_id, nickname, is_banned)
select ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, '동방테스트' || i, false from generate_series(1, 8) i;

-- Inspect the actual provider table in this disposable local transaction. Do not replace or
-- rename protected realtime functions. Rollback prevents these rows reaching subscribers.
select ok(private.world_room_publisher_safe_v1(),
  'actual provider is invoker and preserves restrictive RLS authority');
create temp view club_outbox as
  select payload, event, topic, private from realtime.messages
  where topic in (select 'world:club:ROOM_CLUBHOUSE_01:' || admission_id::text from fixture_admissions);

select is(private.world_club_room_access_v1(null, 'ROOM_CLUBHOUSE_01'), 'DENIED', 'null viewer fails closed');
select is(private.world_club_room_access_v1('c1000000-0000-4000-8000-000000000001', 'ROOM_OTHER'), 'DENIED', 'unknown room fails closed');
select is(private.world_club_room_access_v1('c1000000-0000-4000-8000-000000000001', 'ROOM_CLUBHOUSE_01'), 'MEMBER', 'permanent available account can enter common room');

set local role authenticated;
set local request.jwt.claims = '{}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000001')->>'allowed', 'false', 'missing JWT denied');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":true}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000001')->>'allowed', 'false', 'guest JWT denied');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_OTHER', 'c2000000-0000-4000-8000-000000000001')->>'reason', 'INVALID_ROOM', 'cannot choose a second room');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', null)->>'reason', 'INVALID_SESSION', 'missing session denied');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000001')->>'allowed', 'true', 'first admission succeeds');
select ok((public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000001'))->>'leaseMs')::integer
  between 19000 and 20000, 'heartbeat reports remaining time in its renewed 20-second lease');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000001'))->>'capacity', '6', 'six-person capacity contract');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000001'))#>>'{participants,0,displayName}', '동방테스트1', 'nickname is canonical profile identity');
select ok(public.can_access_world_club_room_realtime_v1(('world:club:ROOM_CLUBHOUSE_01:' || pg_temp.admission('c2000000-0000-4000-8000-000000000001')::text)), 'own live inbox readable');
select ok(not public.can_access_world_club_room_realtime_v1(('world:club:ROOM_CLUBHOUSE_01:' || pg_temp.admission('c2000000-0000-4000-8000-000000000002')::text)), 'another inbox denied');
select ok(not public.can_access_world_club_room_realtime_v1('world:club:ROOM_CLUBHOUSE_01'), 'shared broadcast topic denied');
select ok(not public.can_access_world_club_room_realtime_v1('world:club:ROOM_CLUBHOUSE_01:invalid'), 'malformed UUID fails closed without cast error');
reset role;

-- Fill the other five seats under their individual authenticated identities.
do $$
declare i integer; v_reply jsonb;
begin
  for i in 2..6 loop
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated',
      'sub','c1000000-0000-4000-8000-' || lpad(i::text,12,'0'),'is_anonymous',false)::text, true);
    v_reply := pg_temp.join_club('ROOM_CLUBHOUSE_01', ('c2000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid);
    if v_reply ->> 'allowed' <> 'true' then raise exception 'fixture admission failed: %', v_reply; end if;
  end loop;
end;
$$;
select is((select count(*) from private.world_club_room_sessions where room_id = 'ROOM_CLUBHOUSE_01'), 6::bigint, 'six admitted sessions');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000007","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000007')->>'reason', 'ROOM_FULL', 'seventh distinct account denied');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000007')->'participants', '[]'::jsonb, 'denied admission exposes no roster');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
reset role;
update private.world_club_room_admission_limits set created_at = clock_timestamp() + interval '1 minute'
 where user_id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000001')->>'allowed', 'true', 'same live UUID join is idempotent while full');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000001')->>'reason', 'JOIN_COOLDOWN', 'new UUID cannot immediately reset session-local publish limits');
reset role;
select is((select count(*) from private.world_club_room_admission_limits where user_id = 'c1000000-0000-4000-8000-000000000001'),
  1::bigint, 'cooldown rejection creates no rate timestamp');
select is((select session_id::text from private.world_club_room_sessions where user_id = 'c1000000-0000-4000-8000-000000000001'),
  'c2000000-0000-4000-8000-000000000001', 'cooldown preserves existing live admission');
-- Move synthetic fixture time rather than sleeping; production never edits ledger timestamps.
update private.world_club_room_admission_limits set created_at = clock_timestamp() - interval '2 seconds'
  where user_id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000001')->>'allowed', 'true', 'new session atomically replaces same user even while full');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000001'))->>'reason', 'SESSION_REPLACED', 'old heartbeat cannot renew replacement');
select is(public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000001'))->>'allowed', 'false', 'old leave cannot delete replacement');
select ok(not public.can_access_world_club_room_realtime_v1(('world:club:ROOM_CLUBHOUSE_01:' || pg_temp.admission('c2000000-0000-4000-8000-000000000001')::text)), 'old subscription auth is now false');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000001')->>'reason', 'JOIN_COOLDOWN', 'fresh admission remains subject to account cooldown');
select is(public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_s0')->>'claimed', 'true', 'first seat claimant succeeds');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'))#>>'{poses,0,packet,anim}', 'sit', 'claim immediately persists sit pose without client frame');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000002","is_anonymous":false}';
select is(public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000002'), 'chair_s0')->>'claimed', 'false', 'contending seat claim loses');
select is(public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000002'), 'chair_s0')->>'reason', 'SEAT_TAKEN', 'contention is a nonfatal response');
select is(public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_s1')->>'allowed', 'false', 'cannot mutate using another account session');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_n1')->>'claimed', 'true', 'seat transfer is atomic');
select is(public.release_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_s0')->>'released', 'false', 'stale release preserves newly claimed seat');
select is(public.release_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_n1')->>'released', 'true', 'matching release succeeds');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'))#>>'{poses,0,packet,anim}', 'idle', 'release immediately persists standing pose');
reset role;

-- Database uniqueness is a second barrier, independent of the RPC lock. These checks do not
-- claim to execute simultaneous requests; the cross-connection gate is documented separately.
select throws_ok($$update private.world_club_room_sessions set session_id = 'c3000000-0000-4000-8000-000000000001'
  where user_id = 'c1000000-0000-4000-8000-000000000002'$$, '23505', null, 'session UUID unique across admitted users');
update private.world_club_room_sessions set seat_id = 'chair_s0' where user_id = 'c1000000-0000-4000-8000-000000000001';
select throws_ok($$update private.world_club_room_sessions set seat_id = 'chair_s0'
  where user_id = 'c1000000-0000-4000-8000-000000000002'$$, '23505', null, 'room/seat uniqueness rejects a second occupant');
update private.world_club_room_sessions set seat_id = null where user_id = 'c1000000-0000-4000-8000-000000000001';

-- Packet validators have a small, closed visual contract.
select is(private.world_club_room_pose_v1('{"v":1,"seq":0,"x":0,"y":1.15,"z":0,"yaw":-180,"vx":0,"vz":0,"anim":"idle","userId":"forged"}', null),
  '{"v":1,"seq":0,"x":0,"y":1.15,"z":0,"yaw":180,"vx":0,"vz":0,"anim":"idle"}'::jsonb, 'pose allowlist strips identity and normalizes yaw');
select is(private.world_club_room_pose_v1('{"v":1,"seq":0,"x":0,"y":1,"z":0,"yaw":45,"vx":1,"vz":1,"anim":"sit"}', 'chair_n2'),
  '{"v":1,"seq":0,"x":0.7,"y":1.30,"z":1.14,"yaw":180,"vx":0,"vz":0,"anim":"sit"}'::jsonb, 'sit is snapped to authoritative chair anchor');
select is(private.world_club_room_pose_v1('{"v":1,"seq":0,"x":0,"y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"sit"}', null), null::jsonb, 'sit without server seat denied');
select is(private.world_club_room_pose_v1(p, null), null::jsonb, label) from (values
 ('{"v":1,"seq":0,"x":5,"y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}'::jsonb, 'outside room x denied'),
 ('{"v":1,"seq":0,"x":0,"y":1,"z":4,"yaw":0,"vx":0,"vz":0,"anim":"idle"}'::jsonb, 'outside room z denied'),
 ('{"v":1,"seq":0,"x":0,"y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"fly"}'::jsonb, 'fly denied'),
 ('{"v":1,"seq":0,"x":0,"y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle","mount":"dragon"}'::jsonb, 'mount field denied'),
 ('{"v":1,"seq":0,"x":"NaN","y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}'::jsonb, 'nonfinite string denied'),
 ('{"v":1,"seq":0.5,"x":0,"y":1,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}'::jsonb, 'fractional seq denied')
) cases(p,label);
select is(private.world_club_room_equipment_v1('{"HEAD":{"itemId":"head.cap","catalogStatus":"ACTIVE","owner":"forged"},"SECRET":{"itemId":"head.cap","catalogStatus":"ACTIVE"},"TOP":{"itemId":"bad","catalogStatus":"ACTIVE"}}'),
 '{"HEAD":{"itemId":"head.cap","catalogStatus":"ACTIVE"}}'::jsonb, 'equipment is a bounded visual-only allowlist');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'presence',
 '{"userId":"forged","sessionId":"forged","displayName":"spoof","joinedAt":0,"equipment":{"HEAD":{"itemId":"head.cap","catalogStatus":"ACTIVE"}}}')->>'sent', 'true', 'presence publish accepted but identity is ignored');
reset role;
select is((select count(*) from club_outbox), 5::bigint, 'fanout only targets five other live sessions');
select ok((select bool_and(event = 'club-packet' and private) from club_outbox), 'all sends are private club-packet events');
select ok((select bool_and(payload ->> 'sid' = 'c3000000-0000-4000-8000-000000000001'
 and payload #>> '{presence,userId}' = 'c1000000-0000-4000-8000-000000000001'
 and payload #>> '{p,displayName}' = '동방테스트1') from club_outbox), 'fanout envelope binds canonical sender identity');
select ok((select bool_and(topic <> ('world:club:ROOM_CLUBHOUSE_01:' || pg_temp.admission('c2000000-0000-4000-8000-000000000001')::text)) from club_outbox), 'replaced inbox receives nothing');
delete from club_outbox;
set local role authenticated;
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'pose',
 '{"v":1,"seq":0,"x":0,"y":1.15,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}')->>'sent', 'true', 'first client seq works after server seat transitions');
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'pose',
 '{"v":1,"seq":0,"x":0,"y":1.15,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}')->>'reason', 'STALE_PACKET', 'replayed client sequence ignored');
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'action',
 '{"v":1,"id":0,"type":"chat","payload":{"text":"no"}}')->>'sent', 'false', 'chat cannot bypass dedicated chat RPC');
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'action',
 '{"v":1,"id":1,"type":"teleport","payload":{}}')->>'sent', 'false', 'teleport action denied');
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'action', packet)->>'reason',
 'INVALID_PACKET', label) from (values
 ('{"v":1,"id":"2","type":"jump","payload":{}}'::jsonb, 'string action ID rejected'),
 ('{"v":1,"id":-1,"type":"jump","payload":{}}'::jsonb, 'negative action ID rejected'),
 ('{"v":1,"id":1.5,"type":"jump","payload":{}}'::jsonb, 'fractional action ID rejected'),
 ('{"v":1,"id":9007199254740992,"type":"jump","payload":{}}'::jsonb, 'unsafe integer action ID rejected')
) invalid_actions(packet,label);
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'action',
 '{"v":1,"id":2,"type":"emote","payload":{"emote":"wave","secret":"removed"}}')->>'sent', 'true', 'allowed emote is canonicalized');
reset role;
select is((select payload #> '{p,payload}' from club_outbox where payload ->> 'event' = 'action' limit 1),
 '{"emote":"wave"}'::jsonb, 'emote extra keys never transmitted');
select is((select payload #> '{p,id}' from club_outbox where payload ->> 'event' = 'action' limit 1),
 '2'::jsonb, 'canonical action ID stays a JSON number compatible with validateAction');
update private.world_club_room_sessions set last_pose_at = clock_timestamp() + interval '1 minute'
 where user_id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'pose',
 '{"v":1,"seq":1,"x":0,"y":1.15,"z":0,"yaw":0,"vx":0,"vz":0,"anim":"idle"}')->>'reason', 'RATE_LIMITED', 'pose limiter returns nonfatal response');
reset role;

-- Revoke recipients without asking them to resubscribe. The next publication must not reach
-- their cached inbox topics, and roster snapshots must exclude them immediately.
delete from club_outbox;
update public.profiles set is_banned = true where user_id = 'c1000000-0000-4000-8000-000000000002';
insert into private.world_user_moderation_actions(target_id, action, starts_at, ends_at)
 values ('c1000000-0000-4000-8000-000000000003', 'interaction_restriction_24h', now() - interval '1 minute', now() + interval '1 day');
update private.world_club_room_sessions set lease_expires_at = clock_timestamp() - interval '1 second'
 where user_id = 'c1000000-0000-4000-8000-000000000004';
update private.world_club_room_sessions set last_action_at = null where user_id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'action',
 '{"v":1,"id":3,"type":"jump","payload":{}}')->>'recipients', '2', 'ban/restriction/expiry removed before next publication');
select is(jsonb_array_length(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'))->'participants'), 3, 'snapshot excludes banned/restricted/expired');
reset role;
select is((select count(*) from club_outbox), 2::bigint, 'revoked cached inboxes receive no send');
select ok(not exists (select 1 from club_outbox where topic in (select 'world:club:ROOM_CLUBHOUSE_01:' || admission_id::text from fixture_admissions where session_id in ('c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000004'))), 'revocation blocks every affected recipient topic');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000004","is_anonymous":false}';
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c2000000-0000-4000-8000-000000000004'))->>'allowed', 'false', 'expired session cannot renew');
reset role;
update private.world_club_room_admission_limits set created_at=clock_timestamp()+interval '1 minute' where user_id='c1000000-0000-4000-8000-000000000004';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000004')->>'reason', 'JOIN_COOLDOWN', 'expired client UUID cannot bypass account cooldown');
reset role;
update private.world_club_room_admission_limits set created_at = clock_timestamp() - interval '2 seconds'
  where user_id = 'c1000000-0000-4000-8000-000000000004';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000004')->>'allowed', 'true', 'expired account can join with fresh UUID');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000002","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000002')->>'reason', 'DENIED', 'banned account cannot rejoin');
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000003","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000003')->>'reason', 'DENIED', 'restricted account cannot rejoin');
reset role;

-- Account-scoped rolling quota persists even with no active session; leave/expiry must not
-- reset it. Only account timestamps remain until the once/minute cleanup, not used UUIDs.
insert into private.world_club_room_admission_limits(user_id, created_at)
select
  'c1000000-0000-4000-8000-000000000007', clock_timestamp() - interval '2 minutes' - i * interval '1 second'
  from generate_series(1,60) i;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000007","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000007')->>'reason',
 'RATE_LIMITED', '60 successful admissions in a rolling hour block a fresh UUID');
reset role;
select is((select count(*) from private.world_club_room_admission_limits where user_id = 'c1000000-0000-4000-8000-000000000007'),
 60::bigint, 'quota rejection creates no rate timestamp');
update private.world_club_room_admission_limits set created_at = clock_timestamp() - interval '61 minutes'
 where user_id = 'c1000000-0000-4000-8000-000000000007';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000007')->>'allowed',
 'true', 'elapsed quota window admits a fresh UUID');
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c3000000-0000-4000-8000-000000000007')->>'allowed',
 'true', 'same live UUID retry never consumes admission quota');
reset role;
select is((select count(*) from private.world_club_room_admission_limits where user_id = 'c1000000-0000-4000-8000-000000000007'),
 61::bigint, 'only timestamp rate rows remain until the next cleanup; retries add nothing');

-- Database account type also overrides a forged permanent JWT.
update auth.users set is_anonymous = true where id = 'c1000000-0000-4000-8000-000000000008';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000008","is_anonymous":false}';
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01', 'c2000000-0000-4000-8000-000000000008')->>'allowed', 'false', 'database anonymous flag is authoritative');
reset role;

-- Verify policy shape without modifying the campus/private-room installer.
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname = 'world club server writes only' and permissive = 'RESTRICTIVE' and cmd = 'INSERT'), 'club write-deny guard installed');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname = 'world club leased inbox read' and cmd = 'SELECT'), 'leased inbox SELECT policy installed');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname = 'world club inbox read guard' and qual ~ '(^|[^a-z_])topic([^a-z_]|$)' and qual like '%realtime.topic()%'),
  'restrictive SELECT checks stored row topic as well as subscription topic');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname = 'world club server writes only' and with_check ~ '(^|[^a-z_])topic([^a-z_]|$)' and with_check like '%realtime.topic()%'),
  'restrictive INSERT checks both stored and subscription topics');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname = 'world online players write place zone'), 'campus/personal-room policy preserved');

create temp table club_revision_before on commit drop as
  select revision from private.world_club_rooms where room_id = 'ROOM_CLUBHOUSE_01';
update private.world_club_room_sessions set lease_expires_at = clock_timestamp() + interval '7 seconds'
  where user_id = 'c1000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
select ok((public.claim_world_club_room_seat_v1('ROOM_CLUBHOUSE_01', pg_temp.admission('c3000000-0000-4000-8000-000000000001'), 'chair_s2')->>'leaseMs')::integer
  between 1 and 7000, 'claim reports remaining lease and never pretends to renew it');
reset role;
select ok((select revision from private.world_club_rooms where room_id = 'ROOM_CLUBHOUSE_01') > (select revision from club_revision_before),
  'seat transitions and lease updates advance monotonic room revision');

-- Missing-provider behavior runs against the actual function body in the in-memory fixture,
-- where removing the synthetic publisher does not mutate Supabase's protected schema.
select ok(to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null,
  'real local Supabase publisher remained installed throughout the transaction');

-- The client pose UUID is reusable; every ended admission gets a different server inbox.
select set_config('fixture.old_admission',pg_temp.admission('c3000000-0000-4000-8000-000000000001')::text,true);
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001","is_anonymous":false}';
select is(public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01',current_setting('fixture.old_admission')::uuid)->>'allowed','true','current admission can leave');
reset role;
update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds'
 where user_id='c1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.join_club('ROOM_CLUBHOUSE_01','c3000000-0000-4000-8000-000000000001')->>'allowed','true','same client UUID may rejoin after leave');
select isnt(pg_temp.admission('c3000000-0000-4000-8000-000000000001')::text,current_setting('fixture.old_admission'),'reused client UUID gets fresh server admission');
select is(public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01',current_setting('fixture.old_admission')::uuid)->>'allowed','false','delayed old leave cannot erase replacement with identical client UUID');
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01',current_setting('fixture.old_admission')::uuid)->>'allowed','false','old admission cannot renew same-client replacement');
select ok(not public.can_access_world_club_room_realtime_v1('world:club:ROOM_CLUBHOUSE_01:'||current_setting('fixture.old_admission')),'old server inbox is not revived');
reset role;
select ok(to_regclass('private.world_club_room_session_ids') is null,'permanent identity tombstone table is absent');
select is_empty($$select column_name from information_schema.columns where table_schema='private'
 and table_name='world_club_room_admission_limits' and column_name not in ('user_id','created_at')$$,'rate rows contain no session, inbox or room identifier');
select private.world_room_cleanup_v1();
select is((select count(*) from private.world_club_room_admission_limits where user_id='c1000000-0000-4000-8000-000000000007'),1::bigint,'cleanup physically removes expired rolling-hour rate rows');
select ok(private.world_room_cleanup_healthy_v1(),'registered cleanup is healthy');
update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp()-interval '91 seconds';
set local role authenticated;
select is(public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01',pg_temp.admission('c3000000-0000-4000-8000-000000000001'))->>'reason','CLEANUP_UNAVAILABLE','stale cleanup health fails closed');
reset role;
select private.world_room_cleanup_v1();
select ok(not has_function_privilege(r,'private.world_room_cleanup_v1()','execute'),r||' cannot invoke metadata cleanup') from unnest(array['anon','authenticated','service_role']) r;
select ok(exists(select 1 from cron.job where jobname='world-room-social-cleanup-v1' and active and schedule='* * * * *'),'once/minute pg_cron task actually registered');

select * from finish();
rollback;
