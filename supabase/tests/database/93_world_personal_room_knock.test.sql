-- INHA WORLD Housing H3 (Public 20261005022000): knock before a friend visit.
-- Owner absent → OPEN at once by visibility; owner present → PENDING until the owner answers;
-- DECLINED holds for 10 minutes; the room access decision enforces both for every surface.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a7000000-0000-4000-8000-0000000000a7', 'authenticated', 'authenticated', 'knock-owner@example.test', now(), false),
 ('b7000000-0000-4000-8000-0000000000b7', 'authenticated', 'authenticated', 'knock-early@example.test', now(), false),
 ('c7000000-0000-4000-8000-0000000000c7', 'authenticated', 'authenticated', 'knock-accepted@example.test', now(), false),
 ('d7000000-0000-4000-8000-0000000000d7', 'authenticated', 'authenticated', 'knock-declined@example.test', now(), false),
 ('e7000000-0000-4000-8000-0000000000e7', 'authenticated', 'authenticated', 'knock-stranger@example.test', now(), false),
 ('f7000000-0000-4000-8000-0000000000f7', 'authenticated', 'authenticated', 'knock-expired@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a7000000-0000-4000-8000-0000000000a7', '노크주인', false),
 ('b7000000-0000-4000-8000-0000000000b7', '먼저온친구', false),
 ('c7000000-0000-4000-8000-0000000000c7', '들어온친구', false),
 ('d7000000-0000-4000-8000-0000000000d7', '거절된친구', false),
 ('e7000000-0000-4000-8000-0000000000e7', '모르는사람', false),
 ('f7000000-0000-4000-8000-0000000000f7', '늦은친구', false)
on conflict (user_id) do update set nickname = excluded.nickname, is_banned = excluded.is_banned;
-- The owner is friends with B, C, D and F; E is a stranger.
insert into public.world_friendships(user_low, user_high, status, requested_by, accepted_at)
select 'a7000000-0000-4000-8000-0000000000a7', v::uuid, 'accepted', 'a7000000-0000-4000-8000-0000000000a7', now()
from unnest(array['b7000000-0000-4000-8000-0000000000b7', 'c7000000-0000-4000-8000-0000000000c7',
                  'd7000000-0000-4000-8000-0000000000d7', 'f7000000-0000-4000-8000-0000000000f7']) v;

-- ---- schema / grants ----
select has_table('private', 'world_room_knocks', 'knock table exists');
select has_table('private', 'world_room_owner_presence', 'owner presence table exists');
select ok(not has_table_privilege(r, t, p), format('%s has no %s on %s', r, p, t))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['private.world_room_knocks', 'private.world_room_owner_presence']) t,
     unnest(array['select', 'insert', 'update', 'delete']) p;
select ok(not has_function_privilege('anon', f, 'execute'), format('anon cannot execute %s', f))
from unnest(array[
  'public.knock_friend_personal_room_v1(uuid)', 'public.get_my_room_knock_v1(uuid)',
  'public.list_my_room_knocks_v1()', 'public.respond_room_knock_v1(uuid,boolean)'
]) f;
select ok(has_function_privilege('authenticated', f, 'execute'), format('authenticated executes %s', f))
from unnest(array[
  'public.knock_friend_personal_room_v1(uuid)', 'public.get_my_room_knock_v1(uuid)',
  'public.list_my_room_knocks_v1()', 'public.respond_room_knock_v1(uuid,boolean)'
]) f;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['private.world_room_owner_present_v1(uuid)']) f;

-- The owner opens a room (FRIENDS by default).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select set_config('knock.room', (public.get_or_create_my_personal_room_v1() ->> 'roomId'), true);

