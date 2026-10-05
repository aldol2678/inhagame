-- INHA WORLD moderation center P0.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
 ('aa100000-0000-4000-8000-000000000001','authenticated','authenticated','mod-report@example.test',now(),false),
 ('aa200000-0000-4000-8000-000000000002','authenticated','authenticated','mod-target@example.test',now(),false),
 ('aa300000-0000-4000-8000-000000000003','authenticated','authenticated','mod-admin@example.test',now(),false),
 ('aa400000-0000-4000-8000-000000000004','authenticated','authenticated','mod-gm2@example.test',now(),false);
insert into public.profiles(user_id,nickname,title,avatar_key,is_banned) values
 ('aa100000-0000-4000-8000-000000000001','신고자','', 'classic', false),
 ('aa200000-0000-4000-8000-000000000002','대상자','테스트', 'scholar', false),
 ('aa300000-0000-4000-8000-000000000003','관리자','GM', 'explorer', false),
 ('aa400000-0000-4000-8000-000000000004','GM2','사운드 GM', 'classic', false)
on conflict (user_id) do update set nickname=excluded.nickname,title=excluded.title,avatar_key=excluded.avatar_key,is_banned=false;

insert into public.world_user_reports(reporter_id,target_id,category,place_zone_id)
values ('aa100000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000002','harassment','AREA_MAIN_GATE');

select has_column('public','world_user_reports','status','reports have moderation status');
select has_column('public','world_user_reports','resolution','reports have resolution');
select is(
  (select status from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002' order by id desc limit 1),
  'pending','new report starts pending');

select throws_ok(
  $$select public.get_world_moderation_ops_v1('bad-token')$$,
  '42501','unauthorized','wrong OPS credential cannot read reports');

-- P1-S0: the token moderation RPCs are retired; the moderation lifecycle runs through account RBAC.
-- Calls below run as the test owner with the admin's request claims, so auth.uid() is the admin.
insert into private.world_staff_assignments(user_id,role,active)
values ('aa300000-0000-4000-8000-000000000003','world_admin',true)
on conflict (user_id) do update set role=excluded.role, active=true;
select set_config(
  'request.jwt.claims',
  '{"sub":"aa300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',
  true
);

select ok(
  (public.get_my_world_moderation_admin_v1()->'counts'->>'pending')::int >= 1,
  'OPS sees pending report');

select is(
  public.admin_review_world_user_report_v1((select max(id) from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002'), 'reviewing')->>'status',
  'reviewing','review can start');

select is(
  public.admin_review_world_user_report_v1((select max(id) from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002'), 'interaction_restriction_24h')->>'resolution',
  'interaction_restriction_24h','24h interaction restriction resolves report');

select ok(
  exists(
    select 1 from private.world_user_moderation_actions
    where target_id='aa200000-0000-4000-8000-000000000002'
      and action='interaction_restriction_24h'
      and ends_at > now()+interval '23 hours'
  ),
  'restriction action is active for roughly 24h');

select set_config(
  'request.jwt.claims',
  '{"sub":"aa200000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.get_my_world_social()$$,
  '42501','SOCIAL_RESTRICTED','restricted user cannot use DB-backed World interactions');
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"aa300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',
  true
);

select throws_ok(
  format('select public.admin_review_world_user_report_v1(%s,%L)', (select max(id) from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002'), 'warning'),
  '22023','REPORT_ALREADY_CLOSED','closed report cannot be moderated twice');

insert into public.world_user_reports(reporter_id,target_id,category,place_zone_id)
values ('aa100000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000002','spam','AREA_MAIN_GATE');

select is(
  public.admin_review_world_user_report_v1((select max(id) from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002'), 'dismissed')->>'status',
  'dismissed','operator can dismiss a report');

-- Account-based admin RBAC P0.
select has_table('private','world_staff_assignments','staff assignments exist');
select has_table('private','world_staff_role_permissions','role permissions exist');
select has_column('private','world_user_moderation_actions','actor_id','moderation actions record account actor');
select has_column('private','world_user_moderation_actions','actor_source','moderation actions record actor source');
select ok(
  (select relrowsecurity from pg_class where oid='private.world_staff_assignments'::regclass),
  'staff assignments use RLS defense in depth'
);
select ok(
  (select relrowsecurity from pg_class where oid='private.world_staff_role_permissions'::regclass),
  'staff role permissions use RLS defense in depth'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname='private'
      and tablename='world_user_moderation_actions'
      and indexname='world_user_moderation_actions_actor_idx'
  ),
  'admin actor audit lookups have a covering index'
);

insert into private.world_staff_assignments(user_id,role,active) values
 ('aa300000-0000-4000-8000-000000000003','world_admin',true),
 ('aa400000-0000-4000-8000-000000000004','world_admin',true)
on conflict (user_id) do update set role=excluded.role, active=true;

select set_config(
  'request.jwt.claims',
  '{"sub":"aa300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',
  true
);
set local role authenticated;

select is(
  public.get_my_world_admin_access_v1()->>'isAdmin',
  'true',
  'assigned world_admin account is recognized'
);
select ok(
  public.get_my_world_admin_access_v1()->'permissions' ? 'moderation.read',
  'admin access snapshot includes moderation.read'
);
select ok(
  public.get_my_world_admin_access_v1()->'permissions' ? 'ops.read',
  'admin access snapshot includes ops.read'
);
select ok(
  public.get_world_online_ops_v1(null) ? 'online',
  'account admin can read legacy World OPS metrics without the Basic credential'
);
select ok(
  (public.get_my_world_moderation_admin_v1()->'counts'->>'total')::int >= 2,
  'account admin can read moderation queue'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"aa400000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":false}',
  true
);
set local role authenticated;
select is(
  public.get_my_world_admin_access_v1()->>'isAdmin',
  'true',
  'second GM with world_admin role receives the same OPS access'
);
select ok(
  public.get_my_world_admin_access_v1()->'permissions' ? 'ops.read',
  'second GM receives ops.read'
);
select ok(
  public.get_my_world_admin_access_v1()->'permissions' ? 'moderation.restrict_24h',
  'second GM receives moderation capabilities'
);
reset role;

insert into public.world_user_reports(reporter_id,target_id,category,place_zone_id)
values ('aa100000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000002','harassment','AREA_MAIN_GATE');

select set_config(
  'request.jwt.claims',
  '{"sub":"aa300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}',
  true
);
create temp table mod_latest_report as
select max(id) as id from public.world_user_reports where target_id='aa200000-0000-4000-8000-000000000002';
grant select on mod_latest_report to authenticated;
set local role authenticated;

select is(
  public.admin_review_world_user_report_v1(
    (select id from mod_latest_report),
    'reviewing'
  )->>'status',
  'reviewing',
  'account admin can start report review'
);
select is(
  public.admin_review_world_user_report_v1(
    (select id from mod_latest_report),
    'warning'
  )->>'resolution',
  'warning',
  'account admin can issue warning'
);
reset role;

select ok(
  exists(
    select 1 from private.world_user_moderation_actions
    where actor_id='aa300000-0000-4000-8000-000000000003'
      and actor_source='account_admin'
      and action='warning'
  ),
  'account admin moderation action is attributable'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"aa100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.get_my_world_moderation_admin_v1()$$,
  '42501','ADMIN_PERMISSION_DENIED','ordinary member cannot read admin moderation queue');
select is(
  public.get_my_world_admin_access_v1()->>'isAdmin',
  'false',
  'ordinary member gets non-admin access snapshot'
);
reset role;

select * from finish();
rollback;
