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

select * from finish();
rollback;
