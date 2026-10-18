-- MODEL-CONVERT-SEC-02. Install before setting MODEL_CONVERT_ENABLED=1.
-- Private claims are never exposed to browser roles; one DB transaction serializes
-- global + per-operator check-and-insert on all serverless instances.
create table if not exists private.world_model_convert_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  claimed_at timestamptz not null default now()
);

create index if not exists world_model_convert_claims_window_idx
  on private.world_model_convert_claims (claimed_at, user_id);

alter table private.world_model_convert_claims enable row level security;
revoke all on private.world_model_convert_claims from public, anon, authenticated;

create or replace function public.claim_world_model_convert_quota_v1(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - interval '1 hour';
  v_global_count bigint;
  v_user_count bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'MODEL_CONVERT_SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'MODEL_CONVERT_USER_REQUIRED' using errcode = '22023';
  end if;
  -- DB-wide fixed advisory key, held until this transaction commits or rolls back.
  -- Lock first: concurrent Vercel instances cannot race through the global budget.
  perform pg_catalog.pg_advisory_xact_lock(20515, 20261019);
  -- Bounded retention of claim metadata. No uploaded file bytes are retained.
  delete from private.world_model_convert_claims where claimed_at < now() - interval '2 days';
  select count(*) into v_global_count from private.world_model_convert_claims
    where claimed_at >= v_since;
  if v_global_count >= 20 then return false; end if;
  select count(*) into v_user_count from private.world_model_convert_claims
    where claimed_at >= v_since and user_id = p_user_id;
  if v_user_count >= 3 then return false; end if;
  insert into private.world_model_convert_claims(user_id) values (p_user_id);
  return true;
end;
$$;

revoke all on function public.claim_world_model_convert_quota_v1(uuid) from public, anon, authenticated;
grant execute on function public.claim_world_model_convert_quota_v1(uuid) to service_role;
