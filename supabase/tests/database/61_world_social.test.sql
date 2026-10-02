-- INHA WORLD Social S1-C1 (migration 20260926030000): public card, friendships, blocks, reports.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a0000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'social-a@example.test', now(), false),
 ('b0000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'social-b@example.test', now(), false),
 ('c0000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'social-c@example.test', now(), false),
 ('d0000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', null, null, true),
 ('e0000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', 'social-e@example.test', now(), false);
insert into public.profiles(user_id, nickname, title, is_banned) values
 ('a0000000-0000-4000-8000-0000000000a1', '앨리스', '인덕 탐험가', false),
 ('b0000000-0000-4000-8000-0000000000b2', '밥돌', null, false),
 ('c0000000-0000-4000-8000-0000000000c3', '찰리', null, false),
 ('d0000000-0000-4000-8000-0000000000d4', '게스트', null, false),
 ('e0000000-0000-4000-8000-0000000000e5', '밴계정', null, true)
on conflict (user_id) do update set nickname = excluded.nickname, title = excluded.title, is_banned = excluded.is_banned;

-- ---------------------------------------------------------------- schema
select has_table('public', t, format('%s exists', t)) from unnest(array['world_friendships', 'world_user_blocks', 'world_user_reports']) t;
select ok((select relrowsecurity from pg_class where oid = format('public.%s', t)::regclass), format('%s has RLS', t))
from unnest(array['world_friendships', 'world_user_blocks', 'world_user_reports']) t;
select col_is_pk('public', 'world_friendships', array['user_low', 'user_high'], 'one row per unordered pair');
select throws_ok($$insert into public.world_friendships(user_low, user_high, status, requested_by)
  values ('b0000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-0000000000a1', 'pending', 'a0000000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'non-canonical (high, low) order rejected');
select throws_ok($$insert into public.world_friendships(user_low, user_high, status, requested_by)
  values ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'pending', 'a0000000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'self relationship rejected');
select throws_ok($$insert into public.world_friendships(user_low, user_high, status, requested_by)
  values ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b2', 'pending', 'c0000000-0000-4000-8000-0000000000c3')$$,
  '23514', null, 'requester must be a member');
select throws_ok($$insert into public.world_friendships(user_low, user_high, status, requested_by)
  values ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b2', 'accepted', 'a0000000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'accepted requires accepted_at');
select throws_ok($$insert into public.world_user_blocks(blocker_id, blocked_id)
  values ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1')$$, '23514', null, 'self block rejected');
select throws_ok($$insert into public.world_user_reports(reporter_id, target_id, category)
  values ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b2', 'rude')$$, '23514', null, 'category allowlist in the table');

-- ---------------------------------------------------------------- access boundary
set local role anon;
select throws_ok($$select public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')$$, '42501', null, 'anon cannot call social RPCs');
select throws_ok($$select public.report_world_user('b0000000-0000-4000-8000-0000000000b2', 'spam', null)$$, '42501', null, 'anon cannot report');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous (guest) accounts cannot befriend');
select throws_ok($$select public.get_my_world_social()$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED', 'anonymous accounts have no social list');

set local request.jwt.claims = '{"sub":"e0000000-0000-4000-8000-0000000000e5","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.send_world_friend_request('a0000000-0000-4000-8000-0000000000a1')$$, '42501', 'ACCOUNT_UNAVAILABLE', 'banned accounts cannot act');

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.send_world_friend_request('e0000000-0000-4000-8000-0000000000e5')$$, '22023', 'TARGET_UNAVAILABLE', 'banned targets are unavailable');
select throws_ok($$select public.send_world_friend_request('a0000000-0000-4000-8000-0000000000a1')$$, '22023', 'TARGET_UNAVAILABLE', 'no request to self');
select throws_ok($$select public.get_world_public_profile('e0000000-0000-4000-8000-0000000000e5')$$, '22023', 'TARGET_UNAVAILABLE', 'banned profile not shown');
select throws_ok($$select * from public.world_friendships$$, '42501', null, 'no direct friendship reads');
select throws_ok($$insert into public.world_friendships(user_low, user_high, status, requested_by)
  values ('a0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000c3', 'accepted', 'a0000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'no direct friendship writes');
select throws_ok($$select * from public.world_user_blocks$$, '42501', null, 'no direct block reads');
select throws_ok($$select * from public.world_user_reports$$, '42501', null, 'reports are not readable by players');

-- ---------------------------------------------------------------- public card allowlist
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_world_public_profile('b0000000-0000-4000-8000-0000000000b2')) k),
  array['available', 'avatar', 'inhaVerified', 'nickname', 'relationship', 'title', 'userId'], 'card carries only allowlisted fields');
select is(public.get_world_public_profile('b0000000-0000-4000-8000-0000000000b2')->>'nickname', '밥돌');
select is(public.get_world_public_profile('b0000000-0000-4000-8000-0000000000b2')->>'inhaVerified', 'false',
  'Inha verification is a safe public boolean');
select ok(not (public.get_world_public_profile('b0000000-0000-4000-8000-0000000000b2')::text ~ '(department|joined|created|email|game|banned)'),
  'no private profile data in the card');

-- ---------------------------------------------------------------- request / idempotency / crossed
select is(public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'outgoing', 'A requests B');
select is(public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'outgoing', 'double click is idempotent');
select is(public.respond_world_friend_request('b0000000-0000-4000-8000-0000000000b2', true)->>'relationship', 'outgoing', 'requester cannot accept their own request');
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}';
select is(public.respond_world_friend_request('a0000000-0000-4000-8000-0000000000a1', true)->>'relationship', 'none', 'an unrelated user cannot accept A↔B');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.get_world_relationship('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'incoming', 'B sees an incoming request');
select is(public.send_world_friend_request('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'incoming', 'crossed request does not auto-accept');
select is(jsonb_array_length(public.get_my_world_social()->'incoming'), 1, 'B lists the incoming request');
reset role;
select is((select count(*) from public.world_friendships), 1::bigint, 'still exactly one pair row');
select is((select status from public.world_friendships), 'pending');

-- ---------------------------------------------------------------- accept / remove / reject / cancel
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.respond_world_friend_request('a0000000-0000-4000-8000-0000000000a1', true)->>'relationship', 'friends', 'recipient accepts');
select is(public.respond_world_friend_request('a0000000-0000-4000-8000-0000000000a1', true)->>'relationship', 'friends', 'accept twice is safe');
select is((public.get_my_world_social()->'friends'->0->>'nickname'), '앨리스', 'friend list shows A');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is((public.get_my_world_social()->'friends'->0->>'nickname'), '밥돌', 'both lists agree');
select is(public.remove_world_friend('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'none', 'remove friend');
select is(public.remove_world_friend('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'none', 'remove twice is safe');
select is(public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'outgoing');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.cancel_world_friend_request('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'incoming', 'recipient cannot cancel the sender''s request');
select is(public.respond_world_friend_request('a0000000-0000-4000-8000-0000000000a1', false)->>'relationship', 'none', 'recipient rejects');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is(public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'outgoing');
select is(public.cancel_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'none', 'sender cancels');

-- ---------------------------------------------------------------- block / unblock
select is(public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'outgoing');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.respond_world_friend_request('a0000000-0000-4000-8000-0000000000a1', true)->>'relationship', 'friends');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is(public.block_world_user('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'blocked_by_me', 'A blocks B');
select is(public.get_world_public_profile('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'blocked_by_me');
select throws_ok($$select public.send_world_friend_request('b0000000-0000-4000-8000-0000000000b2')$$, '42501', 'NOT_ALLOWED', 'blocker cannot friend while blocked');
select is(jsonb_array_length(public.get_my_world_social()->'blocked'), 1, 'A sees whom A blocked');
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":false}';
select is(public.get_world_relationship('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'unavailable', 'B only sees a generic unavailable state');
select is(public.get_world_public_profile('a0000000-0000-4000-8000-0000000000a1')->>'available', 'false', 'blocked side gets no card details');
select ok(not (public.get_world_public_profile('a0000000-0000-4000-8000-0000000000a1')::text ~ '(block|nickname)'), 'no "blocked you" wording, no card');
select throws_ok($$select public.send_world_friend_request('a0000000-0000-4000-8000-0000000000a1')$$, '42501', 'NOT_ALLOWED', 'blocked user cannot send a request');
select is(jsonb_array_length(public.get_my_world_social()->'friends'), 0, 'block ended the friendship');
select is(jsonb_array_length(public.get_my_world_social()->'blocked'), 0, 'who blocked me is never listed');
select is(public.unblock_world_user('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'unavailable', 'non-blocker cannot lift the block');
reset role;
select is((select count(*) from public.world_friendships), 0::bigint, 'no friendship row while blocked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is(public.unblock_world_user('b0000000-0000-4000-8000-0000000000b2')->>'relationship', 'none', 'blocker unblocks → NONE, friendship not restored');
-- Mutual blocks stay independent.
select is(public.block_world_user('c0000000-0000-4000-8000-0000000000c3')->>'relationship', 'blocked_by_me');
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}';
select is(public.block_world_user('a0000000-0000-4000-8000-0000000000a1')->>'relationship', 'blocked_by_me', 'C blocks A too');
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":false}';
select is(public.unblock_world_user('c0000000-0000-4000-8000-0000000000c3')->>'relationship', 'unavailable', 'A unblocking keeps C''s own block');

-- ---------------------------------------------------------------- reports
select is(public.report_world_user('b0000000-0000-4000-8000-0000000000b2', 'spam', 'AREA_INKYUNG_STUDENT_CENTER')->>'status', 'received', 'report stored');
select is(public.report_world_user('b0000000-0000-4000-8000-0000000000b2', 'spam', 'AREA_INKYUNG_STUDENT_CENTER')->>'status', 'duplicate', 'duplicate within 24 h');
select throws_ok($$select public.report_world_user('a0000000-0000-4000-8000-0000000000a1', 'spam', null)$$, '22023', 'CANNOT_REPORT_SELF', 'no self report');
select throws_ok($$select public.report_world_user('b0000000-0000-4000-8000-0000000000b2', 'rude', null)$$, '22023', 'INVALID_CATEGORY', 'category allowlist');
select throws_ok($$select public.report_world_user('b0000000-0000-4000-8000-0000000000b2', 'other', 'RC_0_0')$$, '22023', 'INVALID_PLACE_ZONE', 'semantic AREA ids only');
select throws_ok($$select public.report_world_user('f0000000-0000-4000-8000-0000000000f6', 'other', null)$$, '22023', 'TARGET_UNAVAILABLE', 'target must be a real account');
reset role;
select is((select count(*) from public.world_user_reports), 1::bigint);
select is((select array[category, place_zone_id] from public.world_user_reports), array['spam', 'AREA_INKYUNG_STUDENT_CENTER'], 'structured row, no free text');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'world_user_reports'
  and column_name ~ '(text|message|body|chat|comment)'), 0::bigint, 'no free-text or chat column on reports');
insert into public.world_user_reports(reporter_id, target_id, category)
select 'c0000000-0000-4000-8000-0000000000c3', 'b0000000-0000-4000-8000-0000000000b2', c
from unnest(array['spam','harassment','inappropriate_name','other','spam','harassment','inappropriate_name','other','spam','other']) c;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.report_world_user('a0000000-0000-4000-8000-0000000000a1', 'other', null)$$, '54000', 'RATE_LIMITED', '10 reports per hour per reporter');
reset role;

-- ---------------------------------------------------------------- private helpers stay private
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r, unnest(array[
  'private.world_social_caller()', 'private.world_social_target(uuid,uuid)', 'private.world_relationship(uuid,uuid)',
  'private.world_lock_pair(uuid,uuid)', 'private.world_card(uuid)']) f;

select * from finish();
rollback;
