-- INHA WORLD Gathering P1: trusted presence consumer + player API/read surface.
--
-- This migration does NOT establish an authoritative world-position producer and does not activate
-- Gathering. The runtime/source/Life/Collection gates stay as they were. Player exposure remains
-- additionally gated by WORLD_GATHERING_API_ENABLED on the server.
--
-- Browser pose, Realtime presence and telemetry are not trusted evidence. Only service_role may
-- publish observations, and a future producer must derive them from authoritative movement/state.

alter table private.world_gathering_runtime
  add column if not exists presence_required boolean not null default true;

alter table private.world_gathering_source_catalog
  add column if not exists x double precision,
  add column if not exists z double precision,
  add column if not exists radius double precision,
  add column if not exists min_y double precision,
  add column if not exists max_y double precision;

update private.world_gathering_source_catalog
   set x=80.86579271812072,
       z=-74.43269999979925,
       radius=2.0,
       min_y=-1,
       max_y=4
 where source_ref='gathering.campus.leaf_pile_01';

alter table private.world_gathering_source_catalog
  alter column x set not null,
  alter column z set not null,
  alter column radius set not null,
  alter column min_y set not null,
  alter column max_y set not null;

alter table private.world_gathering_source_catalog
  add constraint world_gathering_source_geometry
  check (
    x between -10000 and 10000
    and z between -10000 and 10000
    and radius > 0 and radius <= 5
    and max_y > min_y
  );

create table private.world_gathering_positions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  revision bigint not null check (revision > 0),
  x double precision not null check (x between -10000 and 10000),
  y double precision not null check (y between -10000 and 10000),
  z double precision not null check (z between -10000 and 10000),
  space text not null check (space in ('CAMPUS','OTHER')),
  mode text not null check (mode in ('ON_FOOT','INELIGIBLE')),
  observed_at timestamptz not null
);
alter table private.world_gathering_positions enable row level security;
revoke all on table private.world_gathering_positions
  from public,anon,authenticated,service_role;

