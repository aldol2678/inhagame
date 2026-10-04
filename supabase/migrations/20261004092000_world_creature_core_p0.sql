-- INHA WORLD Creature Core P0.
-- Server authority for Species/Form, Observation, Ownership/Party, Memory/Growth and Evolution.
--
-- Ownership boundaries:
-- - Creature Core owns creature instance state, party revision history, memory tags, Creature XP
--   and evolution state.
-- - Activity / Combat / Exploration / Social / Housing only provide verified source-result identity.
-- - External systems never choose Creature XP, memory tags, form changes or evolution outcomes.
-- - Reward, Wallet, Inventory, Player EXP and Life XP remain with their existing owners.
--
-- P0 activation state:
-- - four species identities are COMING_SOON
-- - no forms are committed
-- - no activity bridges are committed
-- - no evolution rules are committed
-- Therefore no real Creature can be granted or grown by this migration alone.

create table if not exists private.world_creature_species_catalog (
  species_id text primary key
    check (species_id ~ '^creature\.species\.[a-z][a-z0-9_]*$'
      and char_length(species_id) <= 100),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1)
);
comment on table private.world_creature_species_catalog is
  'Creature species write-authority mirror. Product presentation remains in code.';

insert into private.world_creature_species_catalog(species_id,status,definition_version) values
  ('creature.species.duck','COMING_SOON',1),
  ('creature.species.pageling','COMING_SOON',1),
  ('creature.species.volti','COMING_SOON',1),
  ('creature.species.porong','COMING_SOON',1)
on conflict (species_id) do nothing;

create table if not exists private.world_creature_form_catalog (
  form_id text primary key
    check (form_id ~ '^creature\.form\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
      and char_length(form_id) <= 120),
  species_id text not null references private.world_creature_species_catalog(species_id),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1)
);
comment on table private.world_creature_form_catalog is
  'Creature form write-authority mirror. P0 intentionally commits no form identities.';

create table if not exists private.world_player_creatures (
  creature_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  species_id text not null references private.world_creature_species_catalog(species_id),
  current_form_id text not null references private.world_creature_form_catalog(form_id),
  form_revision bigint not null default 0 check (form_revision >= 0),
  total_xp bigint not null default 0 check (total_xp >= 0),
  bond_entitled boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  acquisition_key text not null unique
    check (acquisition_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
      and char_length(source_ref) <= 160),
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table private.world_player_creatures is
  'Per-account owned Creature projection. Current form, Creature XP and revisions are Creature Core authority.';

create index if not exists world_player_creatures_user_idx
  on private.world_player_creatures(user_id,acquired_at);

create table if not exists private.world_creature_party_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  active_creature_id uuid references private.world_player_creatures(creature_id),
  reserve1_creature_id uuid references private.world_player_creatures(creature_id),
  reserve2_creature_id uuid references private.world_player_creatures(creature_id),
  updated_at timestamptz not null default now(),
  constraint world_creature_party_state_shape check (
    (active_creature_id is not null)
    or (reserve1_creature_id is null and reserve2_creature_id is null)
  ),
  constraint world_creature_party_state_unique_slots check (
    (active_creature_id is null or reserve1_creature_id is null or active_creature_id <> reserve1_creature_id)
    and (active_creature_id is null or reserve2_creature_id is null or active_creature_id <> reserve2_creature_id)
    and (reserve1_creature_id is null or reserve2_creature_id is null or reserve1_creature_id <> reserve2_creature_id)
  )
);
comment on table private.world_creature_party_state is
  'Current Active 1 + Reserve 2 party projection. Revision changes on every committed party mutation.';

create table if not exists private.world_creature_party_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision >= 1),
  active_creature_id uuid references private.world_player_creatures(creature_id),
  reserve1_creature_id uuid references private.world_player_creatures(creature_id),
  reserve2_creature_id uuid references private.world_player_creatures(creature_id),
  mutation_key text not null unique
    check (mutation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  committed_at timestamptz not null default now(),
  primary key (user_id,revision),
  constraint world_creature_party_history_shape check (
    (active_creature_id is not null)
    or (reserve1_creature_id is null and reserve2_creature_id is null)
  ),
  constraint world_creature_party_history_unique_slots check (
    (active_creature_id is null or reserve1_creature_id is null or active_creature_id <> reserve1_creature_id)
    and (active_creature_id is null or reserve2_creature_id is null or active_creature_id <> reserve2_creature_id)
    and (reserve1_creature_id is null or reserve2_creature_id is null or reserve1_creature_id <> reserve2_creature_id)
  )
);
comment on table private.world_creature_party_history is
  'Append-only party revision history used to bind later verified Activity results to the ACTIVE Creature at occurrence time.';

create table if not exists private.world_creature_observation_events (
  observation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  species_id text not null references private.world_creature_species_catalog(species_id),
  source_type text not null check (source_type in (
    'WORLD','QUEST','ACTIVITY','COMBAT','RESEARCH','SYSTEM','ADMIN'
  )),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
      and char_length(source_ref) <= 160),
  result_ref text not null
    check (result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  observed_at timestamptz not null default now(),
  unique (user_id,species_id,result_ref)
);
comment on table private.world_creature_observation_events is
  'Append-only verified Creature observation provenance. Observation does not imply ownership or bonding.';

create index if not exists world_creature_observation_user_idx
  on private.world_creature_observation_events(user_id,observed_at desc);

