-- Asset GLB canary remote control + telemetry contract.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_table('public', 'world_runtime_flags', 'world runtime flag table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.world_runtime_flags'::regclass),
  'world runtime flags has RLS enabled');

set local role anon;
select is((select enabled from public.world_runtime_flags where flag = 'asset_glb_canary_v1'), false,
  'asset canary remote flag defaults disabled');
select is((select count(*)::int from public.world_runtime_flags where flag = 'unknown'), 0,
  'anon cannot discover any unknown runtime flag row');
select throws_ok(
  $$update public.world_runtime_flags set enabled = true where flag = 'asset_glb_canary_v1'$$,
  '42501', null, 'anon cannot mutate runtime flags');
reset role;

set local role authenticated;
select is((select enabled from public.world_runtime_flags where flag = 'asset_glb_canary_v1'), false,
  'authenticated can read the same public kill-switch bit');
select throws_ok(
  $$delete from public.world_runtime_flags where flag = 'asset_glb_canary_v1'$$,
  '42501', null, 'authenticated cannot delete runtime flags');
reset role;

set local role service_role;
update public.world_runtime_flags set enabled = true, updated_at = now()
where flag = 'asset_glb_canary_v1';
reset role;

set local role anon;
select is((select enabled from public.world_runtime_flags where flag = 'asset_glb_canary_v1'), true,
  'service-role operator update is visible to public read path');

\set s '''93000000-0000-4000-8000-000000000001'''
\set v '''94000000-0000-4000-8000-000000000001'''
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s, :v,
  'asset_canary_selected', 'campus', 'induck_v3', 'direct', null), true,
  'asset canary selected telemetry is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s, :v,
  'asset_canary_active', 'campus', 'induck_v3', 'direct', null), true,
  'asset canary active telemetry is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s, :v,
  'asset_canary_rollback', 'campus', 'induck_v3', 'direct', null), true,
  'asset canary rollback telemetry is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s, :v,
  'asset_canary_failure', 'campus', 'induck_v3', 'direct', null), true,
  'asset canary failure telemetry is accepted');
select is(public.log_inhagame_hub_event_v2(gen_random_uuid(), :s, :v,
  'asset_canary_active', 'campus', 'some-user-or-secret', 'direct', null), false,
  'asset canary telemetry target is fixed and cannot carry user context');
reset role;

select is((select count(*)::int from public.inhagame_hub_events where session_id = :s), 4,
  'exactly four canonical asset canary telemetry events are stored');

select * from finish();
rollback;
