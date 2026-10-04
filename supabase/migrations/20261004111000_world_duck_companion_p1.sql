-- INHA WORLD Duck Companion P1.
-- First real Creature slice:
-- verified Inkyung ordinary-duck observations -> bond eligibility -> duck.base ownership -> auto Active if party empty.
--
-- Security:
-- - Browser clients cannot mint observation provenance.
-- - Only service_role may record a verified Inkyung duck observation.
-- - Authenticated players may read only their own bond state and request bond.
-- - Bond authority re-checks the server observation ledger and never trusts a client count/Creature id/party revision.

update private.world_creature_species_catalog
   set status = 'ACTIVE'
 where species_id = 'creature.species.duck'
   and status = 'COMING_SOON';

insert into private.world_creature_form_catalog(
  form_id,species_id,status,definition_version)
values (
  'creature.form.duck.base',
  'creature.species.duck',
  'ACTIVE',
  1
)
on conflict (form_id) do nothing;

create table if not exists private.world_inkyung_duck_observation_subjects (
  duck_id text primary key
    check (duck_id ~ '^inkyung_duck_[a-z0-9_]+$' and char_length(duck_id) <= 80),
  kind text not null check (kind in ('white','mallard')),
  status text not null check (status in ('ACTIVE','DISABLED'))
);
comment on table private.world_inkyung_duck_observation_subjects is
  'Ordinary Inkyung Pond duck subjects eligible for verified Creature observation. Mechanical duck is intentionally excluded.';

insert into private.world_inkyung_duck_observation_subjects(duck_id,kind,status) values
  ('inkyung_duck_white_01','white','ACTIVE'),
  ('inkyung_duck_white_02','white','ACTIVE'),
  ('inkyung_duck_white_03','white','ACTIVE'),
  ('inkyung_duck_mallard_01','mallard','ACTIVE')
on conflict (duck_id) do nothing;

create table if not exists private.world_creature_acquisition_rule_catalog (
  rule_id text primary key
    check (rule_id ~ '^creature\.acquisition\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
      and char_length(rule_id) <= 140),
  species_id text not null references private.world_creature_species_catalog(species_id),
  form_id text not null references private.world_creature_form_catalog(form_id),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
      and char_length(source_ref) <= 160),
  required_observation_count integer not null check (required_observation_count >= 1),
  auto_activate_if_party_empty boolean not null default false,
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1)
);
comment on table private.world_creature_acquisition_rule_catalog is
  'Creature acquisition authority. Observation eligibility and target form are server-owned.';

insert into private.world_creature_acquisition_rule_catalog(
  rule_id,species_id,form_id,source_ref,required_observation_count,
  auto_activate_if_party_empty,status,definition_version)
values (
  'creature.acquisition.duck.inkyung_bond',
  'creature.species.duck',
  'creature.form.duck.base',
  'creature.acquisition.duck.inkyung',
  3,
  true,
  'ACTIVE',
  1
)
on conflict (rule_id) do nothing;

