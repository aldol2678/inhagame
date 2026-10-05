-- INHA WORLD P0 Activity / Outcome Authority.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous) values
 ('a8200000-0000-4000-8000-0000000000a8', 'authenticated', 'authenticated', 'activity-a@example.test', now(), false),
 ('b8200000-0000-4000-8000-0000000000b8', 'authenticated', 'authenticated', 'activity-b@example.test', now(), false),
 ('c8200000-0000-4000-8000-0000000000c8', 'authenticated', 'authenticated', null, null, true),
 ('d8200000-0000-4000-8000-0000000000d8', 'authenticated', 'authenticated', 'activity-d@example.test', now(), false);
insert into public.profiles(user_id, nickname, is_banned) values
 ('a8200000-0000-4000-8000-0000000000a8', '활동A', false),
 ('b8200000-0000-4000-8000-0000000000b8', '활동B', false),
 ('c8200000-0000-4000-8000-0000000000c8', '활동게스트', false),
 ('d8200000-0000-4000-8000-0000000000d8', '활동정지', true);

-- ---- schema / authority surface ----
select has_table('private', 'world_activity_attempts', 'activity attempt table exists');
select col_is_pk('private', 'world_activity_attempts', array['attempt_id'], 'attempt id is primary key');
select col_is_unique('private', 'world_activity_attempts', array['user_id','client_attempt_key'],
  'client attempt key is unique per account');
select ok((select relrowsecurity from pg_class where oid = 'private.world_activity_attempts'::regclass),
  'activity attempts have RLS');
select ok(not has_table_privilege(r, 'private.world_activity_attempts', p),
  format('%s cannot %s raw activity attempts', r, p))
from unnest(array['anon','authenticated','service_role']) r,
     unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;

select ok(not has_function_privilege(r,
  'public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)', 'execute'),
  format('%s cannot start server Activity attempts', r))
from unnest(array['anon','authenticated']) r;
select ok(not has_function_privilege(r,
  'public.world_activity_finalize_v1(uuid,uuid,text,text,text)', 'execute'),
  format('%s cannot finalize server Activity outcomes', r))
from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role',
  'public.world_activity_start_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)', 'execute'),
  'service_role can start Activity attempts');
select ok(has_function_privilege('service_role',
  'public.world_activity_finalize_v1(uuid,uuid,text,text,text)', 'execute'),
  'service_role can finalize Activity outcomes');


-- ---- server start + idempotency ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.fishing.inkyung',
    'fishing.inkyung.north_01',
    '11111111-1111-4111-8111-111111111111',
    1, 1, null
  )->>'status',
  'STARTED',
  'first semantic attempt starts'
);
select is(
  public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.fishing.inkyung',
    'fishing.inkyung.north_01',
    '11111111-1111-4111-8111-111111111111',
    1, 1, null
  )->>'status',
  'ALREADY_PROCESSED',
  'same client key replays one attempt'
);
select throws_ok($$
  select public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.fishing.inkyung',
    'fishing.inkyung.south_01',
    '11111111-1111-4111-8111-111111111111',
    1, 1, null)
$$, '23505', 'IDEMPOTENCY_CONFLICT', 'same client key cannot change semantic identity');
select is(
  public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.fishing.inkyung',
    'fishing.inkyung.north_01',
    '22222222-2222-4222-8222-222222222222',
    1, 1, null
  )->>'status',
  'ATTEMPT_ALREADY_ACTIVE',
  'a second key cannot create a second active attempt for the same source'
);
reset role;

select is((select count(*) from private.world_activity_attempts
  where user_id='a8200000-0000-4000-8000-0000000000a8'
    and activity_id='activity.fishing.inkyung'
    and source_ref='fishing.inkyung.north_01'), 1::bigint,
  'start/replay/duplicate-active create exactly one row');
select is((select status from private.world_activity_attempts
  where user_id='a8200000-0000-4000-8000-0000000000a8'
    and client_attempt_key='11111111-1111-4111-8111-111111111111'), 'ACTIVE',
  'started row is ACTIVE');
select set_config('test.activity_attempt_a', (select attempt_id::text from private.world_activity_attempts
  where user_id='a8200000-0000-4000-8000-0000000000a8'
    and client_attempt_key='11111111-1111-4111-8111-111111111111'), true);

-- ---- client boundary ----
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"a8200000-0000-4000-8000-0000000000a8","is_anonymous":false}';
select throws_ok($$
  select public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.gathering.campus','gathering.campus.leaf_01',
    '33333333-3333-4333-8333-333333333333',1,1,null)
$$, '42501', null, 'authenticated client cannot call server start');
select throws_ok($$
  select public.world_activity_finalize_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    current_setting('test.activity_attempt_a')::uuid,
    'SUCCEEDED','CATCH','fishing_result:forged')
$$, '42501', null, 'authenticated client cannot finalize server outcome');
reset role;