create table if not exists private.world_creature_activity_bridge_catalog (
  bridge_id text primary key
    check (bridge_id ~ '^creature\.bridge\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
      and char_length(bridge_id) <= 120),
  source_domain text not null check (source_domain in (
    'ACTIVITY','COMBAT','EXPLORATION','SOCIAL','HOUSING'
  )),
  semantic_event_type text not null
    check (semantic_event_type ~ '^(activity|combat|exploration|social|housing)\.[a-z][a-z0-9_.]{0,95}$'),
  memory_tag text not null
    check (memory_tag ~ '^memory\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$'
      and char_length(memory_tag) <= 120),
  xp_amount bigint not null check (xp_amount >= 0),
  cooldown_seconds integer not null check (cooldown_seconds >= 0),
  daily_cap integer check (daily_cap is null or daily_cap >= 1),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1),
  constraint world_creature_bridge_domain_event check (
    (source_domain = 'ACTIVITY' and semantic_event_type like 'activity.%')
    or (source_domain = 'COMBAT' and semantic_event_type like 'combat.%')
    or (source_domain = 'EXPLORATION' and semantic_event_type like 'exploration.%')
    or (source_domain = 'SOCIAL' and semantic_event_type like 'social.%')
    or (source_domain = 'HOUSING' and semantic_event_type like 'housing.%')
  )
);
comment on table private.world_creature_activity_bridge_catalog is
  'Creature Core-owned mapping from verified external semantic events to Creature XP and Memory. P0 intentionally empty.';

create table if not exists private.world_creature_activity_events (
  creature_activity_event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id text not null references private.world_creature_activity_bridge_catalog(bridge_id),
  source_ref text not null
    check (source_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
      and char_length(source_ref) <= 160),
  source_result_ref text not null
    check (source_result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  source_event_key text not null unique
    check (source_event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  party_revision bigint not null check (party_revision >= 0),
  creature_id uuid references private.world_player_creatures(creature_id),
  decision text not null check (decision in (
    'ACCEPTED','NOOP_NO_ACTIVE','NOOP_COOLDOWN','NOOP_CAP'
  )),
  xp_awarded bigint not null check (xp_awarded >= 0),
  memory_tag text check (
    memory_tag is null or (
      memory_tag ~ '^memory\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$'
      and char_length(memory_tag) <= 120
    )
  ),
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  unique (user_id,bridge_id,source_result_ref),
  constraint world_creature_activity_decision_shape check (
    (decision = 'ACCEPTED' and creature_id is not null and memory_tag is not null)
    or
    (decision <> 'ACCEPTED' and xp_awarded = 0 and memory_tag is null)
  )
);
comment on table private.world_creature_activity_events is
  'Append-only replay-safe decision ledger. NOOP rows intentionally prevent later backfill after party/context changes.';

create index if not exists world_creature_activity_creature_idx
  on private.world_creature_activity_events(creature_id,occurred_at desc)
  where creature_id is not null;

create table if not exists private.world_creature_xp_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creature_id uuid not null references private.world_player_creatures(creature_id) on delete cascade,
  creature_activity_event_id uuid not null unique
    references private.world_creature_activity_events(creature_activity_event_id),
  amount bigint not null check (amount > 0),
  xp_before bigint not null check (xp_before >= 0),
  xp_after bigint not null check (xp_after >= 0),
  created_at timestamptz not null default now(),
  constraint world_creature_xp_math check (xp_after = xp_before + amount)
);
comment on table private.world_creature_xp_transactions is
  'Append-only Creature XP ledger. XP amounts are resolved only from Creature Core bridge definitions.';

create table if not exists private.world_creature_memory_tags (
  creature_id uuid not null references private.world_player_creatures(creature_id) on delete cascade,
  memory_tag text not null
    check (memory_tag ~ '^memory\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$'
      and char_length(memory_tag) <= 120),
  memory_count bigint not null check (memory_count >= 1),
  first_remembered_at timestamptz not null,
  last_remembered_at timestamptz not null,
  version bigint not null default 1 check (version >= 1),
  primary key (creature_id,memory_tag),
  constraint world_creature_memory_time check (last_remembered_at >= first_remembered_at)
);
comment on table private.world_creature_memory_tags is
  'Creature Core-owned semantic Memory projection derived from accepted verified activity events.';

create table if not exists private.world_creature_evolution_rule_catalog (
  rule_id text primary key
    check (rule_id ~ '^creature\.evolution\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
      and char_length(rule_id) <= 140),
  species_id text not null references private.world_creature_species_catalog(species_id),
  from_form_id text not null references private.world_creature_form_catalog(form_id),
  to_form_id text not null references private.world_creature_form_catalog(form_id),
  required_memory_tag text not null
    check (required_memory_tag ~ '^memory\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$'
      and char_length(required_memory_tag) <= 120),
  required_memory_count bigint not null check (required_memory_count >= 1),
  context_ref text not null
    check (context_ref ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
      and char_length(context_ref) <= 160),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1),
  constraint world_creature_evolution_distinct_forms check (from_form_id <> to_form_id)
);
comment on table private.world_creature_evolution_rule_catalog is
  'Creature Core evolution candidates. P0 intentionally empty; no final-form or fusion semantics are implied.';

