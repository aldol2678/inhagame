-- Creature Manager P1 · self-only read + revisioned party management.
-- Ownership remains private Creature Core authority. The browser cannot name another user and
-- every party mutation reuses private.world_creature_party_set_v1, which verifies ownership,
-- uniqueness, Active 1 + Reserve 2 shape, expected revision and idempotency.

create or replace function public.get_my_creature_core_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'SIGN_IN_REQUIRED' using errcode = '42501';
  end if;
  return private.world_creature_core_snapshot_v1(v_user);
end;
$$;

create or replace function public.set_my_creature_party_v1(
  p_active_creature_id uuid,
  p_reserve1_creature_id uuid,
  p_reserve2_creature_id uuid,
  p_expected_revision bigint,
  p_mutation_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'SIGN_IN_REQUIRED' using errcode = '42501';
  end if;
  return private.world_creature_party_set_v1(
    v_user,
    p_active_creature_id,
    p_reserve1_creature_id,
    p_reserve2_creature_id,
    p_expected_revision,
    p_mutation_key
  );
end;
$$;

revoke execute on function public.get_my_creature_core_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.set_my_creature_party_v1(uuid,uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_my_creature_core_v1()
  to authenticated;
grant execute on function public.set_my_creature_party_v1(uuid,uuid,uuid,bigint,text)
  to authenticated;
