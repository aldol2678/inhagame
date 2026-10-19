-- MODEL-CONVERT-SEC-02: authorization and atomic per-user quota in local disposable DB.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(to_regclass('private.world_model_convert_claims') is not null,
  'model conversion claims are stored in the private schema');
select ok(coalesce((select relrowsecurity from pg_class
  where oid=to_regclass('private.world_model_convert_claims')), false),
  'quota claim table has RLS enabled');
select ok(to_regprocedure('public.claim_world_model_convert_quota_v1(uuid)') is not null,
  'quota claim RPC exists');
select ok(not has_function_privilege('anon', 'public.claim_world_model_convert_quota_v1(uuid)', 'EXECUTE'),
  'anonymous clients cannot call quota RPC');
select ok(not has_function_privilege('authenticated', 'public.claim_world_model_convert_quota_v1(uuid)', 'EXECUTE'),
  'authenticated clients cannot call quota RPC');
select ok(has_function_privilege('service_role', 'public.claim_world_model_convert_quota_v1(uuid)', 'EXECUTE'),
  'service role is granted quota RPC execution');

-- Fake the service JWT role only in this transaction; no real account or network calls.
select set_config('request.jwt.claim.role', 'service_role', true);
select is(auth.role(), 'service_role'::text, 'service-role test context enabled');
select ok(
  public.claim_world_model_convert_quota_v1('11111111-2222-4333-8444-555555555555'::uuid)
  and public.claim_world_model_convert_quota_v1('11111111-2222-4333-8444-555555555555'::uuid)
  and public.claim_world_model_convert_quota_v1('11111111-2222-4333-8444-555555555555'::uuid)
  and not public.claim_world_model_convert_quota_v1('11111111-2222-4333-8444-555555555555'::uuid),
  'three quota claims succeed in a one-hour window; fourth is denied');

select * from finish();
rollback;