create function private.world_gathering_require_server_v1(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  if private.world_activity_account_ok_v1(p_user) is not true then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.world_gathering_require_server_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.world_gathering_observe_position_v1(
  p_user uuid,p_session_id uuid,p_revision bigint,
  p_x double precision,p_y double precision,p_z double precision,
  p_space text,p_mode text,p_observed_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old private.world_gathering_positions%rowtype;
  v_now timestamptz;
begin
  perform private.world_gathering_require_server_v1(p_user);
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  v_now:=clock_timestamp();
  if p_session_id is null or p_revision is null or p_revision <= 0
     or p_x is null or p_x not between -10000 and 10000
     or p_y is null or p_y not between -10000 and 10000
     or p_z is null or p_z not between -10000 and 10000
     or p_space is null or p_space not in ('CAMPUS','OTHER')
     or p_mode is null or p_mode not in ('ON_FOOT','INELIGIBLE')
     or p_observed_at is null or p_observed_at > v_now then
    raise exception 'GATHERING_POSITION_INVALID' using errcode='22023';
  end if;

  select * into v_old
    from private.world_gathering_positions
   where user_id=p_user
   for update;

  if found and p_revision < v_old.revision then
    return jsonb_build_object('status','STALE','revision',v_old.revision);
  end if;
  if found and p_revision = v_old.revision then
    if (p_session_id,p_x,p_y,p_z,p_space,p_mode,p_observed_at) is distinct from
       (v_old.session_id,v_old.x,v_old.y,v_old.z,v_old.space,v_old.mode,v_old.observed_at) then
      raise exception 'GATHERING_POSITION_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('status','ALREADY_PROCESSED','revision',v_old.revision);
  end if;
  if p_observed_at <= v_now-interval '5 seconds' then
    raise exception 'GATHERING_POSITION_STALE' using errcode='22023';
  end if;

  insert into private.world_gathering_positions(
    user_id,session_id,revision,x,y,z,space,mode,observed_at)
  values (
    p_user,p_session_id,p_revision,p_x,p_y,p_z,p_space,p_mode,p_observed_at)
  on conflict(user_id) do update
    set session_id=excluded.session_id,
        revision=excluded.revision,
        x=excluded.x,
        y=excluded.y,
        z=excluded.z,
        space=excluded.space,
        mode=excluded.mode,
        observed_at=excluded.observed_at;

  return jsonb_build_object('status','OBSERVED','revision',p_revision);
end;
$$;

revoke execute on function public.world_gathering_observe_position_v1(
  uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.world_gathering_observe_position_v1(
  uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)
  to service_role;

create function private.world_gathering_require_position_v1(
  p_user uuid,p_source_ref text)
returns private.world_gathering_positions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position private.world_gathering_positions%rowtype;
  v_source private.world_gathering_source_catalog%rowtype;
begin
  select * into v_position
    from private.world_gathering_positions
   where user_id=p_user
   for share;
  if not found then
    raise exception 'GATHERING_POSITION_UNAVAILABLE' using errcode='P0001';
  end if;
  if v_position.observed_at > clock_timestamp()
     or v_position.observed_at <= clock_timestamp()-interval '5 seconds' then
    raise exception 'GATHERING_POSITION_STALE' using errcode='P0001';
  end if;
  if v_position.space <> 'CAMPUS' or v_position.mode <> 'ON_FOOT' then
    raise exception 'GATHERING_POSITION_INELIGIBLE' using errcode='P0001';
  end if;

  select * into strict v_source
    from private.world_gathering_source_catalog
   where source_ref=p_source_ref;
  if (v_position.x-v_source.x)^2+(v_position.z-v_source.z)^2 > v_source.radius^2
     or v_position.y < v_source.min_y or v_position.y > v_source.max_y then
    raise exception 'GATHERING_OUT_OF_RANGE' using errcode='P0001';
  end if;
  return v_position;
end;
$$;
revoke all on function private.world_gathering_require_position_v1(uuid,text)
  from public,anon,authenticated,service_role;

create function public.world_gathering_read_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_runtime private.world_gathering_runtime%rowtype;
  v_source private.world_gathering_source_catalog%rowtype;
  v_skill_status text;
  v_collection_status text;
  v_reason text;
begin
  perform private.world_gathering_require_server_v1(p_user);
  select * into strict v_runtime from private.world_gathering_runtime where singleton;
  select * into strict v_source from private.world_gathering_source_catalog
    where source_ref='gathering.campus.leaf_pile_01';
  select status into strict v_skill_status from private.world_life_skill_catalog where skill_id='life.gathering';
  select status into strict v_collection_status from private.world_collection_entry_catalog
    where entry_id='collection.plant.campus_leaf';

  v_reason := case
    when not v_runtime.enabled then 'GATHERING_UNAVAILABLE'
    when v_source.status <> 'ACTIVE' then 'GATHERING_SOURCE_UNAVAILABLE'
    when v_skill_status <> 'ACTIVE' then 'LIFE_SKILL_INACTIVE'
    when v_collection_status <> 'ACTIVE' then 'COLLECTION_ENTRY_INACTIVE'
    else null
  end;

  return jsonb_build_object(
    'available',v_reason is null,
    'reason',v_reason,
    'sourceRef',v_source.source_ref,
    'presenceRequired',v_runtime.presence_required
  );
end;
$$;
revoke execute on function public.world_gathering_read_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.world_gathering_read_v1(uuid)
  to service_role;

create or replace function public.world_gathering_harvest_v1(
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
  perform private.world_gathering_require_server_v1(p_user);
  if p_source_ref is null
     or p_source_ref !~ '^gathering\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
     or char_length(p_source_ref) > 160
     or p_client_attempt_key is null then
    raise exception 'INVALID_GATHERING_IDENTITY' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));

  -- Exact replay remains recoverable even after the player moved away.
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

  if v_runtime.presence_required then
    perform private.world_gathering_require_position_v1(p_user,p_source_ref);
  end if;

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
