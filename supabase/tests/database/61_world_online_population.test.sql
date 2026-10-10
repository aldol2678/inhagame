-- INHA WORLD total-online heartbeat contract.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- OPS reads require a signed-in staff account with ops.read (P1-S0). ops_staff_session() switches the
-- request claims to that account and returns the now-ignored p_token argument (null).
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('5f000000-0000-4000-8000-000000000061','authenticated','authenticated','ops-staff-61@example.test',now(),false,now());
insert into public.profiles(user_id,nickname,title,avatar_key,is_banned)
values ('5f000000-0000-4000-8000-000000000061','OPS staff','', 'classic', false)
on conflict (user_id) do update set is_banned=false;
insert into private.world_staff_assignments(user_id,role,active) values ('5f000000-0000-4000-8000-000000000061','world_admin',true);
create function pg_temp.ops_staff_session() returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}', true);
  return null;
end
$f$;

select has_table('public','world_online_sessions','heartbeat table exists');
select col_is_pk('public','world_online_sessions','session_id','one row per browser session');
select has_function('public','touch_world_online_session_v1',array['uuid','text','text'],'legacy heartbeat RPC exists');
select has_function('public','touch_world_online_session_v2',array['uuid','uuid','text','text'],'visitor-aware heartbeat RPC exists');
select has_column('public','world_online_sessions','visitor_id','heartbeat table stores pseudonymous browser visitor id');
select has_function('public','get_world_online_count_v1',array[]::text[],'population count RPC exists');
select has_function('public','get_world_online_ops_v1',array['text'],'protected OPS population RPC exists');

set local role anon;
select lives_ok($$select public.touch_world_online_session_v2(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'AREA_MAIN_HALL','campus')$$,
  'signed-out visitor can heartbeat with a persistent visitor id');
select is((public.get_world_online_count_v1()->>'online')::integer,1,'signed-out session counts online');
select is((public.get_world_online_count_v1()->>'guests')::integer,1,'signed-out session counts as guest');
select throws_ok($$select public.touch_world_online_session_v2(
  '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','RC_0_0','campus')$$,
  '22023','INVALID_PLACE_ZONE','render chunk ids are rejected');
select throws_ok($$select public.touch_world_online_session_v2(
  '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'spaceship')$$,
  '22023','INVALID_SPACE','unknown spaces are rejected');
reset role;

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('33333333-3333-4333-8333-333333333333','authenticated','authenticated','member@example.test',now(),false);

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select lives_ok($$select public.touch_world_online_session_v2(
  '44444444-4444-4444-8444-444444444444',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'AREA_MAIN_HALL','campus')$$,
  'signed-in visitor can heartbeat with auth uid still server-derived');
select is((public.get_world_online_count_v1()->>'online')::integer,2,'guest and signed-in browser sessions both count');
select is((public.get_world_online_count_v1()->>'signedIn')::integer,1,'auth uid is attached server-side');
reset role;

select throws_ok(
  $$select public.get_world_online_ops_v1('bad-token')$$,
  '42501','unauthorized','World online OPS rejects the wrong token');

select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->>'online')::integer,
  2,'OPS sees both live browser sessions');

select ok(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'today'->>'sessionStarts')::integer >= 2,
  'OPS exposes today browser session starts separately from live concurrency');

select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'today'->>'signedInUsers')::integer,
  1,'OPS exposes distinct signed-in accounts for today');

select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'today'->>'uniqueVisitors')::integer,
  2,'OPS counts distinct tracked browser visitors seen today');

select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'today'->>'visitorCoveragePct')::numeric,
  100.0::numeric,'OPS exposes visitor-id coverage for daily UV interpretation');

select ok(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'today'->>'uniqueVisitorsSupported')::boolean = true,
  'OPS marks browser UV as supported once visitor-aware heartbeat is available');
select is(
  public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'zones'->0->>'zone',
  'AREA_MAIN_HALL','OPS groups live sessions by semantic Place Zone');
select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'zones'->0->>'online')::integer,
  2,'zone live count includes signed-in and guest sessions');
select is(
  (public.get_world_online_ops_v1(pg_temp.ops_staff_session())->'zones'->0->>'signedIn')::integer,
  1,'zone response separates signed-in sessions');

update public.world_online_sessions
set last_seen_at=now()-interval '71 seconds'
where session_id='11111111-1111-4111-8111-111111111111';

set local role anon;
select is((public.get_world_online_count_v1()->>'online')::integer,1,'stale heartbeat expires from live count');
reset role;

select ok(not has_table_privilege('anon','public.world_online_sessions','select'),'anon cannot read raw sessions');
select ok(not has_table_privilege('authenticated','public.world_online_sessions','select'),'authenticated cannot read raw sessions');

