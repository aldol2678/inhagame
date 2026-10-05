-- INHAGAME member statistics OPS P0.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- OPS reads require a signed-in staff account with ops.read (P1-S0). ops_staff_session() switches the
-- request claims to that account and returns the now-ignored p_token argument (null).
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('5f000000-0000-4000-8000-000000000066','authenticated','authenticated','ops-staff-66@example.test',now(),false,now());
insert into public.profiles(user_id,nickname,title,avatar_key,is_banned)
values ('5f000000-0000-4000-8000-000000000066','OPS staff','', 'classic', false)
on conflict (user_id) do update set is_banned=false;
insert into private.world_staff_assignments(user_id,role,active) values ('5f000000-0000-4000-8000-000000000066','world_admin',true);
create function pg_temp.ops_staff_session() returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5f000000-0000-4000-8000-000000000066","role":"authenticated","is_anonymous":false}', true);
  return null;
end
$f$;

create temp table member_ops_baseline as
select
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'members')::int as members,
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'inhaVerified')::int as verified,
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'todayNew')::int as today_new,
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'last7dNew')::int as last7_new,
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'last30dNew')::int as last30_new;

select has_function('public','get_inhagame_member_ops_v1',array['text'],'member OPS RPC exists');

select set_config('request.jwt.claims','{}',true);
select throws_ok(
  $$select public.get_inhagame_member_ops_v1('bad-token')$$,
  '42501','unauthorized','wrong OPS credential cannot read member stats');

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at) values
 ('cc100000-0000-4000-8000-000000000001','authenticated','authenticated','member-one@inha.edu',now(),false,now()),
 ('cc200000-0000-4000-8000-000000000002','authenticated','authenticated','member-two@example.test',now(),false,now()),
 ('cc300000-0000-4000-8000-000000000003','authenticated','authenticated','anonymous@inha.edu',now(),true,now());

insert into public.inha_mail_badges(user_id,email,verified_at) values
 ('cc200000-0000-4000-8000-000000000002','member-two@inha.ac.kr',now()),
 ('cc300000-0000-4000-8000-000000000003','anonymous-linked@inha.edu',now());

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'members')::int,
  (select members+2 from member_ops_baseline),
  'only permanent users increase member count');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'inhaVerified')::int,
  (select verified+2 from member_ops_baseline),
  'direct Inha login email and linked Inha badge both count');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'unverified')::int,
  (select (members+2)-(verified+2) from member_ops_baseline),
  'unverified is derived from permanent members');

select ok(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'verificationRatePct')::numeric >= 0,
  'verification rate is present');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'todayNew')::int,
  (select today_new+2 from member_ops_baseline),
  'two new permanent users appear in today growth');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'last7dNew')::int,
  (select last7_new+2 from member_ops_baseline),
  'seven-day new-member count includes new permanent users');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->>'last30dNew')::int,
  (select last30_new+2 from member_ops_baseline),
  'thirty-day new-member count includes new permanent users');

select is(
  jsonb_array_length(public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->'daily14'),
  14,
  'daily growth series always returns 14 KST dates');

select is(
  (public.get_inhagame_member_ops_v1(pg_temp.ops_staff_session())->'daily14'->13->>'cumulativeMembers')::int,
  (select members+2 from member_ops_baseline),
  'last growth point equals current member total');

select * from finish();
rollback;
