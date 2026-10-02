-- INHA WORLD Housing: S1-D1.3 Personal Room authority (20260926232707) and S1-D2 Room Session /
-- friend visits (Public 20261002130000). A room UUID alone never grants access; guests never own or
-- visit a room; the guest campus Realtime policy of 20260927110305 survives the D2 installer.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'room-owner@example.test', now(), false),
 ('b2000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'room-friend@example.test', now(), false),
 ('c3000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'room-stranger@example.test', now(), false),
 ('d4000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', null, null, true),
 ('e5000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'room-banned@example.test', now(), false),
 ('f6000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', 'room-noroom@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a1000000-0000-4000-8000-0000000000a1', '방주인', false),
 ('b2000000-0000-4000-8000-0000000000b2', '친구', false),
 ('c3000000-0000-4000-8000-0000000000c3', '모르는사람', false),
 ('d4000000-0000-4000-8000-0000000000d4', '게스트', false),
 ('e5000000-0000-4000-8000-0000000000e5', '밴계정', true),
 ('f6000000-0000-4000-8000-0000000000f6', '방없는친구', false)
on conflict (user_id) do update set nickname = excluded.nickname, is_banned = excluded.is_banned;
-- A–B and B–F are accepted friends; A–C strangers.
insert into public.world_friendships(user_low, user_high, status, requested_by, accepted_at) values
 ('a1000000-0000-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000b2', 'accepted', 'a1000000-0000-4000-8000-0000000000a1', now()),
 ('b2000000-0000-4000-8000-0000000000b2', 'f6000000-0000-4000-8000-0000000000f6', 'accepted', 'b2000000-0000-4000-8000-0000000000b2', now());


-- ---- schema / grants ----
select has_table('public', 'world_player_rooms', 'room authority table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.world_player_rooms'::regclass), 'rooms have RLS');
select ok(not has_table_privilege(r, 'public.world_player_rooms', p), format('%s has no %s on rooms', r, p))
from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p;
select ok(not has_function_privilege('anon', f, 'execute'), format('anon cannot execute %s', f))
from unnest(array[
  'public.get_or_create_my_personal_room_v1()',
  'public.resolve_friend_personal_room_v1(uuid)',
  'public.check_world_room_access_v1(uuid)',
  'public.set_my_personal_room_visibility_v1(text)',
  'public.can_access_world_room_realtime_v1(text)'
]) f;
select ok(has_function_privilege('authenticated', f, 'execute'), format('authenticated executes %s', f))
from unnest(array[
  'public.get_or_create_my_personal_room_v1()',
  'public.resolve_friend_personal_room_v1(uuid)',
  'public.check_world_room_access_v1(uuid)',
  'public.set_my_personal_room_visibility_v1(text)',
  'public.can_access_world_room_realtime_v1(text)'
]) f;
select ok(not has_function_privilege(r, 'private.world_room_access_v1(uuid,uuid)', 'execute'),
  format('%s cannot call the private access helper with an arbitrary viewer', r))
from unnest(array['anon', 'authenticated']) r;

-- ---- D1.3: owner room is server-derived and stable ----
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select set_config('housing.room_a', (public.get_or_create_my_personal_room_v1() ->> 'roomId'), true);
select is(public.get_or_create_my_personal_room_v1() ->> 'roomId', current_setting('housing.room_a'), 'same account reuses its room UUID');
select is(public.get_or_create_my_personal_room_v1() ->> 'visibility', 'friends', 'new rooms default to FRIENDS');
select is(public.get_or_create_my_personal_room_v1() ->> 'ownerUserId', 'a1000000-0000-4000-8000-0000000000a1', 'owner is auth.uid()');
select throws_ok($$select * from public.world_player_rooms$$, '42501', null, 'no direct table read');
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select set_config('housing.room_b', (public.get_or_create_my_personal_room_v1() ->> 'roomId'), true);
select isnt(current_setting('housing.room_b'), current_setting('housing.room_a'), 'one room per account');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.get_or_create_my_personal_room_v1()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guests cannot create a room');
select set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-0000000000e5","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.get_or_create_my_personal_room_v1()$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned accounts cannot create a room');
reset role;
select is((select count(*) from public.world_player_rooms where owner_user_id = 'a1000000-0000-4000-8000-0000000000a1'), 1::bigint, 'exactly one row for the owner');

-- ---- D2: friend resolver ----
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1') ->> 'roomId', current_setting('housing.room_a'), 'friend resolves the owner room');
select is(public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1') ->> 'ownerDisplayName', '방주인', 'resolver carries the public nickname');
select is(public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1') ->> 'role', 'visitor', 'resolver role is visitor');
select throws_ok($$select public.resolve_friend_personal_room_v1('f6000000-0000-4000-8000-0000000000f6')$$, 'P0002', 'ROOM_NOT_FOUND', 'friend without a room yet');
select throws_ok($$select public.resolve_friend_personal_room_v1('b2000000-0000-4000-8000-0000000000b2')$$, '22023', 'TARGET_UNAVAILABLE', 'own id is not a friend visit');
select throws_ok($$select public.resolve_friend_personal_room_v1('e5000000-0000-4000-8000-0000000000e5')$$, '22023', 'TARGET_UNAVAILABLE', 'banned owner is unavailable');
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1')$$, '42501', 'NOT_FRIENDS', 'stranger cannot resolve a room');
select throws_ok($$select public.resolve_friend_personal_room_v1('f6000000-0000-4000-8000-0000000000f6')$$, '42501', 'NOT_FRIENDS', 'stranger learns nothing about room existence');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'guests cannot visit');

-- ---- D2: access check (join + revalidation) ----
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'role', 'owner', 'owner access');
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'role', 'visitor', 'friend access on FRIENDS');
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid),
  jsonb_build_object('roomId', current_setting('housing.room_a')::uuid, 'allowed', false, 'role', null, 'reason', 'DENIED'),
  'knowing the room UUID grants a stranger nothing');