-- ---- terminal outcome + immutable replay ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  public.world_activity_finalize_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    current_setting('test.activity_attempt_a')::uuid,
    'SUCCEEDED','CATCH','fishing_result:catch_001'
  )->>'status',
  'SUCCESS',
  'server finalizes a successful outcome'
);
select is(
  public.world_activity_finalize_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    current_setting('test.activity_attempt_a')::uuid,
    'SUCCEEDED','CATCH','fishing_result:catch_001'
  )->>'status',
  'ALREADY_PROCESSED',
  'same finalize replay is idempotent'
);
select throws_ok($$
  select public.world_activity_finalize_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    current_setting('test.activity_attempt_a')::uuid,
    'FAILED','NO_CATCH',null)
$$, '23505', 'OUTCOME_CONFLICT', 'terminal outcome cannot be rewritten');
select throws_ok($$
  select public.world_activity_finalize_v1(
    'b8200000-0000-4000-8000-0000000000b8',
    current_setting('test.activity_attempt_a')::uuid,
    'SUCCEEDED','CATCH','fishing_result:catch_001')
$$, 'P0002', 'ATTEMPT_NOT_FOUND', 'another account cannot finalize the attempt');
select throws_ok($$
  select public.world_activity_finalize_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    current_setting('test.activity_attempt_a')::uuid,
    'SUCCEEDED','CATCH',null)
$$, '22023', 'RESULT_REF_REQUIRED', 'success requires a result ref');
reset role;

select results_eq($$
  select status, outcome_type, result_ref, finalized_at is not null
    from private.world_activity_attempts
   where user_id='a8200000-0000-4000-8000-0000000000a8'
     and client_attempt_key='11111111-1111-4111-8111-111111111111'
$$, $$values ('SUCCEEDED'::text,'CATCH'::text,'fishing_result:catch_001'::text,true)$$,
  'terminal row keeps the one server result');

select throws_ok($$
  update private.world_activity_attempts
     set status='FAILED', outcome_type='NO_CATCH', result_ref=null
   where user_id='a8200000-0000-4000-8000-0000000000a8'
     and client_attempt_key='11111111-1111-4111-8111-111111111111'
$$, '42501', 'ACTIVITY_TERMINAL_IMMUTABLE', 'terminal attempt cannot be mutated directly');

-- ---- expired ACTIVE recovery ----
insert into private.world_activity_attempts(
  user_id, activity_id, source_ref, client_attempt_key, status,
  definition_version, resolver_version, created_at, activated_at, expires_at)
values (
  'a8200000-0000-4000-8000-0000000000a8',
  'activity.gathering.campus',
  'gathering.campus.leaf_01',
  '44444444-4444-4444-8444-444444444444',
  'ACTIVE',1,1,now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '1 minute'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.gathering.campus',
    'gathering.campus.leaf_01',
    '55555555-5555-4555-8555-555555555555',
    1,1,null
  )->>'status',
  'STARTED',
  'new key expires the stale active attempt then starts cleanly'
);
reset role;
select is((select status from private.world_activity_attempts
  where client_attempt_key='44444444-4444-4444-8444-444444444444'), 'EXPIRED',
  'stale row is finalized EXPIRED');
select is((select outcome_type from private.world_activity_attempts
  where client_attempt_key='44444444-4444-4444-8444-444444444444'), 'EXPIRED',
  'stale row records an explicit outcome type');

-- ---- invalid accounts / identity ----
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$
  select public.world_activity_start_v1(
    'c8200000-0000-4000-8000-0000000000c8',
    'activity.gathering.campus','gathering.campus.leaf_02',
    '66666666-6666-4666-8666-666666666666',1,1,null)
$$, '22023', 'ACCOUNT_UNAVAILABLE', 'guest has no persistent Activity attempt');
select throws_ok($$
  select public.world_activity_start_v1(
    'd8200000-0000-4000-8000-0000000000d8',
    'activity.gathering.campus','gathering.campus.leaf_02',
    '77777777-7777-4777-8777-777777777777',1,1,null)
$$, '22023', 'ACCOUNT_UNAVAILABLE', 'banned account has no persistent Activity attempt');
select throws_ok($$
  select public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'fishing.inkyung','gathering.campus.leaf_02',
    '88888888-8888-4888-8888-888888888888',1,1,null)
$$, '22023', 'INVALID_ACTIVITY_ID', 'activity id uses its own stable namespace');
select throws_ok($$
  select public.world_activity_start_v1(
    'a8200000-0000-4000-8000-0000000000a8',
    'activity.gathering.campus','37.451,126.654',
    '99999999-9999-4999-8999-999999999999',1,1,null)
$$, '22023', 'INVALID_SOURCE_REF', 'raw coordinates are not an Activity source authority');
reset role;

-- ---- account lifecycle ----
delete from auth.users where id='a8200000-0000-4000-8000-0000000000a8';
select is((select count(*) from private.world_activity_attempts
  where user_id='a8200000-0000-4000-8000-0000000000a8'), 0::bigint,
  'account deletion cascades Activity attempts');

select * from finish();
rollback;
