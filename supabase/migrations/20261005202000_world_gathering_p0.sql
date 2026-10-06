-- INHA WORLD Gathering P0: closed server-authoritative instant harvest foundation.
--
-- Scope:
-- - one semantic source: gathering.campus.leaf_pile_01
-- - frozen output: material.campus_leaf x1 + collection.plant.campus_leaf + life.gathering XP
-- - one service-role transaction performs Activity start -> verified success -> settlement
-- - exact retry replays the committed receipt; conflicting identity is refused
-- - runtime and source stay disabled/COMING_SOON; Life/Collection activation and player exposure are deferred
--
-- No browser position, Realtime pose, raw XYZ, reward amount or XP amount is accepted from the client.
-- A future player-facing adapter must add trusted world-presence evidence before enabling the runtime.

create table private.world_gathering_runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  policy jsonb,
  minimum_harvest_interval_ms bigint check (minimum_harvest_interval_ms > 0)
);
insert into private.world_gathering_runtime(singleton) values (true);

create table private.world_gathering_source_catalog (
  source_ref text primary key
    check (source_ref ~ '^gathering\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(source_ref) <= 160),
  activity_id text not null
    check (activity_id = 'activity.gathering.campus'),
  item_id text not null references private.world_item_catalog(item_id) on delete restrict,
  collection_entry_id text not null references private.world_collection_entry_catalog(entry_id) on delete restrict,
  skill_id text not null references private.world_life_skill_catalog(skill_id) on delete restrict,
  quantity integer not null check (quantity between 1 and 99),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1),
  created_at timestamptz not null default now()
);
insert into private.world_gathering_source_catalog(
  source_ref,activity_id,item_id,collection_entry_id,skill_id,quantity,status,definition_version)
values (
  'gathering.campus.leaf_pile_01',
  'activity.gathering.campus',
  'material.campus_leaf',
  'collection.plant.campus_leaf',
  'life.gathering',
  1,
  'COMING_SOON',
  1
);

create table private.world_gathering_attempt_snapshots (
  attempt_id uuid primary key references private.world_activity_attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_ref text not null references private.world_gathering_source_catalog(source_ref) on delete restrict,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now()
);
create index world_gathering_attempt_user_idx
  on private.world_gathering_attempt_snapshots(user_id,created_at desc);

alter table private.world_gathering_runtime enable row level security;
alter table private.world_gathering_source_catalog enable row level security;
alter table private.world_gathering_attempt_snapshots enable row level security;
revoke all on table
  private.world_gathering_runtime,
  private.world_gathering_source_catalog,
  private.world_gathering_attempt_snapshots
from public,anon,authenticated,service_role;

create function private.world_gathering_snapshot_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'GATHERING_SNAPSHOT_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function private.world_gathering_snapshot_guard_v1()
  from public,anon,authenticated,service_role;

create trigger world_gathering_snapshot_guard
  before update or delete on private.world_gathering_attempt_snapshots
  for each row execute function private.world_gathering_snapshot_guard_v1();