select is(public.check_world_room_access_v1('00000000-0000-4000-8000-000000000000') ->> 'reason', 'DENIED', 'unknown room is indistinguishable from a denied one');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'PERMANENT_ACCOUNT_REQUIRED', 'guest access check is closed');

-- ---- D2: owner privacy switch + consequences ----
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.set_my_personal_room_visibility_v1('public')$$, '22023', 'INVALID_VISIBILITY', 'PUBLIC is out of scope');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.set_my_personal_room_visibility_v1(null)$$, '22023', 'INVALID_VISIBILITY', 'null visibility rejected');
select is(public.set_my_personal_room_visibility_v1('private') ->> 'visibility', 'private', 'owner switches to PRIVATE');
select is(public.set_my_personal_room_visibility_v1('private') ->> 'roomId', current_setting('housing.room_a'), 'idempotent PRIVATE keeps the room');
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'role', 'owner', 'owner keeps access to a PRIVATE room');
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'ROOM_PRIVATE', 'friend loses access on PRIVATE');
select throws_ok($$select public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1')$$, '42501', 'ROOM_PRIVATE', 'resolver refuses a PRIVATE room');
select is(public.set_my_personal_room_visibility_v1('friends') ->> 'ownerUserId', 'b2000000-0000-4000-8000-0000000000b2', 'visibility RPC only ever touches the caller''s own room');
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select is(public.set_my_personal_room_visibility_v1('friends') ->> 'visibility', 'friends', 'owner reopens to FRIENDS');
select set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-0000000000f6","role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.set_my_personal_room_visibility_v1('private')$$, 'P0002', 'ROOM_NOT_FOUND', 'no room, nothing to switch');
reset role;

-- Block in either direction removes access.
insert into public.world_user_blocks(blocker_id, blocked_id) values ('a1000000-0000-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'DENIED', 'owner blocking the visitor removes access');
select throws_ok($$select public.resolve_friend_personal_room_v1('a1000000-0000-4000-8000-0000000000a1')$$, '42501', 'NOT_FRIENDS', 'blocked visitor cannot resolve');
reset role;
delete from public.world_user_blocks;
insert into public.world_user_blocks(blocker_id, blocked_id) values ('b2000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'DENIED', 'visitor blocking the owner removes access');
reset role;
delete from public.world_user_blocks;
-- Unfriend removes access.
delete from public.world_friendships where user_low = 'a1000000-0000-4000-8000-0000000000a1' and user_high = 'b2000000-0000-4000-8000-0000000000b2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'DENIED', 'unfriend removes access');
reset role;
insert into public.world_friendships(user_low, user_high, status, requested_by, accepted_at) values
 ('a1000000-0000-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000b2', 'accepted', 'a1000000-0000-4000-8000-0000000000a1', now());
-- A pending request is not friendship.
insert into public.world_friendships(user_low, user_high, status, requested_by) values
 ('a1000000-0000-4000-8000-0000000000a1', 'c3000000-0000-4000-8000-0000000000c3', 'pending', 'c3000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}', true);
select is(public.check_world_room_access_v1(current_setting('housing.room_a')::uuid) ->> 'reason', 'DENIED', 'pending friendship grants nothing');

-- ---- D2: Realtime topic predicate ----
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}', true);
select ok(public.can_access_world_room_realtime_v1('world:room:' || current_setting('housing.room_a')), 'owner may join the room channel');
select ok(not public.can_access_world_room_realtime_v1('world:room:' || upper(current_setting('housing.room_a'))), 'room topic grammar is exact (lower-case UUID)');
select ok(not public.can_access_world_room_realtime_v1('world:room:' || current_setting('housing.room_a') || ':x'), 'room topic is anchored');
select ok(not public.can_access_world_room_realtime_v1('world:campus:AREA_MAIN_HALL'), 'the room predicate never opens campus topics');
select ok(not public.can_access_world_room_realtime_v1(null), 'null topic closed');
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select ok(public.can_access_world_room_realtime_v1('world:room:' || current_setting('housing.room_a')), 'friend may join a FRIENDS room channel');
select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}', true);
select ok(not public.can_access_world_room_realtime_v1('world:room:' || current_setting('housing.room_a')), 'stranger with the UUID may not join');
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
select ok(not public.can_access_world_room_realtime_v1('world:room:' || current_setting('housing.room_a')), 'guest may not join a room channel');
reset role;

