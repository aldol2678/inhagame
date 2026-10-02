-- INHAGAME account deletion P0 contract.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_function(
  'public','delete_my_inhagame_account_v1',array['text'],
  'self-service account deletion RPC exists'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,last_sign_in_at) values
 ('de100000-0000-4000-8000-000000000001','authenticated','authenticated','delete-ok@example.test',now(),false,now()-interval '2 days',now()),
 ('de200000-0000-4000-8000-000000000002','authenticated','authenticated','delete-stale@example.test',now(),false,now()-interval '2 days',now()-interval '1 hour'),
 ('de300000-0000-4000-8000-000000000003','authenticated','authenticated','delete-staff@example.test',now(),false,now()-interval '2 days',now()),
 ('de400000-0000-4000-8000-000000000004','authenticated','authenticated',null,null,true,now(),now());

insert into public.profiles(user_id,nickname) values
 ('de100000-0000-4000-8000-000000000001','삭제테스트'),
 ('de200000-0000-4000-8000-000000000002','오래된세션'),
 ('de300000-0000-4000-8000-000000000003','운영자테스트'),
 ('de400000-0000-4000-8000-000000000004','게스트삭제')
on conflict (user_id) do nothing;

insert into private.world_staff_assignments(user_id,role,active)
values ('de300000-0000-4000-8000-000000000003','world_admin',true)
on conflict (user_id) do update set active=true, role='world_admin';

insert into public.players(id,auth_user_id,visitor_id)
values (
 'de110000-0000-4000-8000-000000000011',
 'de100000-0000-4000-8000-000000000001',
 'de120000-0000-4000-8000-000000000012'
);

insert into public.player_identity_links(visitor_id,auth_user_id,canonical_player_id)
values (
 'de120000-0000-4000-8000-000000000012',
 'de100000-0000-4000-8000-000000000001',
 'de110000-0000-4000-8000-000000000011'
);

set local role anon;
select throws_ok(
  $$select public.delete_my_inhagame_account_v1('탈퇴')$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED',
  'anonymous callers cannot delete accounts'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"de400000-0000-4000-8000-000000000004","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.delete_my_inhagame_account_v1('탈퇴')$$,
  '42501','PERMANENT_ACCOUNT_REQUIRED',
  'anonymous Auth users cannot delete through member flow'
);

set local request.jwt.claims='{"sub":"de100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.delete_my_inhagame_account_v1('삭제')$$,
  '22023','CONFIRMATION_REQUIRED',
  'exact confirmation phrase is required'
);

set local request.jwt.claims='{"sub":"de200000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.delete_my_inhagame_account_v1('탈퇴')$$,
  '42501','ACCOUNT_REAUTH_REQUIRED',
  'stale login must re-authenticate before deletion'
);

set local request.jwt.claims='{"sub":"de300000-0000-4000-8000-000000000003","role":"authenticated","is_anonymous":false}';
select throws_ok(
  $$select public.delete_my_inhagame_account_v1('탈퇴')$$,
  '42501','STAFF_ACCOUNT_DELETION_BLOCKED',
  'active staff account cannot self-delete'
);

set local request.jwt.claims='{"sub":"de100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
select is(
  public.delete_my_inhagame_account_v1('탈퇴')->>'deleted',
  'true',
  'recently authenticated member can delete own account'
);
reset role;

select is(
  (select count(*)::int from auth.users where id='de100000-0000-4000-8000-000000000001'),
  0,'auth user is deleted'
);
select is(
  (select count(*)::int from public.profiles where user_id='de100000-0000-4000-8000-000000000001'),
  0,'owned profile cascades away'
);
select is(
  (select count(*)::int from public.player_identity_links where auth_user_id='de100000-0000-4000-8000-000000000001'),
  0,'visitor/auth identity stitching is removed'
);
select is(
  (select count(*)::int from public.players where id='de110000-0000-4000-8000-000000000011' and auth_user_id is null),
  1,'historical player row is de-identified rather than retaining auth ownership'
);

select ok(
  not has_function_privilege('anon','public.delete_my_inhagame_account_v1(text)','execute'),
  'anon cannot execute account deletion'
);
select ok(
  has_function_privilege('authenticated','public.delete_my_inhagame_account_v1(text)','execute'),
  'authenticated role can execute self-deletion RPC'
);

select * from finish();
rollback;