create table if not exists private.world_creature_acquisition_claims (
  claim_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id text not null references private.world_creature_acquisition_rule_catalog(rule_id),
  creature_id uuid not null unique references private.world_player_creatures(creature_id) on delete cascade,
  claim_key text not null unique
    check (claim_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  observation_count_at_claim integer not null check (observation_count_at_claim >= 1),
  auto_activated boolean not null,
  claimed_at timestamptz not null default now(),
  unique (user_id,rule_id)
);
comment on table private.world_creature_acquisition_claims is
  'Append-only successful Creature acquisition claims. One Inkyung duck companion per account/rule.';

alter table private.world_inkyung_duck_observation_subjects enable row level security;
alter table private.world_creature_acquisition_rule_catalog enable row level security;
alter table private.world_creature_acquisition_claims enable row level security;

revoke all on table
  private.world_inkyung_duck_observation_subjects,
  private.world_creature_acquisition_rule_catalog,
  private.world_creature_acquisition_claims
  from public, anon, authenticated, service_role;

drop trigger if exists world_creature_acquisition_claim_append_only
  on private.world_creature_acquisition_claims;
create trigger world_creature_acquisition_claim_append_only
  before update or delete on private.world_creature_acquisition_claims
  for each row execute function private.world_creature_append_only_v1();

create or replace function private.world_duck_companion_status_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule private.world_creature_acquisition_rule_catalog%rowtype;
  v_claim private.world_creature_acquisition_claims%rowtype;
  v_observation_count integer := 0;
  v_state text;
  v_creature private.world_player_creatures%rowtype;
begin
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into strict v_rule
    from private.world_creature_acquisition_rule_catalog r
   where r.rule_id = 'creature.acquisition.duck.inkyung_bond';

  select count(distinct e.source_ref)::integer
    into v_observation_count
    from private.world_creature_observation_events e
   where e.user_id = p_user
     and e.species_id = v_rule.species_id
     and exists (
       select 1
         from private.world_inkyung_duck_observation_subjects s
        where s.status = 'ACTIVE'
          and e.source_ref = 'world.inkyung.duck.' || s.duck_id
     );

  select * into v_claim
    from private.world_creature_acquisition_claims c
   where c.user_id = p_user
     and c.rule_id = v_rule.rule_id;

  if found then
    select * into strict v_creature
      from private.world_player_creatures c
     where c.creature_id = v_claim.creature_id
       and c.user_id = p_user;
    v_state := 'OWNED';
  elsif v_observation_count <= 0 then
    v_state := 'UNSEEN';
  elsif v_observation_count = 1 then
    v_state := 'SIGHTED';
  elsif v_observation_count < v_rule.required_observation_count then
    v_state := 'OBSERVED';
  else
    v_state := 'BOND_ELIGIBLE';
  end if;

  return jsonb_build_object(
    'ruleId',v_rule.rule_id,
    'speciesId',v_rule.species_id,
    'formId',v_rule.form_id,
    'state',v_state,
    'observationCount',v_observation_count,
    'requiredObservationCount',v_rule.required_observation_count,
    'remainingObservations',greatest(v_rule.required_observation_count-v_observation_count,0),
    'ownedCreature',case
      when v_state = 'OWNED' then private.world_creature_instance_json_v1(v_creature)
      else null end,
    'party',private.world_creature_party_snapshot_v1(p_user)
  );
end;
$$;
revoke all on function private.world_duck_companion_status_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_inkyung_duck_observe_v1(
  p_user uuid,
  p_duck_id text,
  p_result_ref text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subject private.world_inkyung_duck_observation_subjects%rowtype;
  v_observation jsonb;
begin
  if p_duck_id is null
     or p_duck_id !~ '^inkyung_duck_[a-z0-9_]+$'
     or char_length(p_duck_id) > 80 then
    raise exception 'INVALID_INKYUNG_DUCK_ID' using errcode = '22023';
  end if;

  select * into v_subject
    from private.world_inkyung_duck_observation_subjects s
   where s.duck_id = p_duck_id;
  if not found or v_subject.status <> 'ACTIVE' then
    raise exception 'INKYUNG_DUCK_NOT_OBSERVABLE' using errcode = 'P0001';
  end if;

  v_observation := private.world_creature_observe_v1(
    p_user,
    'creature.species.duck',
    'WORLD',
    'world.inkyung.duck.' || p_duck_id,
    p_result_ref,
    p_idempotency_key
  );

  return jsonb_build_object(
    'status',v_observation->>'status',
    'duckId',p_duck_id,
    'observation',v_observation,
    'companion',private.world_duck_companion_status_v1(p_user)
  );
end;
$$;
revoke all on function private.world_inkyung_duck_observe_v1(uuid,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_duck_companion_bond_v1(
  p_user uuid,
  p_claim_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rule private.world_creature_acquisition_rule_catalog%rowtype;
  v_existing private.world_creature_acquisition_claims%rowtype;
  v_claim private.world_creature_acquisition_claims%rowtype;
  v_grant jsonb;
  v_creature_id uuid;
  v_observation_count integer := 0;
  v_party private.world_creature_party_state%rowtype;
  v_party_revision bigint := 0;
  v_auto_activated boolean := false;
  v_acquisition_key text;
  v_party_key text;
begin
  if p_claim_key is null
     or p_claim_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_CLAIM_KEY' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('world_duck_companion:' || p_user::text,0));

  select * into v_existing
    from private.world_creature_acquisition_claims c
   where c.claim_key = p_claim_key;
  if found then
    if v_existing.user_id <> p_user
       or v_existing.rule_id <> 'creature.acquisition.duck.inkyung_bond' then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'claimId',v_existing.claim_id,
      'creatureId',v_existing.creature_id,
      'autoActivated',v_existing.auto_activated,
      'companion',private.world_duck_companion_status_v1(p_user)
    );
  end if;

  select * into v_existing
    from private.world_creature_acquisition_claims c
   where c.user_id = p_user
     and c.rule_id = 'creature.acquisition.duck.inkyung_bond';
  if found then
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'claimId',v_existing.claim_id,
      'creatureId',v_existing.creature_id,
      'autoActivated',v_existing.auto_activated,
      'companion',private.world_duck_companion_status_v1(p_user)
    );
  end if;

  select * into strict v_rule
    from private.world_creature_acquisition_rule_catalog r
   where r.rule_id = 'creature.acquisition.duck.inkyung_bond';

  if v_rule.status <> 'ACTIVE' then
    raise exception 'CREATURE_ACQUISITION_INACTIVE' using errcode = 'P0001';
  end if;

  select count(distinct e.source_ref)::integer
    into v_observation_count
    from private.world_creature_observation_events e
   where e.user_id = p_user
     and e.species_id = v_rule.species_id
     and exists (
       select 1
         from private.world_inkyung_duck_observation_subjects s
        where s.status = 'ACTIVE'
          and e.source_ref = 'world.inkyung.duck.' || s.duck_id
     );

  if v_observation_count < v_rule.required_observation_count then
    raise exception 'DUCK_BOND_OBSERVATION_REQUIRED' using errcode = 'P0001';
  end if;

  v_acquisition_key := 'duck-inkyung:' || p_user::text;
  v_grant := private.world_creature_grant_v1(
    p_user,
    v_rule.species_id,
    v_rule.form_id,
    v_rule.source_ref,
    v_acquisition_key
  );

  v_creature_id := nullif(v_grant->'creature'->>'creatureId','')::uuid;
  if v_creature_id is null then
    raise exception 'CREATURE_GRANT_RESULT_INVALID' using errcode = 'P0001';
  end if;

  update private.world_player_creatures c
     set bond_entitled = true,
         version = case when c.bond_entitled then c.version else c.version + 1 end,
         updated_at = case when c.bond_entitled then c.updated_at else now() end
   where c.creature_id = v_creature_id
     and c.user_id = p_user;

  select * into v_party
    from private.world_creature_party_state p
   where p.user_id = p_user
   for update;
  if found then
    v_party_revision := v_party.revision;
  end if;

  if v_rule.auto_activate_if_party_empty
     and (not found or v_party.active_creature_id is null) then
    v_party_key := 'duck-inkyung:auto-active:' || p_user::text;
    perform private.world_creature_party_set_v1(
      p_user,
      v_creature_id,
      null,
      null,
      v_party_revision,
      v_party_key
    );
    v_auto_activated := true;
  end if;

  insert into private.world_creature_acquisition_claims(
    user_id,rule_id,creature_id,claim_key,
    observation_count_at_claim,auto_activated)
  values (
    p_user,v_rule.rule_id,v_creature_id,p_claim_key,
    v_observation_count,v_auto_activated)
  returning * into v_claim;

  return jsonb_build_object(
    'status','SUCCESS',
    'claimId',v_claim.claim_id,
    'creatureId',v_creature_id,
    'autoActivated',v_auto_activated,
    'companion',private.world_duck_companion_status_v1(p_user)
  );
end;
$$;
revoke all on function private.world_duck_companion_bond_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.world_inkyung_duck_observe_v1(
  p_user uuid,
  p_duck_id text,
  p_result_ref text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_inkyung_duck_observe_v1(
    p_user,p_duck_id,p_result_ref,p_idempotency_key);
end;
$$;

create or replace function public.get_my_duck_companion_v1()
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
  return private.world_duck_companion_status_v1(v_user);
end;
$$;

create or replace function public.bond_my_duck_companion_v1(
  p_claim_key text)
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
  return private.world_duck_companion_bond_v1(v_user,p_claim_key);
end;
$$;

revoke execute on function public.world_inkyung_duck_observe_v1(uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_my_duck_companion_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.bond_my_duck_companion_v1(text)
  from public, anon, authenticated, service_role;

grant execute on function public.world_inkyung_duck_observe_v1(uuid,text,text,text)
  to service_role;
grant execute on function public.get_my_duck_companion_v1()
  to authenticated;
grant execute on function public.bond_my_duck_companion_v1(text)
  to authenticated;