-- Operator kick must be world-only, privileged, and resistant to heartbeat recreation.
select has_table('private','world_session_kick_blocks','world-only session block table exists');
select has_function('public','kick_world_user_v1',array['uuid','integer'],'admin kick RPC exists');
select has_function('public','restore_world_user_v1',array['uuid'],'admin restore RPC exists');

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $q$select public.kick_world_user_v1('5f000000-0000-4000-8000-000000000061',30)$q$,
  '42501','unauthorized','normal member cannot eject even a staff account');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select is(
  (public.kick_world_user_v1('33333333-3333-4333-8333-333333333333',30)->>'sessionsRemoved')::integer,
  1,'world admin can remove a member heartbeat without deleting the account');
select is((public.get_world_online_count_v1()->>'online')::integer,0,
  'the stale guest and ejected member are not counted');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $q$select public.touch_world_online_session_v2(
   '44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_REVOKED','ejected account cannot recreate a world heartbeat');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select ok(public.restore_world_user_v1('33333333-3333-4333-8333-333333333333'),
  'world admin can restore access');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select lives_ok($q$select public.touch_world_online_session_v2(
  '44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'AREA_MAIN_HALL','campus')$q$,'restored account can heartbeat again');
reset role;

-- Admin-only roster exposes currently active accounts, but never guest IDs or credentials.
select has_function('public','get_world_session_admin_v1',array[]::text[],
  'world admin session roster RPC exists');
select ok(not has_function_privilege('anon','public.get_world_session_admin_v1()','EXECUTE'),
  'anonymous callers cannot execute the world session roster');
select ok(has_function_privilege('authenticated','public.get_world_session_admin_v1()','EXECUTE'),
  'signed-in callers can reach the RPC (staff role checked inside)');

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok($q$select public.get_world_session_admin_v1()$q$,
  '42501','unauthorized','regular members cannot read other online accounts');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select is((public.get_world_session_admin_v1()->>'operatorUserId')::uuid,
  '5f000000-0000-4000-8000-000000000061'::uuid,'roster identifies the authorized operator');
select is((public.get_world_session_admin_v1()->>'onlineSessions')::integer,1,
  'roster active count respects the 70-second heartbeat window');
select is((public.get_world_session_admin_v1()->>'guestSessions')::integer,0,
  'roster reports guest count without disclosing guest identifiers');
select is((public.get_world_session_admin_v1()->'accounts'->0->>'userId')::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,'roster enumerates active member account');
select is((public.get_world_session_admin_v1()->'accounts'->0->>'sessionCount')::integer,1,
  'roster groups browser sessions per account');
select ok(not (public.get_world_session_admin_v1()::text ~* 'member@example.test'),
  'roster does not expose member email');
select is(jsonb_array_length(public.get_world_session_admin_v1()->'blocked'),0,
  'roster starts with no active kick blocks');
select lives_ok($q$select public.kick_world_user_v1(
  '33333333-3333-4333-8333-333333333333',5)$q$,
  'existing privileged kick remains available alongside admin list');
select is(jsonb_array_length(public.get_world_session_admin_v1()->'accounts'),0,
  'ejected member disappears from the active roster');
select is(jsonb_array_length(public.get_world_session_admin_v1()->'blocked'),1,
  'ejected member appears in reversible access blocks');
select ok(public.restore_world_user_v1('33333333-3333-4333-8333-333333333333'),
  'admin restore remains available from the same roster');
select is(jsonb_array_length(public.get_world_session_admin_v1()->'blocked'),0,
  'restored account disappears from the blocked roster');
reset role;

-- Session-kick hardening: one block decision for v1 and v2, session UUID ownership, private shared core.
select ok(
  not has_function_privilege('anon','private.touch_world_online_session_core(uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','private.touch_world_online_session_core(uuid,uuid,text,text)','EXECUTE'),
  'the shared heartbeat core is not executable through the Data API roles');
select ok(
  has_function_privilege('anon','public.touch_world_online_session_v1(uuid,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.touch_world_online_session_v1(uuid,text,text)','EXECUTE')
  and has_function_privilege('anon','public.touch_world_online_session_v2(uuid,uuid,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.touch_world_online_session_v2(uuid,uuid,text,text)','EXECUTE'),
  'v1 and v2 heartbeats keep the same anon and authenticated EXECUTE grants');

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select lives_ok($q$select public.kick_world_user_v1('33333333-3333-4333-8333-333333333333',5)$q$,
  'operator blocks the member for the parity checks');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $q$select public.touch_world_online_session_v1('55555555-5555-4555-8555-555555555555','AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_REVOKED','legacy v1 heartbeat is refused for a blocked account like v2');
reset role;
select is((select count(*)::integer from public.world_online_sessions
  where session_id='55555555-5555-4555-8555-555555555555'),0,
  'a refused v1 heartbeat creates no session row');

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select ok(public.restore_world_user_v1('33333333-3333-4333-8333-333333333333'),'operator restores the member');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select lives_ok($q$select public.touch_world_online_session_v1('55555555-5555-4555-8555-555555555555','AREA_MAIN_HALL','campus')$q$,
  'restored account can use the legacy v1 heartbeat again');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $q$select public.touch_world_online_session_v2('55555555-5555-4555-8555-555555555555',null,'AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_OWNER_MISMATCH','another account cannot take over an owned session UUID');
reset role;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select throws_ok(
  $q$select public.touch_world_online_session_v2('55555555-5555-4555-8555-555555555555',null,'AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_OWNER_MISMATCH','a signed-out call cannot downgrade an owned session to a guest');
reset role;
select is((select user_id from public.world_online_sessions where session_id='55555555-5555-4555-8555-555555555555'),
  '33333333-3333-4333-8333-333333333333'::uuid,'session ownership is unchanged after the refused takeovers');

-- Session admin read-back (F08): the capped roster says when it was cut; one account can be read exactly.
select has_function('public','get_world_session_admin_target_v1',array['uuid'],'exact per-account session read exists');
select ok(not has_function_privilege('anon','public.get_world_session_admin_target_v1(uuid)','EXECUTE'),
  'anonymous callers cannot execute the exact per-account read');
select ok(has_function_privilege('authenticated','public.get_world_session_admin_target_v1(uuid)','EXECUTE'),
  'signed-in callers reach the exact read (staff role checked inside)');

set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok($q$select public.get_world_session_admin_target_v1('33333333-3333-4333-8333-333333333333')$q$,
  '42501','unauthorized','regular members cannot use the exact per-account read');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"5f000000-0000-4000-8000-000000000061","role":"authenticated","is_anonymous":false}';
select ok((public.get_world_session_admin_v1()->>'accountsTruncated')::boolean = false
  and (public.get_world_session_admin_v1()->>'blockedTruncated')::boolean = false
  and (public.get_world_session_admin_v1()->>'accountsTotal')::integer = 1,
  'roster exposes exact totals and says its lists were not cut');
select is((public.get_world_session_admin_target_v1('33333333-3333-4333-8333-333333333333')->>'sessionRows')::integer,1,
  'exact read counts the account heartbeat rows');
select is(public.get_world_session_admin_target_v1('33333333-3333-4333-8333-333333333333')->>'blockedUntil',null,
  'exact read reports no active block');
select lives_ok($q$select public.kick_world_user_v1('33333333-3333-4333-8333-333333333333',5)$q$,'operator blocks the member again');
select is((public.get_world_session_admin_target_v1('33333333-3333-4333-8333-333333333333')->>'sessionRows')::integer,0,
  'after the kick the exact read proves no heartbeat row remains');
select ok((public.get_world_session_admin_target_v1('33333333-3333-4333-8333-333333333333')->>'blockedUntil') is not null,
  'after the kick the exact read shows the active block');
select ok(public.restore_world_user_v1('33333333-3333-4333-8333-333333333333'),'operator restores the member');
reset role;

-- Guest session binding (F09): a row that carries a browser visitor id only answers to that id.
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select is((select auth.uid()),null::uuid,'the guest block really runs signed out');
select lives_ok($q$select public.touch_world_online_session_v2('66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AREA_MAIN_HALL','campus')$q$,
  'a guest registers a session with its browser visitor id');
select throws_ok(
  $q$select public.touch_world_online_session_v2('66666666-6666-4666-8666-666666666666','dddddddd-dddd-4ddd-8ddd-dddddddddddd','AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_OWNER_MISMATCH','another browser cannot rewrite a guest row it did not create');
select throws_ok(
  $q$select public.touch_world_online_session_v1('66666666-6666-4666-8666-666666666666','AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_OWNER_MISMATCH','a visitor-less call cannot bypass the binding of a bound guest row');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $q$select public.touch_world_online_session_v2('66666666-6666-4666-8666-666666666666','dddddddd-dddd-4ddd-8ddd-dddddddddddd','AREA_MAIN_HALL','campus')$q$,
  '42501','WORLD_SESSION_OWNER_MISMATCH','an account on another browser cannot claim the guest row');
select lives_ok(
  $q$select public.touch_world_online_session_v2('66666666-6666-4666-8666-666666666666','cccccccc-cccc-4ccc-8ccc-cccccccccccc','AREA_MAIN_HALL','campus')$q$,
  'the same browser can claim its own guest row when the account signs in');
reset role;
select is((select user_id from public.world_online_sessions where session_id='66666666-6666-4666-8666-666666666666'),
  '33333333-3333-4333-8333-333333333333'::uuid,'the sign-in claim by the same browser took effect');

select * from finish();
rollback;