create function private.world_gathering_policy_validate_v1(p_policy jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_xp numeric;
begin
  if p_policy is null or jsonb_typeof(p_policy) <> 'object'
     or not p_policy ?& array['policyVersion','lifeXp']
     or (select count(*) from jsonb_object_keys(p_policy)) <> 2
     or jsonb_typeof(p_policy->'policyVersion') <> 'string'
     or p_policy->>'policyVersion' !~ '^gathering\.[a-z][a-z0-9_.]{0,70}$'
     or jsonb_typeof(p_policy->'lifeXp') <> 'number' then
    raise exception 'GATHERING_POLICY_INVALID' using errcode='22023';
  end if;
  v_xp := (p_policy->>'lifeXp')::numeric;
  if v_xp <> trunc(v_xp) or v_xp not between 1 and 1000000 then
    raise exception 'GATHERING_POLICY_INVALID' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.world_gathering_policy_validate_v1(jsonb)
  from public,anon,authenticated,service_role;

create function public.world_gathering_harvest_v1(
  p_user uuid,
  p_source_ref text,
  p_client_attempt_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_runtime private.world_gathering_runtime%rowtype;
  v_source private.world_gathering_source_catalog%rowtype;
  v_attempt private.world_activity_attempts%rowtype;
  v_start jsonb;
  v_finalize jsonb;
  v_snapshot jsonb;
  v_receipt jsonb;
  v_settlement jsonb;
  v_plan jsonb;
  v_attempt_id uuid;
  v_result_ref text;
  v_last_started timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  if p_user is null or private.world_activity_account_ok_v1(p_user) is not true then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^gathering\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
     or char_length(p_source_ref) > 160
     or p_client_attempt_key is null then
    raise exception 'INVALID_GATHERING_IDENTITY' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));

  -- Exact retry returns the already committed immutable result and receipt.
  select * into v_attempt
    from private.world_activity_attempts a
   where a.user_id=p_user and a.client_attempt_key=p_client_attempt_key;
  if found then
    if v_attempt.activity_id <> 'activity.gathering.campus'
       or v_attempt.source_ref <> p_source_ref then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    select g.snapshot into v_snapshot
      from private.world_gathering_attempt_snapshots g
     where g.attempt_id=v_attempt.attempt_id and g.user_id=p_user;
    select s.receipt into v_receipt
      from private.world_activity_settlements s
     where s.attempt_id=v_attempt.attempt_id and s.user_id=p_user;
    if v_snapshot is null or v_receipt is null or v_attempt.status <> 'SUCCEEDED' then
      raise exception 'GATHERING_COMMITTED_STATE_INVALID' using errcode='P0001';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'attemptId',v_attempt.attempt_id,
      'sourceRef',p_source_ref,
      'output',v_snapshot->'output',
      'receipt',v_receipt
    );
  end if;

  select * into strict v_runtime
    from private.world_gathering_runtime where singleton for share;
  if not v_runtime.enabled then
    raise exception 'GATHERING_UNAVAILABLE' using errcode='P0001';
  end if;
  perform private.world_gathering_policy_validate_v1(v_runtime.policy);
  if v_runtime.minimum_harvest_interval_ms is null then
    raise exception 'GATHERING_POLICY_INVALID' using errcode='22023';
  end if;

  select * into v_source
    from private.world_gathering_source_catalog s
   where s.source_ref=p_source_ref;
  if not found or v_source.status <> 'ACTIVE' then
    raise exception 'GATHERING_SOURCE_UNAVAILABLE' using errcode='P0001';
  end if;

  select max(a.created_at) into v_last_started
    from private.world_activity_attempts a
   where a.user_id=p_user and a.activity_id='activity.gathering.campus';
  if v_last_started is not null
     and clock_timestamp() < v_last_started + v_runtime.minimum_harvest_interval_ms * interval '1 millisecond' then
    raise exception 'GATHERING_RATE_LIMITED' using errcode='P0001';
  end if;

  -- Life -> Creature wrapper binds the current party revision and also refuses an inactive Life Skill.
  v_start := private.world_life_activity_start_with_creature_v1(
    p_user,
    v_source.activity_id,
    v_source.source_ref,
    p_client_attempt_key,
    v_source.definition_version,
    1,
    null
  );
  if v_start->'activity'->>'status' is distinct from 'STARTED' then
    raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505';
  end if;
  v_attempt_id := (v_start->'activity'->'attempt'->>'attemptId')::uuid;
  v_result_ref := 'gathering_result:' || v_attempt_id::text;

  v_snapshot := jsonb_build_object(
    'activityId',v_source.activity_id,
    'attemptId',v_attempt_id,
    'sourceRef',v_source.source_ref,
    'resolverVersion','resolver.gathering.campus_v1',
    'definitionVersion',v_source.definition_version,
    'policy',v_runtime.policy,
    'output',jsonb_build_object(
      'itemId',v_source.item_id,
      'quantity',v_source.quantity,
      'collectionEntryId',v_source.collection_entry_id,
      'skillId',v_source.skill_id,
      'lifeXp',(v_runtime.policy->>'lifeXp')::bigint
    ),
    'resultRef',v_result_ref
  );
  insert into private.world_gathering_attempt_snapshots(
    attempt_id,user_id,source_ref,snapshot)
  values (v_attempt_id,p_user,v_source.source_ref,v_snapshot);

  v_finalize := private.world_life_activity_finalize_with_creature_v1(
    p_user,v_attempt_id,'SUCCEEDED','HARVESTED',v_result_ref);
  if v_finalize->'activity'->'attempt'->>'status' is distinct from 'SUCCEEDED' then
    raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505';
  end if;

  v_plan := jsonb_build_object(
    'items',jsonb_build_array(jsonb_build_object(
      'itemId',v_source.item_id,'quantity',v_source.quantity)),
    'discoveries',jsonb_build_array(jsonb_build_object(
      'entryId',v_source.collection_entry_id)),
    'lifeXp',jsonb_build_array(jsonb_build_object(
      'skillId',v_source.skill_id,'amount',(v_runtime.policy->>'lifeXp')::bigint))
  );
  v_settlement := private.world_activity_settle_v1(p_user,v_attempt_id,v_plan);
  if v_settlement->>'status' is distinct from 'SETTLED' then
    raise exception 'GATHERING_SETTLEMENT_INVALID' using errcode='P0001';
  end if;

  return jsonb_build_object(
    'status','HARVESTED',
    'attemptId',v_attempt_id,
    'sourceRef',v_source.source_ref,
    'output',v_snapshot->'output',
    'receipt',v_settlement->'receipt'
  );
end;
$$;

revoke execute on function public.world_gathering_harvest_v1(uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.world_gathering_harvest_v1(uuid,text,uuid)
  to service_role;
