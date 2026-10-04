-- Fishing F3: consume trusted world-server observations; never browser pose/presence.
-- No browser position-ingest endpoint is created. Until a trusted producer exists, new casts
-- and active HOOK commands fail closed. The HTTP exposure flag remains a separate operator gate.
alter table private.world_fishing_runtime add column presence_required boolean not null default true;

create table private.world_fishing_spots (
  source_ref text primary key,
  x double precision not null,
  z double precision not null,
  radius double precision not null check (radius > 0 and radius <= 3),
  min_y double precision not null,
  max_y double precision not null check (max_y > min_y)
);
-- CampusCoordinateFrame local coordinates; same two shore points as fishing-spots.js.
insert into private.world_fishing_spots(source_ref,x,z,radius,min_y,max_y) values
 ('fishing.inkyung.north_01',129.77100098688555,48.14517277694196,3,-1,4),
 ('fishing.inkyung.south_01',116.87007679393874,-6.097417122539438,3,-1,4);

create table private.world_fishing_positions (
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
-- One seat per semantic spot, and one occupied spot per account. Expiry is the attempt TTL.
create table private.world_fishing_spot_leases (
  source_ref text primary key references private.world_fishing_spots(source_ref),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  attempt_id uuid not null unique references private.world_activity_attempts(attempt_id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null
);
alter table private.world_fishing_spots enable row level security;
alter table private.world_fishing_positions enable row level security;
alter table private.world_fishing_spot_leases enable row level security;
revoke all on table private.world_fishing_spots, private.world_fishing_positions, private.world_fishing_spot_leases
  from public,anon,authenticated,service_role;

-- The issuer is a trusted server, not the browser, telemetry heartbeat or Realtime presence.
-- Revisions must increase across session changes, not restart at 1 on each tab. A replay never
-- refreshes the evidence timestamp. Observations expire after 5s and may not be future-dated.
create function public.world_fishing_observe_position_v1(
  p_user uuid,p_session_id uuid,p_revision bigint,
  p_x double precision,p_y double precision,p_z double precision,
  p_space text,p_mode text,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old private.world_fishing_positions%rowtype; v_now timestamptz;
begin
  perform private.world_fishing_require_server_v1(p_user);
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  v_now:=clock_timestamp();
  if p_session_id is null or p_revision is null or p_revision <= 0
     or p_x is null or p_x not between -10000 and 10000
     or p_y is null or p_y not between -10000 and 10000
     or p_z is null or p_z not between -10000 and 10000
     or p_space is null or p_space not in ('CAMPUS','OTHER')
     or p_mode is null or p_mode not in ('ON_FOOT','INELIGIBLE')
     or p_observed_at is null or p_observed_at > v_now then
    raise exception 'FISHING_POSITION_INVALID' using errcode='22023';
  end if;
  select * into v_old from private.world_fishing_positions where user_id=p_user for update;
  if found and p_revision < v_old.revision then
    return jsonb_build_object('status','STALE','revision',v_old.revision);
  end if;
  if found and p_revision = v_old.revision then
    if (p_session_id,p_x,p_y,p_z,p_space,p_mode,p_observed_at) is distinct from
       (v_old.session_id,v_old.x,v_old.y,v_old.z,v_old.space,v_old.mode,v_old.observed_at) then
      raise exception 'FISHING_POSITION_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('status','ALREADY_PROCESSED','revision',v_old.revision);
  end if;
  if p_observed_at <= v_now-interval '5 seconds' then
    raise exception 'FISHING_POSITION_STALE' using errcode='22023';
  end if;
  insert into private.world_fishing_positions(user_id,session_id,revision,x,y,z,space,mode,observed_at)
    values(p_user,p_session_id,p_revision,p_x,p_y,p_z,p_space,p_mode,p_observed_at)
    on conflict(user_id) do update set session_id=excluded.session_id,revision=excluded.revision,
      x=excluded.x,y=excluded.y,z=excluded.z,space=excluded.space,mode=excluded.mode,observed_at=excluded.observed_at;
  return jsonb_build_object('status','OBSERVED','revision',p_revision);
end;
$$;
revoke all on function public.world_fishing_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.world_fishing_observe_position_v1(uuid,uuid,bigint,double precision,double precision,double precision,text,text,timestamptz)
  to service_role;

-- Caller already holds the Activity account lock, so an observation cannot change under HOOK.
create function private.world_fishing_require_position_v1(p_user uuid,p_source_ref text)
returns private.world_fishing_positions language plpgsql security definer set search_path = '' as $$
declare v_position private.world_fishing_positions%rowtype; v_spot private.world_fishing_spots%rowtype;
begin
  select * into v_position from private.world_fishing_positions where user_id=p_user for share;
  if not found then raise exception 'FISHING_POSITION_UNAVAILABLE' using errcode='P0001'; end if;
  if v_position.observed_at > clock_timestamp()
     or v_position.observed_at <= clock_timestamp()-interval '5 seconds' then
    raise exception 'FISHING_POSITION_STALE' using errcode='P0001';
  end if;
  if v_position.space <> 'CAMPUS' or v_position.mode <> 'ON_FOOT' then
    raise exception 'FISHING_POSITION_INELIGIBLE' using errcode='P0001';
  end if;
  select * into strict v_spot from private.world_fishing_spots where source_ref=p_source_ref;
  if (v_position.x-v_spot.x)^2+(v_position.z-v_spot.z)^2 > v_spot.radius^2
     or v_position.y < v_spot.min_y or v_position.y > v_spot.max_y then
    raise exception 'FISHING_OUT_OF_RANGE' using errcode='P0001';
  end if;
  return v_position;
end;
$$;
revoke all on function private.world_fishing_require_position_v1(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.world_fishing_start_v1(p_user uuid,p_source_ref text,p_client_attempt_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_config private.world_fishing_runtime%rowtype; v_row record; v_start jsonb; v_snapshot jsonb;
  v_now bigint; v_wait bigint; v_id uuid; v_last bigint;
  v_position private.world_fishing_positions%rowtype;
begin
  perform private.world_fishing_require_server_v1(p_user);
  if p_source_ref is null or p_source_ref not in ('fishing.inkyung.north_01','fishing.inkyung.south_01')
     or p_client_attempt_key is null then raise exception 'INVALID_FISHING_IDENTITY' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  select f.snapshot,a.source_ref into v_row from private.world_activity_attempts a
    left join private.world_fishing_attempt_snapshots f on f.attempt_id=a.attempt_id
    where a.user_id=p_user and a.client_attempt_key=p_client_attempt_key;
  if found then
    if v_row.snapshot is null or v_row.source_ref <> p_source_ref then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    v_snapshot := private.world_fishing_expire_v1(p_user,v_row.snapshot);
    return jsonb_build_object('status','ALREADY_PROCESSED','attempt',private.world_fishing_project_v1(v_snapshot));
  end if;
  -- Reconcile expired records before enforcing one fishing attempt across BOTH sources.
  for v_row in select * from private.world_fishing_attempt_snapshots
    where user_id=p_user and snapshot->>'status'='ACTIVE' for update loop
    v_snapshot := private.world_fishing_expire_v1(p_user,v_row.snapshot);
    if v_snapshot->>'status'='ACTIVE' then
      raise exception 'ATTEMPT_ALREADY_ACTIVE' using errcode='P0001';
    end if;
  end loop;
  select * into strict v_config from private.world_fishing_runtime where singleton for share;
  if not v_config.enabled then raise exception 'FISHING_UNAVAILABLE' using errcode='P0001'; end if;
  perform private.world_fishing_policy_validate_v1(v_config.policy);
  if v_config.minimum_start_interval_ms is null then
    raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
  end if;
  v_now := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if v_now + (v_config.policy->>'attemptTtlMs')::bigint > 9007199254740991 then
    raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
  end if;
  select max((snapshot->>'startedAtMs')::bigint) into v_last
    from private.world_fishing_attempt_snapshots where user_id=p_user;
  if v_last is not null and v_now-v_last < v_config.minimum_start_interval_ms then
    raise exception 'FISHING_RATE_LIMITED' using errcode='P0001';
  end if;
  if v_config.presence_required then
    v_position:=private.world_fishing_require_position_v1(p_user,p_source_ref);
    perform pg_advisory_xact_lock(hashtextextended('world_fishing_spot:' || p_source_ref,0));
    -- The lock wait must not turn a previously fresh observation into an accepted stale cast.
    v_position:=private.world_fishing_require_position_v1(p_user,p_source_ref);
    v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
    delete from private.world_fishing_spot_leases
      where source_ref=p_source_ref and expires_at<=clock_timestamp();
    if exists(select 1 from private.world_fishing_spot_leases where source_ref=p_source_ref) then
      raise exception 'FISHING_SPOT_OCCUPIED' using errcode='P0001';
    end if;
  end if;
  v_wait := (v_config.policy->>'minWaitMs')::bigint + floor(random() *
    ((v_config.policy->>'maxWaitMs')::bigint-(v_config.policy->>'minWaitMs')::bigint+1))::bigint;
  -- The bridge requires life.fishing ACTIVE and binds the Creature party revision at start.
  v_start := private.world_life_activity_start_with_creature_v1(p_user,'activity.fishing.inkyung',p_source_ref,
    p_client_attempt_key,1,1,
    to_timestamp((v_now+(v_config.policy->>'attemptTtlMs')::bigint)::double precision/1000));
  if v_start->'activity'->>'status' is distinct from 'STARTED' then
    raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505';
  end if;
  v_id := (v_start->'activity'->'attempt'->>'attemptId')::uuid;
  v_snapshot := jsonb_build_object(
    'activityId','activity.fishing.inkyung','sourceRef',p_source_ref,'clientAttemptKey',p_client_attempt_key,
    'attemptId',v_id,'actorUserId',p_user,'nonce',gen_random_uuid(),
    'resolverVersion','resolver.fishing.inkyung_v1','definitionVersion',1,'outcomeSchemaVersion',1,
    'status','ACTIVE','startedAtMs',v_now,'biteAtMs',v_now+v_wait,
    'hookDeadlineMs',v_now+v_wait+(v_config.policy->>'responseWindowMs')::bigint,
    'expiresAtMs',v_now+(v_config.policy->>'attemptTtlMs')::bigint,
    'policy',v_config.policy,'terminalAction',null,'result',null);
  insert into private.world_fishing_attempt_snapshots values (v_id,p_user,v_snapshot);
  if v_config.presence_required then
    insert into private.world_fishing_spot_leases(source_ref,user_id,attempt_id,session_id,expires_at)
      values(p_source_ref,p_user,v_id,v_position.session_id,
        to_timestamp((v_snapshot->>'expiresAtMs')::double precision/1000));
  end if;
  return jsonb_build_object('status','STARTED','attempt',private.world_fishing_project_v1(v_snapshot));
end;
$$;

create or replace function public.world_fishing_input_v1(
  p_user uuid,p_attempt_id uuid,p_source_ref text,p_nonce uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_next jsonb; v_now bigint;
  v_position private.world_fishing_positions%rowtype; v_lease private.world_fishing_spot_leases%rowtype;
begin
  perform private.world_fishing_require_server_v1(p_user);
  if p_action is null or p_action not in ('HOOK','CANCEL') then
    raise exception 'INVALID_FISHING_ACTION' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  select snapshot into v_snapshot from private.world_fishing_attempt_snapshots
    where attempt_id=p_attempt_id and user_id=p_user for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0002'; end if;
  if p_source_ref is distinct from v_snapshot->>'sourceRef'
     or p_nonce is distinct from (v_snapshot->>'nonce')::uuid then
    raise exception 'FISHING_IDENTITY_MISMATCH' using errcode='22023';
  end if;
  if v_snapshot->>'status' <> 'ACTIVE' then
    if v_snapshot->>'terminalAction' <> 'EXPIRE' and v_snapshot->>'terminalAction' <> p_action then
      raise exception 'TERMINAL_COMMAND_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('status','ALREADY_PROCESSED','attempt',private.world_fishing_project_v1(v_snapshot));
  end if;
  v_now := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  -- CANCEL, expired outcomes and terminal replay remain recoverable without a live position.
  if p_action='HOOK' and v_now<(v_snapshot->>'expiresAtMs')::bigint
     and (select presence_required from private.world_fishing_runtime where singleton) then
    v_position:=private.world_fishing_require_position_v1(p_user,p_source_ref);
    select * into v_lease from private.world_fishing_spot_leases
      where source_ref=p_source_ref and user_id=p_user and attempt_id=p_attempt_id for update;
    if not found or v_lease.expires_at<=clock_timestamp() then
      raise exception 'FISHING_LEASE_LOST' using errcode='P0001';
    end if;
    if v_position.session_id<>v_lease.session_id then
      raise exception 'FISHING_SESSION_CHANGED' using errcode='P0001';
    end if;
  end if;
  v_next := private.world_fishing_commit_v1(p_user,p_attempt_id,
    private.world_fishing_resolve_v1(v_snapshot,p_action,v_now));
  return jsonb_build_object('status','RESOLVED','attempt',private.world_fishing_project_v1(v_next));
end;
$$;

create or replace function private.world_fishing_commit_v1(p_user uuid,p_attempt_id uuid,p_next jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner private.world_activity_attempts%rowtype; v_reply jsonb;
begin
  select * into strict v_owner from private.world_activity_attempts
    where attempt_id=p_attempt_id and user_id=p_user for update;
  if v_owner.status='EXPIRED' then
    p_next := private.world_fishing_finish_v1(p_next,'EXPIRED','ATTEMPT_EXPIRED',
      p_next->>'terminalAction',floor(extract(epoch from clock_timestamp())*1000)::bigint);
  elsif v_owner.status <> 'ACTIVE' then
    raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505';
  else
    -- Same transaction as the bridge decision: Creature growth only ever follows this outcome.
    v_reply := private.world_life_activity_finalize_with_creature_v1(p_user,p_attempt_id,p_next->>'status',
      p_next->'result'->>'reason',case when p_next->>'status'='SUCCEEDED' then p_next->'result'->>'resultRef' else null end);
    if v_reply->'activity'->'attempt'->>'status'='EXPIRED' then
      p_next := private.world_fishing_finish_v1(p_next,'EXPIRED','ATTEMPT_EXPIRED',
        p_next->>'terminalAction',floor(extract(epoch from clock_timestamp())*1000)::bigint);
    end if;
  end if;
  update private.world_fishing_attempt_snapshots set snapshot=p_next where attempt_id=p_attempt_id and user_id=p_user;
  -- Includes cancellation, failed/early HOOK and expiry reconciled by a read.
  delete from private.world_fishing_spot_leases where attempt_id=p_attempt_id and user_id=p_user;
  return p_next;
end;
$$;
