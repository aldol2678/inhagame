-- P1-S0 · OPS auth emergency hardening (F-01).
-- A: anon denied · B: ordinary account denied · C: staff with ops.read reads OPS
-- D: moderation actions follow per-action permissions · E: a leaked Basic digest authenticates nothing.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures. 'world_admin' holds every OPS permission (production mapping); 'sound_gm' gets a
-- read/review-only grant inside this rolled-back transaction to model a partially permitted staff.
insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('8a000000-0000-4000-8000-000000000001','authenticated','authenticated','p1s0-member@example.test',now(),false),
 ('8a000000-0000-4000-8000-000000000002','authenticated','authenticated','p1s0-admin@example.test',now(),false),
 ('8a000000-0000-4000-8000-000000000003','authenticated','authenticated','p1s0-reviewer@example.test',now(),false),
 ('8a000000-0000-4000-8000-000000000004','authenticated','authenticated','p1s0-target@example.test',now(),false),
 ('8a000000-0000-4000-8000-000000000005','authenticated','authenticated',null,null,true);
insert into public.profiles(user_id,nickname,title,avatar_key,is_banned) values
 ('8a000000-0000-4000-8000-000000000001','일반회원','', 'classic', false),
 ('8a000000-0000-4000-8000-000000000002','운영자','GM', 'explorer', false),
 ('8a000000-0000-4000-8000-000000000003','검토자','', 'classic', false),
 ('8a000000-0000-4000-8000-000000000004','대상자','', 'scholar', false),
 ('8a000000-0000-4000-8000-000000000005','게스트','', 'classic', false)
on conflict (user_id) do update set nickname=excluded.nickname,is_banned=false;
insert into private.world_staff_assignments(user_id,role,active) values
 ('8a000000-0000-4000-8000-000000000002','world_admin',true),
 ('8a000000-0000-4000-8000-000000000003','sound_gm',true);
insert into private.world_staff_role_permissions(role,permission) values
 ('sound_gm','moderation.read'),('sound_gm','moderation.review')
on conflict do nothing;
insert into public.world_user_reports(reporter_id,target_id,category,place_zone_id) values
 ('8a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000004','harassment','AREA_MAIN_GATE');

-- Report id readable by every role used below (the report table itself is not client-readable).
create temp table p1s0_report as
select max(id) as id from public.world_user_reports where target_id='8a000000-0000-4000-8000-000000000004';
grant select on p1s0_report to anon, authenticated;

-- E (setup): a digest row like the one that leaked. Nothing may accept it.
insert into public.inha_duck_ops_auth_state(auth_key,basic_sha256)
values ('owner_basic', repeat('ab',32))
on conflict (auth_key) do update set basic_sha256=excluded.basic_sha256;

-- Grant surface (catalog readback).
select ok(not has_function_privilege('anon', f::regprocedure, 'execute'), 'anon cannot execute '||f)
from unnest(array[
  'public.verify_inha_duck_ops_basic_v1(text,text)',
  'public.get_inha_duck_ops_private_v1(text)',
  'public.get_inha_duck_ops_core_private_v1(text)',
  'public.get_world_moderation_ops_v1(text)',
  'public.review_world_user_report_ops_v1(text,bigint,text)',
  'public.get_world_online_ops_v1(text)',
  'public.get_inhagame_member_ops_v1(text)',
  'public.get_inhagame_member_activity_ops_v1(text)'
]) f;
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot execute '||f)
from unnest(array[
  'public.verify_inha_duck_ops_basic_v1(text,text)',
  'public.get_inha_duck_ops_private_v1(text)',
  'public.get_world_moderation_ops_v1(text)',
  'public.review_world_user_report_ops_v1(text,bigint,text)',
  'public.get_world_online_ops_v1(text)',
  'public.get_inhagame_member_ops_v1(text)',
  'public.get_inhagame_member_activity_ops_v1(text)'
]) f;
select ok(not has_function_privilege('authenticated', f::regprocedure, 'execute'), 'authenticated cannot execute retired '||f)
from unnest(array[
  'public.verify_inha_duck_ops_basic_v1(text,text)',
  'public.get_world_moderation_ops_v1(text)',
  'public.review_world_user_report_ops_v1(text,bigint,text)'
]) f;
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'
      and pg_get_functiondef(p.oid) ~ 'inha_duck_ops_auth_state'),
  'no function reads the retired OPS credential table');

-- E: the leaked digest is useless, even with the row present and even for privileged callers.
select ok(not private.inha_duck_ops_credential_valid_v1(repeat('ab',32)), 'credential helper rejects the stored digest');
select ok(not private.inha_duck_ops_basic_digest_valid_v1(repeat('ab',32)), 'digest helper rejects the stored digest');
select ok(not public.verify_inha_duck_ops_basic_v1(repeat('ab',32), repeat('ab',32)), 'Basic verifier rejects the stored digest');
select throws_ok(format('select public.get_world_online_ops_v1(%L)', repeat('ab',32)),
  '42501', null, 'digest without a staff session cannot read World OPS');
select throws_ok(format('select public.get_inha_duck_ops_private_v1(%L)', repeat('ab',32)),
  '42501', null, 'digest without a staff session cannot read Classic OPS');
select throws_ok(format('select public.get_world_moderation_ops_v1(%L)', repeat('ab',32)),
  '42501', null, 'digest cannot read the moderation queue');
