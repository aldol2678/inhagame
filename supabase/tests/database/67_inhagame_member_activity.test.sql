-- INHAGAME shared member activity P1.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- OPS reads require a signed-in staff account with ops.read (P1-S0). ops_staff_session() switches the
-- request claims to that account and returns the now-ignored p_token argument (null).
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('5f000000-0000-4000-8000-000000000067','authenticated','authenticated','ops-staff-67@example.test',now(),false,now());
insert into public.profiles(user_id,nickname,title,avatar_key,is_banned)
values ('5f000000-0000-4000-8000-000000000067','OPS staff','', 'classic', false)
on conflict (user_id) do update set is_banned=false;
insert into private.world_staff_assignments(user_id,role,active) values ('5f000000-0000-4000-8000-000000000067','world_admin',true);
create function pg_temp.ops_staff_session() returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5f000000-0000-4000-8000-000000000067","role":"authenticated","is_anonymous":false}', true);
  return null;
end
$f$;

select has_table('private','inhagame_member_activity_daily','activity ledger exists');
select has_function('public','touch_inhagame_member_activity_v1',array['text'],'member activity touch RPC exists');
select has_function('public','get_inhagame_member_activity_ops_v1',array['text'],'member activity OPS RPC exists');

create temp table activity_baseline as
select public.get_inhagame_member_activity_ops_v1(
  pg_temp.ops_staff_session()
) as j;

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('da100000-0000-4000-8000-000000000001','authenticated','authenticated','activity-new@example.test',now(),false,now()),
 ('da200000-0000-4000-8000-000000000002','authenticated','authenticated','activity-return@example.test',now(),false,now()-interval '3 days'),
 ('da300000-0000-4000-8000-000000000003','authenticated','authenticated',null,null,true,now());

set local role authenticated;
set local request.jwt.claims='{"sub":"da100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select lives_ok(
  $$select public.touch_inhagame_member_activity_v1('hub')$$,
  'new permanent member can touch hub activity');
select lives_ok(
  $$select public.touch_inhagame_member_activity_v1('world')$$,
  'same member can add a second surface without another daily row');
select throws_ok(
  $$select public.touch_inhagame_member_activity_v1('spaceship')$$,
  '22023','INVALID_ACTIVITY_SURFACE','unknown surface is rejected');

set local request.jwt.claims='{"sub":"da200000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select lives_ok(
  $$select public.touch_inhagame_member_activity_v1('classic')$$,
  'returning permanent member can touch activity');

set local request.jwt.claims='{"sub":"da300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.touch_inhagame_member_activity_v1('world')$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED','anonymous Auth user cannot enter member activity');
reset role;

select is(
  (select count(*)::int from private.inhagame_member_activity_daily
   where user_id='da100000-0000-4000-8000-000000000001'),
  1,'multiple surfaces still produce one row per member per KST date');

select is(
  (select surfaces from private.inhagame_member_activity_daily
   where user_id='da100000-0000-4000-8000-000000000001'),
  array['hub','world']::text[],
  'daily row remembers distinct surfaces');

select is(
  (public.get_inhagame_member_activity_ops_v1(
    pg_temp.ops_staff_session())->>'dau')::int,
  (select (j->>'dau')::int+2 from activity_baseline),
  'DAU increases once for each permanent active member');

select is(
  (public.get_inhagame_member_activity_ops_v1(
    pg_temp.ops_staff_session())->>'todayNewActive')::int,
  (select (j->>'todayNewActive')::int+1 from activity_baseline),
  'today new active distinguishes the new member');

select is(
  (public.get_inhagame_member_activity_ops_v1(
    pg_temp.ops_staff_session())->>'todayReturning')::int,
  (select (j->>'todayReturning')::int+1 from activity_baseline),
  'today returning distinguishes the older member');

select is(
  jsonb_array_length(public.get_inhagame_member_activity_ops_v1(
    pg_temp.ops_staff_session())->'daily14'),
  14,'activity trend always has fourteen KST dates');

select ok(
  not has_table_privilege('authenticated','private.inhagame_member_activity_daily','select'),
  'authenticated users cannot read the raw activity ledger');

select set_config('request.jwt.claims','{}',true);
select throws_ok(
  $$select public.get_inhagame_member_activity_ops_v1('bad-token')$$,
  '42501','unauthorized','wrong OPS credential cannot read member activity aggregates');

select * from finish();
rollback;
