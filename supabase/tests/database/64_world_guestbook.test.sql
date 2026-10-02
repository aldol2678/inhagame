-- INHA WORLD Guestbook P1: multiple posts, rate limits, ownership, profile link fields.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guestbook-a@example.test', now(), false),
 ('f2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'guestbook-b@inha.edu', now(), false),
 ('f3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', null, null, true);
insert into public.profiles(user_id, nickname, title, avatar_key, is_banned) values
 ('f1000000-0000-4000-8000-000000000001', '방명A', '방문자', 'classic', false),
 ('f2000000-0000-4000-8000-000000000002', '방명B', '인하인', 'scholar', false),
 ('f3000000-0000-4000-8000-000000000003', '게스트', null, 'classic', false)
on conflict (user_id) do update set
 nickname=excluded.nickname, title=excluded.title, avatar_key=excluded.avatar_key, is_banned=excluded.is_banned;

create temp table guestbook_test_ids(label text primary key, id uuid);
grant all on table guestbook_test_ids to authenticated;

-- Exposed table is RPC-only in P1.
set local role anon;
select throws_ok($$select public.get_world_guestbook_v2('main_gate',20,null)$$, '42501', null, 'anon cannot read guestbook RPC');
select throws_ok($$select public.create_world_guestbook_entry_v2('x','main_gate')$$, '42501', null, 'anon cannot create');

set local role authenticated;
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.get_world_guestbook_v2('main_gate',20,null)$$, '42501', 'PERMANENT_ACCOUNT_REQUIRED',
  'anonymous accounts cannot read the guestbook');

set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select * from public.world_guestbook_entries$$, '42501', null, 'no direct guestbook reads');
select throws_ok($$insert into public.world_guestbook_entries(user_id,location_key,content)
 values ('f1000000-0000-4000-8000-000000000001','main_gate','direct')$$, '42501', null, 'no direct guestbook inserts');
select throws_ok($$delete from public.world_guestbook_entries where user_id='f1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'no direct guestbook deletes');

insert into guestbook_test_ids
select 'a1', (public.create_world_guestbook_entry_v2('첫 글','main_gate')->>'id')::uuid;
select throws_ok($$select public.create_world_guestbook_entry_v2('너무 빠른 글','main_gate')$$,
  'P0001', 'GUESTBOOK_COOLDOWN', '60-second cooldown enforced');

reset role;
update private.world_guestbook_post_log
set created_at = now() - interval '61 seconds'
where user_id='f1000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
insert into guestbook_test_ids
select 'a2', (public.create_world_guestbook_entry_v2('둘째 글','main_gate')->>'id')::uuid;

reset role;
update private.world_guestbook_post_log
set created_at = now() - interval '61 seconds'
where user_id='f1000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
insert into guestbook_test_ids
select 'a3', (public.create_world_guestbook_entry_v2('셋째 글','main_gate')->>'id')::uuid;

select is((public.get_world_guestbook_v2('main_gate',20,null)->>'dailyUsed')::int, 3, 'three posts count against today');
select is((public.get_world_guestbook_v2('main_gate',20,null)->>'dailyRemaining')::int, 0, 'daily remaining reaches zero');
select throws_ok($$select public.create_world_guestbook_entry_v2('넷째 글','main_gate')$$,
  'P0001', 'DAILY_LIMIT_REACHED', 'fourth post is rejected');

select is(public.update_world_guestbook_entry_v2(
  (select id from guestbook_test_ids where label='a1'), '첫 글 수정')->>'content',
  '첫 글 수정', 'owner can edit any own entry');

select ok(public.delete_world_guestbook_entry_v2(
  (select id from guestbook_test_ids where label='a2')), 'owner can delete an own entry');
select is((public.get_world_guestbook_v2('main_gate',20,null)->>'dailyRemaining')::int, 0,
  'deleting a post does not refund the daily quota');

-- A second author can post independently and exposes only safe profile fields.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
insert into guestbook_test_ids
select 'b1', (public.create_world_guestbook_entry_v2('B의 글','main_gate')->>'id')::uuid;

select is(
  (select e->>'inhaVerified'
   from jsonb_array_elements(public.get_world_guestbook_v2('main_gate',20,null)->'entries') e
   where e->>'userId'='f2000000-0000-4000-8000-000000000002'
   limit 1),
  'true', 'Inha verification is exposed as a safe guestbook/profile flag');

set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok(
  format('select public.update_world_guestbook_entry_v2(%L::uuid, %L)',
    (select id::text from guestbook_test_ids where label='b1'), '남의 글 수정'),
  '22023', 'ENTRY_UNAVAILABLE', 'cannot edit another user entry');
select throws_ok(
  format('select public.delete_world_guestbook_entry_v2(%L::uuid)',
    (select id::text from guestbook_test_ids where label='b1')),
  '22023', 'ENTRY_UNAVAILABLE', 'cannot delete another user entry');

select * from finish();
rollback;