-- ---- Realtime RLS (stand-in when the Realtime service is absent, as in 60_world_online_realtime) ----
select set_config('world.realtime_stub', (to_regclass('realtime.messages') is null)::text, true);
do $$
begin
  if to_regclass('realtime.messages') is null then
    create schema if not exists realtime;
    create table realtime.messages (
      topic text not null,
      extension text not null,
      payload jsonb,
      event text,
      private boolean default false,
      updated_at timestamp not null default now(),
      inserted_at timestamp not null default now(),
      id uuid not null default gen_random_uuid()
    );
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert, update on realtime.messages to anon, authenticated;
    if to_regprocedure('realtime.topic()') is null then
      create function realtime.topic() returns text language sql stable
        as $body$ select nullif(current_setting('realtime.topic', true), '')::text; $body$;
      grant execute on function realtime.topic() to anon, authenticated;
    end if;
    perform private.install_world_online_realtime_policies();
  end if;
end;
$$;
select policies_are('realtime', 'messages',
  array['world online players read place zone', 'world online players write place zone'],
  'D2 keeps exactly the two world online policies');

select skip('real realtime.messages present; behaviour runs on the CI stand-in', 6)
where current_setting('world.realtime_stub') = 'false';
select set_config('housing.topic_a', 'world:room:' || current_setting('housing.room_a'), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}', true);
set local realtime.topic = 'world:campus:AREA_MAIN_HALL';
select lives_ok($$insert into realtime.messages(topic, extension, event) values ('world:campus:AREA_MAIN_HALL', 'presence', 'probe')$$,
  'guest campus presence still works after the D2 installer')
where current_setting('world.realtime_stub') = 'true';
select set_config('realtime.topic', current_setting('housing.topic_a'), true);
select throws_ok(format($$insert into realtime.messages(topic, extension, event) values (%L, 'presence', 'probe')$$, current_setting('housing.topic_a')),
  '42501', null, 'guest cannot track presence in a personal room')
where current_setting('world.realtime_stub') = 'true';

select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}', true);
select set_config('realtime.topic', current_setting('housing.topic_a'), true);
select lives_ok(format($$insert into realtime.messages(topic, extension, event) values (%L, 'broadcast', 'probe')$$, current_setting('housing.topic_a')),
  'friend broadcasts pose in the FRIENDS room')
where current_setting('world.realtime_stub') = 'true';
select is((select count(*) from realtime.messages where topic = current_setting('housing.topic_a')), 1::bigint,
  'friend receives the room channel')
where current_setting('world.realtime_stub') = 'true';

select set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}', true);
select set_config('realtime.topic', current_setting('housing.topic_a'), true);
select throws_ok(format($$insert into realtime.messages(topic, extension, event) values (%L, 'presence', 'probe')$$, current_setting('housing.topic_a')),
  '42501', null, 'stranger with the UUID cannot join the room channel')
where current_setting('world.realtime_stub') = 'true';
select is((select count(*) from realtime.messages where topic = current_setting('housing.topic_a')), 0::bigint,
  'stranger reads nothing from the room channel')
where current_setting('world.realtime_stub') = 'true';
reset role;

select * from finish();
rollback;

