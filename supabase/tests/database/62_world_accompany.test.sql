-- P0-E: server-owned, consented, temporary friend journey.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a0000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'accompany-a@example.test', now(), false),
 ('b0000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'accompany-b@example.test', now(), false),
 ('c0000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'accompany-c@example.test', now(), false),
 ('d0000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', null, null, true);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a0000000-0000-4000-8000-0000000000a1', '앨리스', false),
 ('b0000000-0000-4000-8000-0000000000b2', '밥돌', false),
 ('c0000000-0000-4000-8000-0000000000c3', '찰리', false),
 ('d0000000-0000-4000-8000-0000000000d4', '게스트', false)
on conflict (user_id) do update set nickname = excluded.nickname, is_banned = excluded.is_banned;

select has_table('public', 'world_accompany_sessions', 'accompany session table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.world_accompany_sessions'::regclass), 'RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.world_accompany_sessions', 'select'), 'no direct session read');
select ok(not has_table_privilege('authenticated', 'public.world_accompany_sessions', 'insert'), 'no direct session write');

set local role anon;
select throws_ok($$select public.get_my_world_accompany()$$, '42501', null, 'anonymous cannot list invites');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.get_my_world_accompany()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guest cannot use accompany');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'AREA_MAIN_HALL')$$,
  '42501', 'NOT_ALLOWED', 'friendship required');
reset role;

insert into public.world_friendships(user_low, user_high, status, requested_by, accepted_at)
values ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b2', 'accepted',
  'a0000000-0000-4000-8000-0000000000a1', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.invalid', 'AREA_MAIN_HALL')$$,
  '22023', 'INVALID_DESTINATION', 'only known campus POIs');
select throws_ok($$select public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'RC_0_0')$$,
  '22023', 'INVALID_PLACE_ZONE', 'semantic zone only');
select set_config('test.accompany_id',
  public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'AREA_MAIN_HALL')->>'id', true);
select is(public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'AREA_MAIN_HALL')->>'id',
  current_setting('test.accompany_id'), 'repeat proposal is idempotent');
select is(jsonb_array_length(public.get_my_world_accompany()), 1, 'inviter sees one offer');
select throws_ok($$select public.respond_world_accompany(current_setting('test.accompany_id')::uuid, true)$$,
  '22023', 'TARGET_UNAVAILABLE', 'inviter cannot accept');

set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}';
select is(jsonb_array_length(public.get_my_world_accompany()), 0, 'unrelated account sees nothing');
select throws_ok($$select public.respond_world_accompany(current_setting('test.accompany_id')::uuid, true)$$,
  '22023', 'TARGET_UNAVAILABLE', 'unrelated account cannot accept');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.get_my_world_accompany()->0->>'state', 'offered', 'invitee sees a pending offer, with no movement');
select is(public.respond_world_accompany(current_setting('test.accompany_id')::uuid, true)->>'state', 'active', 'only invitee accepts');
select is(public.respond_world_accompany(current_setting('test.accompany_id')::uuid, true)->>'state', 'active', 'accept retry is safe');
select is(public.get_my_world_accompany()->0->>'state', 'active', 'invitee sees accepted state');
select is(public.end_world_accompany(current_setting('test.accompany_id')::uuid)->>'state', 'ended', 'participant can end');
select is(jsonb_array_length(public.get_my_world_accompany()), 0, 'ended session disappears');

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select set_config('test.accompany_expire_id',
  public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'AREA_MAIN_HALL')->>'id', true);
reset role;
update public.world_accompany_sessions set expires_at = now() - interval '1 second'
where id = current_setting('test.accompany_expire_id')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(jsonb_array_length(public.get_my_world_accompany()), 0, 'expired invitation disappears');
select throws_ok($$select public.respond_world_accompany(current_setting('test.accompany_expire_id')::uuid, true)$$,
  '22023', 'TARGET_UNAVAILABLE', 'expired invitation cannot be accepted');
reset role;

insert into public.world_user_blocks(blocker_id, blocked_id)
values ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.propose_world_accompany('b0000000-0000-4000-8000-0000000000b2', 'poi.main-hall', 'AREA_MAIN_HALL')$$,
  '42501', 'NOT_ALLOWED', 'block prevents a new invitation');
select * from finish();
rollback;