create table if not exists private.world_creature_evolution_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creature_id uuid not null references private.world_player_creatures(creature_id) on delete cascade,
  rule_id text not null references private.world_creature_evolution_rule_catalog(rule_id),
  captured_form_revision bigint not null check (captured_form_revision >= 0),
  status text not null check (status in ('CANDIDATE','READY','COMMITTED','REJECTED')),
  candidate_key text not null unique
    check (candidate_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  gate_key text unique
    check (gate_key is null or gate_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  commit_key text unique
    check (commit_key is null or commit_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  context_ref text,
  created_at timestamptz not null default now(),
  gated_at timestamptz,
  committed_at timestamptz
);
comment on table private.world_creature_evolution_candidates is
  'Candidate -> context gate -> commit state machine. Evolution is never directly client-selected.';

create table if not exists private.world_creature_evolution_events (
  evolution_event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creature_id uuid not null references private.world_player_creatures(creature_id) on delete cascade,
  candidate_id uuid not null unique references private.world_creature_evolution_candidates(candidate_id),
  rule_id text not null references private.world_creature_evolution_rule_catalog(rule_id),
  from_form_id text not null references private.world_creature_form_catalog(form_id),
  to_form_id text not null references private.world_creature_form_catalog(form_id),
  form_revision_before bigint not null check (form_revision_before >= 0),
  form_revision_after bigint not null check (form_revision_after = form_revision_before + 1),
  committed_at timestamptz not null default now()
);
comment on table private.world_creature_evolution_events is
  'Append-only committed Creature evolution provenance.';

alter table private.world_creature_species_catalog enable row level security;
alter table private.world_creature_form_catalog enable row level security;
alter table private.world_player_creatures enable row level security;
alter table private.world_creature_party_state enable row level security;
alter table private.world_creature_party_history enable row level security;
alter table private.world_creature_observation_events enable row level security;
alter table private.world_creature_activity_bridge_catalog enable row level security;
alter table private.world_creature_activity_events enable row level security;
alter table private.world_creature_xp_transactions enable row level security;
alter table private.world_creature_memory_tags enable row level security;
alter table private.world_creature_evolution_rule_catalog enable row level security;
alter table private.world_creature_evolution_candidates enable row level security;
alter table private.world_creature_evolution_events enable row level security;

revoke all on table private.world_creature_species_catalog,
  private.world_creature_form_catalog,
  private.world_player_creatures,
  private.world_creature_party_state,
  private.world_creature_party_history,
  private.world_creature_observation_events,
  private.world_creature_activity_bridge_catalog,
  private.world_creature_activity_events,
  private.world_creature_xp_transactions,
  private.world_creature_memory_tags,
  private.world_creature_evolution_rule_catalog,
  private.world_creature_evolution_candidates,
  private.world_creature_evolution_events
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CREATURE_LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_creature_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_creature_party_history_append_only
  on private.world_creature_party_history;
create trigger world_creature_party_history_append_only
  before update or delete on private.world_creature_party_history
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_creature_observation_append_only
  on private.world_creature_observation_events;
create trigger world_creature_observation_append_only
  before update or delete on private.world_creature_observation_events
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_creature_activity_append_only
  on private.world_creature_activity_events;
create trigger world_creature_activity_append_only
  before update or delete on private.world_creature_activity_events
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_creature_xp_append_only
  on private.world_creature_xp_transactions;
create trigger world_creature_xp_append_only
  before update or delete on private.world_creature_xp_transactions
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_creature_evolution_event_append_only
  on private.world_creature_evolution_events;
create trigger world_creature_evolution_event_append_only
  before update or delete on private.world_creature_evolution_events
  for each row execute function private.world_creature_append_only_v1();

create or replace function private.world_creature_account_ok_v1(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.id = p_user
       and u.is_anonymous is not true
       and p.is_banned = false
  );
$$;
revoke all on function private.world_creature_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_owned_by_v1(p_user uuid,p_creature uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.world_player_creatures c
     where c.creature_id = p_creature
       and c.user_id = p_user
  );
$$;
revoke all on function private.world_creature_owned_by_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_instance_json_v1(
  p_creature private.world_player_creatures)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'creatureId',p_creature.creature_id,
    'speciesId',p_creature.species_id,
    'currentFormId',p_creature.current_form_id,
    'formRevision',p_creature.form_revision,
    'totalXp',p_creature.total_xp,
    'bondEntitled',p_creature.bond_entitled,
    'version',p_creature.version,
    'acquiredAt',p_creature.acquired_at,
    'updatedAt',p_creature.updated_at
  );
$$;
revoke all on function private.world_creature_instance_json_v1(private.world_player_creatures)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_party_snapshot_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_party private.world_creature_party_state%rowtype;
begin
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_party
    from private.world_creature_party_state p
   where p.user_id = p_user;

  if not found then
    return jsonb_build_object(
      'revision',0,
      'activeCreatureId',null,
      'reserveCreatureIds','[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'revision',v_party.revision,
    'activeCreatureId',v_party.active_creature_id,
    'reserveCreatureIds',to_jsonb(array_remove(
      ARRAY[v_party.reserve1_creature_id,v_party.reserve2_creature_id],
      NULL::uuid
    ))
  );
end;
$$;
revoke all on function private.world_creature_party_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_core_snapshot_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'userId',p_user,
    'party',private.world_creature_party_snapshot_v1(p_user),
    'creatures',coalesce((
      select jsonb_agg(
        private.world_creature_instance_json_v1(c)
        order by c.acquired_at,c.creature_id
      )
      from private.world_player_creatures c
      where c.user_id = p_user
    ),'[]'::jsonb),
    'memories',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'creatureId',m.creature_id,
          'memoryTag',m.memory_tag,
          'memoryCount',m.memory_count,
          'firstRememberedAt',m.first_remembered_at,
          'lastRememberedAt',m.last_remembered_at,
          'version',m.version
        )
        order by m.creature_id,m.memory_tag
      )
      from private.world_creature_memory_tags m
      join private.world_player_creatures c on c.creature_id = m.creature_id
      where c.user_id = p_user
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_creature_core_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_observe_v1(
  p_user uuid,
  p_species_id text,
  p_source_type text,
  p_source_ref text,
  p_result_ref text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_species private.world_creature_species_catalog%rowtype;
  v_existing private.world_creature_observation_events%rowtype;
  v_event private.world_creature_observation_events%rowtype;
begin
  if p_species_id is null
     or p_species_id !~ '^creature\.species\.[a-z][a-z0-9_]*$'
     or char_length(p_species_id) > 100 then
    raise exception 'INVALID_CREATURE_SPECIES_ID' using errcode = '22023';
  end if;
  if p_source_type not in ('WORLD','QUEST','ACTIVITY','COMBAT','RESEARCH','SYSTEM','ADMIN') then
    raise exception 'INVALID_OBSERVATION_SOURCE' using errcode = '22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
     or char_length(p_source_ref) > 160
     or p_result_ref is null
     or p_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_OBSERVATION_PROVENANCE' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_existing
    from private.world_creature_observation_events e
   where e.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id,v_existing.species_id,v_existing.source_type,
        v_existing.source_ref,v_existing.result_ref)
       is distinct from
       (p_user,p_species_id,p_source_type,p_source_ref,p_result_ref) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'observationId',v_existing.observation_id
    );
  end if;

  select * into v_existing
    from private.world_creature_observation_events e
   where e.user_id = p_user
     and e.species_id = p_species_id
     and e.result_ref = p_result_ref;
  if found then
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'observationId',v_existing.observation_id
    );
  end if;

  select * into v_species
    from private.world_creature_species_catalog s
   where s.species_id = p_species_id;
  if not found then
    raise exception 'CREATURE_SPECIES_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_species.status <> 'ACTIVE' then
    raise exception 'CREATURE_SPECIES_INACTIVE' using errcode = 'P0001';
  end if;

  insert into private.world_creature_observation_events(
    user_id,species_id,source_type,source_ref,result_ref,idempotency_key)
  values (
    p_user,p_species_id,p_source_type,p_source_ref,p_result_ref,p_idempotency_key)
  returning * into v_event;

  return jsonb_build_object(
    'status','SUCCESS',
    'observationId',v_event.observation_id,
    'speciesId',v_event.species_id,
    'observedAt',v_event.observed_at
  );