select throws_ok(format('select public.review_world_user_report_ops_v1(%L,%s,%L)', repeat('ab',32),
    (select id from p1s0_report), 'dismissed'),
  '42501', null, 'digest cannot mutate moderation');

-- A: anon.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(format('select public.get_world_online_ops_v1(%L)', repeat('ab',32)), '42501', null, 'anon: World OPS read denied');
select throws_ok(format('select public.get_inhagame_member_ops_v1(%L)', repeat('ab',32)), '42501', null, 'anon: member OPS read denied');
select throws_ok(format('select public.get_inhagame_member_activity_ops_v1(%L)', repeat('ab',32)), '42501', null, 'anon: member activity OPS read denied');
select throws_ok(format('select public.get_inha_duck_ops_private_v1(%L)', repeat('ab',32)), '42501', null, 'anon: Classic OPS read denied');
select throws_ok(format('select public.verify_inha_duck_ops_basic_v1(%L,%L)', repeat('ab',32), repeat('ab',32)), '42501', null, 'anon: Basic verifier denied');
select throws_ok(format('select public.get_world_moderation_ops_v1(%L)', repeat('ab',32)), '42501', null, 'anon: moderation read denied');
select throws_ok(format('select public.review_world_user_report_ops_v1(%L,1,%L)', repeat('ab',32), 'dismissed'), '42501', null, 'anon: moderation mutation denied');
select throws_ok($$select public.get_my_world_moderation_admin_v1()$$, '42501', null, 'anon: account moderation read denied');
select throws_ok($$select public.admin_review_world_user_report_v1(1,'dismissed')$$, '42501', null, 'anon: account moderation mutation denied');
reset role;

-- B: ordinary signed-in account (and an anonymous guest session).
select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select throws_ok(format('select public.get_world_online_ops_v1(%L)', repeat('ab',32)), '42501', 'unauthorized', 'member: World OPS read denied');
select throws_ok($$select public.get_inhagame_member_ops_v1(null)$$, '42501', 'unauthorized', 'member: member OPS read denied');
select throws_ok($$select public.get_inhagame_member_activity_ops_v1(null)$$, '42501', 'unauthorized', 'member: member activity OPS read denied');
select throws_ok($$select public.get_inha_duck_ops_private_v1(null)$$, '42501', 'unauthorized', 'member: Classic OPS read denied');
select throws_ok(format('select public.get_world_moderation_ops_v1(%L)', repeat('ab',32)), '42501', null, 'member: token moderation read denied');
select throws_ok(format('select public.review_world_user_report_ops_v1(%L,1,%L)', repeat('ab',32), 'dismissed'), '42501', null, 'member: token moderation mutation denied');
select throws_ok($$select public.get_my_world_moderation_admin_v1()$$, '42501', 'ADMIN_PERMISSION_DENIED', 'member: account moderation read denied');
select throws_ok(format('select public.admin_review_world_user_report_v1(%s,%L)',
    (select id from p1s0_report), 'dismissed'),
  '42501', 'ADMIN_PERMISSION_DENIED', 'member: account moderation mutation denied');
select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000005","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.get_world_online_ops_v1(null)$$, '42501', 'unauthorized', 'guest session: World OPS read denied');
reset role;

-- C: staff with ops.read.
select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select ok(public.get_world_online_ops_v1(null) ? 'online', 'staff with ops.read reads World OPS');
select ok(public.get_inhagame_member_ops_v1(null) ? 'members', 'staff with ops.read reads member OPS');
select ok(public.get_inhagame_member_activity_ops_v1(null) ? 'dau', 'staff with ops.read reads member activity OPS');
select ok(public.get_inha_duck_ops_private_v1(null) ? 'ops', 'staff with ops.read reads Classic OPS');
select ok((public.get_my_world_moderation_admin_v1()->'counts'->>'total')::int >= 1, 'staff with moderation.read reads the queue');
select throws_ok($$select public.get_world_moderation_ops_v1(null)$$, '42501', null, 'staff still cannot use the retired token moderation RPC');
reset role;

-- D: staff without ops.read / moderation.warn.
select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select throws_ok($$select public.get_world_online_ops_v1(null)$$, '42501', 'unauthorized', 'staff without ops.read cannot read OPS');
select ok((public.get_my_world_moderation_admin_v1()->'counts'->>'total')::int >= 1, 'staff with moderation.read reads the queue');
select is(
  public.admin_review_world_user_report_v1(
    (select id from p1s0_report), 'reviewing')->>'status',
  'reviewing', 'staff with moderation.review can start review');
select throws_ok(format('select public.admin_review_world_user_report_v1(%s,%L)',
    (select id from p1s0_report), 'warning'),
  '42501', 'ADMIN_PERMISSION_DENIED', 'staff without moderation.warn cannot warn');
select throws_ok(format('select public.admin_review_world_user_report_v1(%s,%L)',
    (select id from p1s0_report), 'interaction_restriction_24h'),
  '42501', 'ADMIN_PERMISSION_DENIED', 'staff without moderation.restrict_24h cannot restrict');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select is(
  public.admin_review_world_user_report_v1(
    (select id from p1s0_report), 'warning')->>'resolution',
  'warning', 'staff with moderation.warn can warn');
reset role;

-- Inactive or banned staff lose access.
update private.world_staff_assignments set active=false where user_id='8a000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims',
  '{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}', true);
set local role authenticated;
select throws_ok($$select public.get_world_online_ops_v1(null)$$, '42501', 'unauthorized', 'deactivated staff cannot read OPS');
reset role;

select * from finish();
rollback;