-- ---- owner absent: a knock is admitted at once ----
select set_config('request.jwt.claims', '{"sub":"b7000000-0000-4000-8000-0000000000b7","role":"authenticated","is_anonymous":false}', true);
select set_config('knock.b', (public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId'), true);
select is(public.get_my_room_knock_v1(current_setting('knock.b')::uuid) ->> 'status', 'OPEN', 'owner away: the knock is OPEN');
select is((public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'ownerPresent')::boolean, false, 'owner away is reported');
select is(public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId', current_setting('knock.b'),
  'a repeated knock reuses the still-valid admission');
select is(public.resolve_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'role', 'visitor', 'OPEN visitor resolves the room');

-- Strangers, guests and private rooms are refused before any row is written.
select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000e7","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '42501', 'NOT_FRIENDS', 'a stranger cannot knock');
select throws_ok($$select public.get_my_room_knock_v1(current_setting('knock.b')::uuid)$$, 'P0002', 'KNOCK_NOT_FOUND', 'another visitor''s knock is not readable');
select throws_ok($$select public.list_my_room_knocks_v1()$$, 'P0002', 'ROOM_NOT_FOUND', 'no room, no knock list');

-- ---- owner present: knocks wait for an answer ----
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select is(jsonb_array_length(public.list_my_room_knocks_v1() -> 'knocks'), 0, 'owner polls: nothing pending yet');

select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-0000000000c7","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'reason', 'KNOCK_REQUIRED', 'owner home: entering needs a knock');
select throws_ok($$select public.resolve_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '42501', 'KNOCK_REQUIRED', 'resolver asks for a knock while the owner is home');
select ok(not public.can_access_world_room_realtime_v1('world:room:' || current_setting('knock.room')), 'no Realtime room channel before an answer');
select set_config('knock.c', (public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId'), true);
select is(public.get_my_room_knock_v1(current_setting('knock.c')::uuid) ->> 'status', 'PENDING', 'owner home: the knock is PENDING');
select is(public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId', current_setting('knock.c'), 'one pending knock per visitor');
select throws_ok(format($$select public.respond_room_knock_v1(%L, true)$$, current_setting('knock.c')), 'P0002', 'KNOCK_NOT_FOUND', 'a visitor cannot answer a knock');

-- The early visitor's OPEN admission still counts while the owner is home.
select set_config('request.jwt.claims', '{"sub":"b7000000-0000-4000-8000-0000000000b7","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'role', 'visitor', 'a visitor admitted while the owner was away stays admitted');

select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select is(public.list_my_room_knocks_v1() #>> '{knocks,0,visitorDisplayName}', '들어온친구', 'owner sees who knocked');
select is(public.list_my_room_knocks_v1() #>> '{knocks,0,knockId}', current_setting('knock.c'), 'owner sees the pending knock id');
select is(public.respond_room_knock_v1(current_setting('knock.c')::uuid, true) ->> 'status', 'ACCEPTED', 'owner lets the visitor in');
select is(public.respond_room_knock_v1(current_setting('knock.c')::uuid, false) ->> 'status', 'ACCEPTED', 'a repeated answer does not flip an answered knock');
select is(jsonb_array_length(public.list_my_room_knocks_v1() -> 'knocks'), 0, 'answered knocks leave the pending list');

select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-0000000000c7","role":"authenticated","is_anonymous":false}', true);
select is(public.get_my_room_knock_v1(current_setting('knock.c')::uuid) ->> 'status', 'ACCEPTED', 'visitor reads the answer');
select is(public.resolve_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'role', 'visitor', 'accepted visitor resolves the room');
select ok(public.can_access_world_room_realtime_v1('world:room:' || current_setting('knock.room')), 'accepted visitor may join the room channel');

-- ---- decline: refused for 10 minutes, for this room and visitor only ----
select set_config('request.jwt.claims', '{"sub":"d7000000-0000-4000-8000-0000000000d7","role":"authenticated","is_anonymous":false}', true);
select set_config('knock.d', (public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId'), true);
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select is(public.respond_room_knock_v1(current_setting('knock.d')::uuid, false) ->> 'status', 'DECLINED', 'owner says not now');
select set_config('request.jwt.claims', '{"sub":"d7000000-0000-4000-8000-0000000000d7","role":"authenticated","is_anonymous":false}', true);
select is(public.get_my_room_knock_v1(current_setting('knock.d')::uuid) ->> 'status', 'DECLINED', 'visitor reads the decline');
select throws_ok($$select public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '42501', 'VISIT_DECLINED', 'no new knock during the cooldown');
select throws_ok($$select public.resolve_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '42501', 'VISIT_DECLINED', 'resolver refuses during the cooldown');
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'reason', 'VISIT_DECLINED', 'access check names the decline');
reset role;
-- Owner leaves (heartbeat goes stale): the decline still holds, admissions are unaffected.
update private.world_room_owner_presence set seen_at = now() - interval '1 minute' where room_id = current_setting('knock.room')::uuid;
set local role authenticated;
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'reason', 'VISIT_DECLINED', 'decline outlives the owner leaving');
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-0000000000c7","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'role', 'visitor', 'accepted visitor keeps access after the owner leaves');
reset role;
update private.world_room_knocks set responded_at = now() - interval '11 minutes' where id = current_setting('knock.d')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d7000000-0000-4000-8000-0000000000d7","role":"authenticated","is_anonymous":false}', true);
select is(public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'status', 'OPEN', 'after the cooldown, an owner-away knock is OPEN again');

-- ---- expiry and rate limit while the owner is home ----
reset role;
update private.world_room_owner_presence set seen_at = now() where room_id = current_setting('knock.room')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7000000-0000-4000-8000-0000000000f7","role":"authenticated","is_anonymous":false}', true);
select set_config('knock.f', (public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7') ->> 'knockId'), true);
reset role;
update private.world_room_knocks set created_at = now() - interval '1 minute', expires_at = now() - interval '1 second'
 where id = current_setting('knock.f')::uuid;
set local role authenticated;
select is(public.get_my_room_knock_v1(current_setting('knock.f')::uuid) ->> 'status', 'EXPIRED', 'an unanswered knock expires');
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select is(jsonb_array_length(public.list_my_room_knocks_v1() -> 'knocks'), 0, 'expired knocks leave the pending list');
select is(public.respond_room_knock_v1(current_setting('knock.f')::uuid, true) ->> 'status', 'EXPIRED', 'an expired knock cannot be accepted');
reset role;
insert into private.world_room_knocks (room_id, visitor_user_id, status, created_at, expires_at)
select current_setting('knock.room')::uuid, 'f7000000-0000-4000-8000-0000000000f7', 'EXPIRED', now() - interval '30 seconds', now() - interval '1 second'
from generate_series(1, 4);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f7000000-0000-4000-8000-0000000000f7","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '54000', 'RATE_LIMITED', 'five knocks in two minutes is the cap');

-- ---- privacy and unfriend still win ----
select set_config('request.jwt.claims', '{"sub":"a7000000-0000-4000-8000-0000000000a7","role":"authenticated","is_anonymous":false}', true);
select is(public.set_my_personal_room_visibility_v1('private') ->> 'visibility', 'private', 'owner goes PRIVATE');
select set_config('request.jwt.claims', '{"sub":"c7000000-0000-4000-8000-0000000000c7","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.knock_friend_personal_room_v1('a7000000-0000-4000-8000-0000000000a7')$$, '42501', 'ROOM_PRIVATE', 'no knock on a PRIVATE room');
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'reason', 'ROOM_PRIVATE', 'PRIVATE outranks an earlier acceptance');
reset role;
delete from public.world_friendships where user_low = 'a7000000-0000-4000-8000-0000000000a7' and user_high = 'b7000000-0000-4000-8000-0000000000b7';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b7000000-0000-4000-8000-0000000000b7","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('knock.room')::uuid) ->> 'reason', 'DENIED', 'unfriend outranks an earlier admission');
reset role;

select * from finish();
rollback;