end;
$$;
revoke all on function private.world_creature_observe_v1(uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_grant_v1(
  p_user uuid,
  p_species_id text,
  p_form_id text,
  p_source_ref text,
  p_acquisition_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_species private.world_creature_species_catalog%rowtype;
  v_form private.world_creature_form_catalog%rowtype;
  v_existing private.world_player_creatures%rowtype;
  v_creature private.world_player_creatures%rowtype;
begin
  if p_species_id is null
     or p_species_id !~ '^creature\.species\.[a-z][a-z0-9_]*$'
     or p_form_id is null
     or p_form_id !~ '^creature\.form\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
     or p_source_ref is null
     or p_source_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
     or p_acquisition_key is null
     or p_acquisition_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_CREATURE_GRANT' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_existing
    from private.world_player_creatures c
   where c.acquisition_key = p_acquisition_key;
  if found then
    if (v_existing.user_id,v_existing.species_id,v_existing.current_form_id,v_existing.source_ref)
       is distinct from (p_user,p_species_id,p_form_id,p_source_ref) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'creature',private.world_creature_instance_json_v1(v_existing)
    );
  end if;

  select * into v_species
    from private.world_creature_species_catalog s
   where s.species_id = p_species_id;
  if not found or v_species.status <> 'ACTIVE' then
    raise exception 'CREATURE_SPECIES_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_form
    from private.world_creature_form_catalog f
   where f.form_id = p_form_id;
  if not found or v_form.status <> 'ACTIVE' or v_form.species_id <> p_species_id then
    raise exception 'CREATURE_FORM_INACTIVE' using errcode = 'P0001';
  end if;

  insert into private.world_player_creatures(
    user_id,species_id,current_form_id,acquisition_key,source_ref)
  values (p_user,p_species_id,p_form_id,p_acquisition_key,p_source_ref)
  returning * into v_creature;

  return jsonb_build_object(
    'status','SUCCESS',
    'creature',private.world_creature_instance_json_v1(v_creature)
  );
end;
$$;
revoke all on function private.world_creature_grant_v1(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_party_set_v1(
  p_user uuid,
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
  v_party private.world_creature_party_state%rowtype;
  v_history private.world_creature_party_history%rowtype;
  v_current_revision bigint := 0;
  v_next_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INVALID_PARTY_REVISION' using errcode = '22023';
  end if;
  if p_mutation_key is null
     or p_mutation_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_PARTY_MUTATION_KEY' using errcode = '22023';
  end if;
  if p_active_creature_id is null
     and (p_reserve1_creature_id is not null or p_reserve2_creature_id is not null) then
    raise exception 'CREATURE_PARTY_ACTIVE_REQUIRED' using errcode = '22023';
  end if;
  if (p_active_creature_id is not null and p_active_creature_id = p_reserve1_creature_id)
     or (p_active_creature_id is not null and p_active_creature_id = p_reserve2_creature_id)
     or (p_reserve1_creature_id is not null and p_reserve1_creature_id = p_reserve2_creature_id) then
    raise exception 'CREATURE_PARTY_DUPLICATE' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_creature_party:' || p_user::text,0));

  select * into v_history
    from private.world_creature_party_history h
   where h.mutation_key = p_mutation_key;
  if found then
    if (v_history.user_id,v_history.active_creature_id,
        v_history.reserve1_creature_id,v_history.reserve2_creature_id)
       is distinct from
       (p_user,p_active_creature_id,p_reserve1_creature_id,p_reserve2_creature_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'committedRevision',v_history.revision,
      'party',private.world_creature_party_snapshot_v1(p_user)
    );
  end if;

  select * into v_party
    from private.world_creature_party_state p
   where p.user_id = p_user
   for update;
  if found then
    v_current_revision := v_party.revision;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception 'CREATURE_PARTY_REVISION_CONFLICT' using errcode = '40001';
  end if;

  if (p_active_creature_id is not null
      and not private.world_creature_owned_by_v1(p_user,p_active_creature_id))
     or (p_reserve1_creature_id is not null
      and not private.world_creature_owned_by_v1(p_user,p_reserve1_creature_id))
     or (p_reserve2_creature_id is not null
      and not private.world_creature_owned_by_v1(p_user,p_reserve2_creature_id)) then
    raise exception 'CREATURE_NOT_OWNED' using errcode = '42501';
  end if;

  v_next_revision := v_current_revision + 1;

  insert into private.world_creature_party_state(
    user_id,revision,active_creature_id,reserve1_creature_id,reserve2_creature_id,updated_at)
  values (
    p_user,v_next_revision,p_active_creature_id,p_reserve1_creature_id,p_reserve2_creature_id,now())
  on conflict (user_id) do update
    set revision = excluded.revision,
        active_creature_id = excluded.active_creature_id,
        reserve1_creature_id = excluded.reserve1_creature_id,
        reserve2_creature_id = excluded.reserve2_creature_id,
        updated_at = excluded.updated_at;

  insert into private.world_creature_party_history(
    user_id,revision,active_creature_id,reserve1_creature_id,reserve2_creature_id,mutation_key)
  values (
    p_user,v_next_revision,p_active_creature_id,p_reserve1_creature_id,p_reserve2_creature_id,p_mutation_key);

  return jsonb_build_object(
    'status','SUCCESS',
    'party',private.world_creature_party_snapshot_v1(p_user)
  );
end;
$$;
revoke all on function private.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_activity_event_json_v1(
  p_event private.world_creature_activity_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'creatureActivityEventId',p_event.creature_activity_event_id,
    'bridgeId',p_event.bridge_id,
    'sourceRef',p_event.source_ref,
    'sourceResultRef',p_event.source_result_ref,
    'partyRevision',p_event.party_revision,
    'creatureId',p_event.creature_id,
    'decision',p_event.decision,
    'xpAwarded',p_event.xp_awarded,
    'memoryTag',p_event.memory_tag,
    'occurredAt',p_event.occurred_at,
    'processedAt',p_event.processed_at
  );
$$;
revoke all on function private.world_creature_activity_event_json_v1(
  private.world_creature_activity_events)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_activity_accept_v1(
  p_user uuid,
  p_bridge_id text,
  p_source_ref text,
  p_source_result_ref text,
  p_source_event_key text,
  p_party_revision bigint,
  p_occurred_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bridge private.world_creature_activity_bridge_catalog%rowtype;
  v_existing private.world_creature_activity_events%rowtype;
  v_party private.world_creature_party_history%rowtype;
  v_event private.world_creature_activity_events%rowtype;
  v_creature private.world_player_creatures%rowtype;
  v_last timestamptz;
  v_daily_count bigint;
  v_decision text := 'NOOP_NO_ACTIVE';
  v_xp bigint := 0;
  v_memory_tag text := null;
  v_before bigint;
  v_has_party boolean := false;
begin
  if p_bridge_id is null
     or p_bridge_id !~ '^creature\.bridge\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
     or p_source_ref is null
     or p_source_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
     or p_source_result_ref is null
     or p_source_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or p_source_event_key is null
     or p_source_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or p_party_revision is null or p_party_revision < 0
     or p_occurred_at is null then
    raise exception 'INVALID_CREATURE_ACTIVITY_INGRESS' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_creature_activity:' || p_user::text,0));

  select * into v_existing
    from private.world_creature_activity_events e
   where e.source_event_key = p_source_event_key;
  if found then
    if (v_existing.user_id,v_existing.bridge_id,v_existing.source_ref,
        v_existing.source_result_ref,v_existing.party_revision,v_existing.occurred_at)
       is distinct from
       (p_user,p_bridge_id,p_source_ref,p_source_result_ref,p_party_revision,p_occurred_at) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'event',private.world_creature_activity_event_json_v1(v_existing)
    );
  end if;

  select * into v_existing
    from private.world_creature_activity_events e
   where e.user_id = p_user
     and e.bridge_id = p_bridge_id
     and e.source_result_ref = p_source_result_ref;
  if found then
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'event',private.world_creature_activity_event_json_v1(v_existing)
    );
  end if;

  select * into v_bridge
    from private.world_creature_activity_bridge_catalog b
   where b.bridge_id = p_bridge_id;
  if not found then
    raise exception 'CREATURE_BRIDGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_bridge.status <> 'ACTIVE' then
    raise exception 'CREATURE_BRIDGE_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_party
    from private.world_creature_party_history h
   where h.user_id = p_user
     and h.revision = p_party_revision;
  v_has_party := found;

  if v_has_party and v_party.active_creature_id is not null then
    if not private.world_creature_owned_by_v1(p_user,v_party.active_creature_id) then
      raise exception 'CREATURE_PARTY_HISTORY_INVALID' using errcode = 'P0001';
    end if;

    v_decision := 'ACCEPTED';

    if v_bridge.cooldown_seconds > 0 then
      select max(e.occurred_at) into v_last
        from private.world_creature_activity_events e
       where e.creature_id = v_party.active_creature_id
         and e.bridge_id = p_bridge_id
         and e.decision = 'ACCEPTED'
         and e.occurred_at <= p_occurred_at;
      if v_last is not null
         and p_occurred_at < v_last + make_interval(secs => v_bridge.cooldown_seconds) then
        v_decision := 'NOOP_COOLDOWN';
      end if;
    end if;

    if v_decision = 'ACCEPTED' and v_bridge.daily_cap is not null then
      select count(*) into v_daily_count
        from private.world_creature_activity_events e
       where e.creature_id = v_party.active_creature_id
         and e.bridge_id = p_bridge_id
         and e.decision = 'ACCEPTED'
         and e.occurred_at >= date_trunc('day',p_occurred_at)
         and e.occurred_at < date_trunc('day',p_occurred_at) + interval '1 day';
      if v_daily_count >= v_bridge.daily_cap then
        v_decision := 'NOOP_CAP';
      end if;
    end if;

    if v_decision = 'ACCEPTED' then
      v_xp := v_bridge.xp_amount;
      v_memory_tag := v_bridge.memory_tag;
    end if;
  end if;

  insert into private.world_creature_activity_events(
    user_id,bridge_id,source_ref,source_result_ref,source_event_key,
    party_revision,creature_id,decision,xp_awarded,memory_tag,occurred_at)
  values (
    p_user,p_bridge_id,p_source_ref,p_source_result_ref,p_source_event_key,
    p_party_revision,
    case when v_has_party then v_party.active_creature_id else null end,
    v_decision,v_xp,v_memory_tag,p_occurred_at)
  returning * into v_event;

  if v_decision = 'ACCEPTED' then
    select * into strict v_creature
      from private.world_player_creatures c
     where c.creature_id = v_party.active_creature_id
       and c.user_id = p_user
     for update;
    v_before := v_creature.total_xp;

    if v_xp > 0 then
      insert into private.world_creature_xp_transactions(
        user_id,creature_id,creature_activity_event_id,amount,xp_before,xp_after)
      values (
        p_user,v_creature.creature_id,v_event.creature_activity_event_id,
        v_xp,v_before,v_before+v_xp);

      update private.world_player_creatures c
         set total_xp = c.total_xp + v_xp,
             version = c.version + 1,
             updated_at = now()
       where c.creature_id = v_creature.creature_id;
    end if;

    insert into private.world_creature_memory_tags(
      creature_id,memory_tag,memory_count,first_remembered_at,last_remembered_at,version)
    values (
      v_creature.creature_id,v_memory_tag,1,p_occurred_at,p_occurred_at,1)
    on conflict (creature_id,memory_tag) do update
      set memory_count = private.world_creature_memory_tags.memory_count + 1,
          last_remembered_at = greatest(
            private.world_creature_memory_tags.last_remembered_at,
            excluded.last_remembered_at
          ),
          version = private.world_creature_memory_tags.version + 1;
  end if;

  return jsonb_build_object(
    'status','SUCCESS',
    'event',private.world_creature_activity_event_json_v1(v_event)
  );
end;
$$;
revoke all on function private.world_creature_activity_accept_v1(
  uuid,text,text,text,text,bigint,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_evolution_candidate_v1(
  p_user uuid,
  p_creature_id uuid,
  p_rule_id text,
  p_candidate_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing private.world_creature_evolution_candidates%rowtype;
  v_creature private.world_player_creatures%rowtype;
  v_rule private.world_creature_evolution_rule_catalog%rowtype;
  v_memory_count bigint := 0;
  v_candidate private.world_creature_evolution_candidates%rowtype;
begin
  if p_creature_id is null
     or p_rule_id is null
     or p_rule_id !~ '^creature\.evolution\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
     or p_candidate_key is null
     or p_candidate_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_EVOLUTION_CANDIDATE' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_existing
    from private.world_creature_evolution_candidates c
   where c.candidate_key = p_candidate_key;
  if found then
    if (v_existing.user_id,v_existing.creature_id,v_existing.rule_id)
       is distinct from (p_user,p_creature_id,p_rule_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'candidateId',v_existing.candidate_id,
      'candidateStatus',v_existing.status
    );
  end if;

  select * into v_creature
    from private.world_player_creatures c
   where c.creature_id = p_creature_id
     and c.user_id = p_user;
  if not found then
    raise exception 'CREATURE_NOT_OWNED' using errcode = '42501';
  end if;

  select * into v_rule
    from private.world_creature_evolution_rule_catalog r
   where r.rule_id = p_rule_id;
  if not found or v_rule.status <> 'ACTIVE' then
    raise exception 'EVOLUTION_RULE_INACTIVE' using errcode = 'P0001';
  end if;
  if v_rule.species_id <> v_creature.species_id
     or v_rule.from_form_id <> v_creature.current_form_id then
    raise exception 'EVOLUTION_FORM_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(m.memory_count,0) into v_memory_count
    from private.world_creature_memory_tags m
   where m.creature_id = p_creature_id
     and m.memory_tag = v_rule.required_memory_tag;
  v_memory_count := coalesce(v_memory_count,0);

  if v_memory_count < v_rule.required_memory_count then
    raise exception 'EVOLUTION_MEMORY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into private.world_creature_evolution_candidates(
    user_id,creature_id,rule_id,captured_form_revision,status,candidate_key)
  values (
    p_user,p_creature_id,p_rule_id,v_creature.form_revision,'CANDIDATE',p_candidate_key)
  returning * into v_candidate;

  return jsonb_build_object(
    'status','SUCCESS',
    'candidateId',v_candidate.candidate_id,
    'candidateStatus',v_candidate.status
  );
end;
$$;
revoke all on function private.world_creature_evolution_candidate_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_evolution_context_gate_v1(
  p_user uuid,
  p_candidate_id uuid,
  p_context_ref text,
  p_gate_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_candidate private.world_creature_evolution_candidates%rowtype;
  v_rule private.world_creature_evolution_rule_catalog%rowtype;
  v_creature private.world_player_creatures%rowtype;
begin
  if p_candidate_id is null
     or p_context_ref is null
     or p_context_ref !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,6}$'
     or p_gate_key is null
     or p_gate_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_EVOLUTION_CONTEXT_GATE' using errcode = '22023';
  end if;

  select * into v_candidate
    from private.world_creature_evolution_candidates c
   where c.candidate_id = p_candidate_id
     and c.user_id = p_user
   for update;
  if not found then
    raise exception 'EVOLUTION_CANDIDATE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_candidate.gate_key is not null then
    if v_candidate.gate_key <> p_gate_key or v_candidate.context_ref <> p_context_ref then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'candidateId',v_candidate.candidate_id,
      'candidateStatus',v_candidate.status
    );
  end if;

  if v_candidate.status <> 'CANDIDATE' then
    raise exception 'EVOLUTION_CANDIDATE_NOT_GATEABLE' using errcode = 'P0001';
  end if;

  select * into strict v_rule
    from private.world_creature_evolution_rule_catalog r
   where r.rule_id = v_candidate.rule_id;
  if v_rule.status <> 'ACTIVE' or v_rule.context_ref <> p_context_ref then
    raise exception 'EVOLUTION_CONTEXT_REJECTED' using errcode = 'P0001';
  end if;

  select * into strict v_creature
    from private.world_player_creatures c
   where c.creature_id = v_candidate.creature_id
     and c.user_id = p_user;
  if v_creature.form_revision <> v_candidate.captured_form_revision
     or v_creature.current_form_id <> v_rule.from_form_id then
    raise exception 'EVOLUTION_CANDIDATE_STALE' using errcode = 'P0001';
  end if;

  update private.world_creature_evolution_candidates c
     set status = 'READY',
         gate_key = p_gate_key,
         context_ref = p_context_ref,
         gated_at = now()
   where c.candidate_id = p_candidate_id
  returning * into v_candidate;

  return jsonb_build_object(
    'status','SUCCESS',
    'candidateId',v_candidate.candidate_id,
    'candidateStatus',v_candidate.status
  );
end;
$$;
revoke all on function private.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_creature_evolution_commit_v1(
  p_user uuid,
  p_candidate_id uuid,
  p_commit_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_candidate private.world_creature_evolution_candidates%rowtype;
  v_rule private.world_creature_evolution_rule_catalog%rowtype;
  v_target private.world_creature_form_catalog%rowtype;
  v_creature private.world_player_creatures%rowtype;
  v_event private.world_creature_evolution_events%rowtype;
begin
  if p_candidate_id is null
     or p_commit_key is null
     or p_commit_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_EVOLUTION_COMMIT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_creature_evolution:' || p_user::text,0));

  select * into v_candidate
    from private.world_creature_evolution_candidates c
   where c.candidate_id = p_candidate_id
     and c.user_id = p_user
   for update;
  if not found then
    raise exception 'EVOLUTION_CANDIDATE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_candidate.status = 'COMMITTED' then
    if v_candidate.commit_key <> p_commit_key then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select * into strict v_event
      from private.world_creature_evolution_events e
     where e.candidate_id = p_candidate_id;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'evolutionEventId',v_event.evolution_event_id,
      'creatureId',v_event.creature_id,
      'toFormId',v_event.to_form_id
    );
  end if;

  if v_candidate.status <> 'READY' then
    raise exception 'EVOLUTION_CONTEXT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into strict v_rule
    from private.world_creature_evolution_rule_catalog r
   where r.rule_id = v_candidate.rule_id;
  if v_rule.status <> 'ACTIVE' then
    raise exception 'EVOLUTION_RULE_INACTIVE' using errcode = 'P0001';
  end if;

  select * into strict v_target
    from private.world_creature_form_catalog f
   where f.form_id = v_rule.to_form_id;
  if v_target.status <> 'ACTIVE' then
    raise exception 'EVOLUTION_TARGET_INACTIVE' using errcode = 'P0001';
  end if;

  select * into v_creature
    from private.world_player_creatures c
   where c.creature_id = v_candidate.creature_id
     and c.user_id = p_user
   for update;
  if not found then
    raise exception 'CREATURE_NOT_OWNED' using errcode = '42501';
  end if;
  if v_creature.form_revision <> v_candidate.captured_form_revision
     or v_creature.current_form_id <> v_rule.from_form_id then
    raise exception 'EVOLUTION_CANDIDATE_STALE' using errcode = 'P0001';
  end if;

  update private.world_player_creatures c
     set current_form_id = v_rule.to_form_id,
         form_revision = c.form_revision + 1,
         version = c.version + 1,
         updated_at = now()
   where c.creature_id = v_creature.creature_id;

  update private.world_creature_evolution_candidates c
     set status = 'COMMITTED',
         commit_key = p_commit_key,
         committed_at = now()
   where c.candidate_id = p_candidate_id
  returning * into v_candidate;

  insert into private.world_creature_evolution_events(
    user_id,creature_id,candidate_id,rule_id,from_form_id,to_form_id,
    form_revision_before,form_revision_after)
  values (
    p_user,v_creature.creature_id,p_candidate_id,v_rule.rule_id,
    v_rule.from_form_id,v_rule.to_form_id,
    v_creature.form_revision,v_creature.form_revision+1)
  returning * into v_event;

  return jsonb_build_object(
    'status','SUCCESS',
    'evolutionEventId',v_event.evolution_event_id,
    'creatureId',v_event.creature_id,
    'fromFormId',v_event.from_form_id,
    'toFormId',v_event.to_form_id,
    'formRevisionAfter',v_event.form_revision_after
  );
end;
$$;
revoke all on function private.world_creature_evolution_commit_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;

-- Public API remains server-only in P0. Browser clients must go through a verified adapter.
create or replace function public.world_creature_observe_v1(
  p_user uuid,p_species_id text,p_source_type text,p_source_ref text,p_result_ref text,p_idempotency_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_observe_v1(
    p_user,p_species_id,p_source_type,p_source_ref,p_result_ref,p_idempotency_key);
end;
$$;

create or replace function public.world_creature_grant_v1(
  p_user uuid,p_species_id text,p_form_id text,p_source_ref text,p_acquisition_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_grant_v1(
    p_user,p_species_id,p_form_id,p_source_ref,p_acquisition_key);
end;
$$;

create or replace function public.world_creature_party_set_v1(
  p_user uuid,p_active_creature_id uuid,p_reserve1_creature_id uuid,p_reserve2_creature_id uuid,
  p_expected_revision bigint,p_mutation_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_party_set_v1(
    p_user,p_active_creature_id,p_reserve1_creature_id,p_reserve2_creature_id,
    p_expected_revision,p_mutation_key);
end;
$$;

create or replace function public.world_creature_core_snapshot_v1(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_core_snapshot_v1(p_user);
end;
$$;

create or replace function public.world_creature_activity_accept_v1(
  p_user uuid,p_bridge_id text,p_source_ref text,p_source_result_ref text,
  p_source_event_key text,p_party_revision bigint,p_occurred_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_activity_accept_v1(
    p_user,p_bridge_id,p_source_ref,p_source_result_ref,
    p_source_event_key,p_party_revision,p_occurred_at);
end;
$$;

create or replace function public.world_creature_evolution_candidate_v1(
  p_user uuid,p_creature_id uuid,p_rule_id text,p_candidate_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_evolution_candidate_v1(
    p_user,p_creature_id,p_rule_id,p_candidate_key);
end;
$$;

create or replace function public.world_creature_evolution_context_gate_v1(
  p_user uuid,p_candidate_id uuid,p_context_ref text,p_gate_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_evolution_context_gate_v1(
    p_user,p_candidate_id,p_context_ref,p_gate_key);
end;
$$;

create or replace function public.world_creature_evolution_commit_v1(
  p_user uuid,p_candidate_id uuid,p_commit_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_creature_evolution_commit_v1(
    p_user,p_candidate_id,p_commit_key);
end;
$$;

revoke execute on function public.world_creature_observe_v1(uuid,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_grant_v1(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_core_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_activity_accept_v1(
  uuid,text,text,text,text,bigint,timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_evolution_candidate_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_creature_evolution_commit_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function public.world_creature_observe_v1(uuid,text,text,text,text,text)
  to service_role;
grant execute on function public.world_creature_grant_v1(uuid,text,text,text,text)
  to service_role;
grant execute on function public.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)
  to service_role;
grant execute on function public.world_creature_core_snapshot_v1(uuid)
  to service_role;
grant execute on function public.world_creature_activity_accept_v1(
  uuid,text,text,text,text,bigint,timestamptz)
  to service_role;
grant execute on function public.world_creature_evolution_candidate_v1(uuid,uuid,text,text)
  to service_role;
grant execute on function public.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)
  to service_role;
grant execute on function public.world_creature_evolution_commit_v1(uuid,uuid,text)
  to service_role;