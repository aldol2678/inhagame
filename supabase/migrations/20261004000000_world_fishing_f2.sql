-- F2 development candidate: disabled by default, no catalog activation or balance defaults.
-- DB adaptation of the F1 timing contract; conformance is checked against fishing-core.js.
create table private.world_fishing_runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  policy jsonb,
  minimum_start_interval_ms bigint check (minimum_start_interval_ms > 0)
);
insert into private.world_fishing_runtime(singleton) values (true);

create table private.world_fishing_attempt_snapshots (
  attempt_id uuid primary key references private.world_activity_attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
create index world_fishing_user_idx on private.world_fishing_attempt_snapshots(user_id);
create table private.world_fishing_settlements (
  attempt_id uuid primary key references private.world_fishing_attempt_snapshots(attempt_id) on delete cascade,
  result_ref text not null unique,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object')
);
alter table private.world_fishing_runtime enable row level security;
alter table private.world_fishing_attempt_snapshots enable row level security;
alter table private.world_fishing_settlements enable row level security;
revoke all on table private.world_fishing_runtime, private.world_fishing_attempt_snapshots,
  private.world_fishing_settlements from public, anon, authenticated, service_role;

create function private.world_fishing_snapshot_guard_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.snapshot->>'status' <> 'ACTIVE' then
    raise exception 'FISHING_TERMINAL_IMMUTABLE' using errcode='42501';
  end if;
  if (new.attempt_id,new.user_id,new.snapshot - array['status','terminalAction','result'])
     is distinct from
     (old.attempt_id,old.user_id,old.snapshot - array['status','terminalAction','result'])
     or coalesce(new.snapshot->>'status','') not in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') then
    raise exception 'FISHING_SNAPSHOT_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger world_fishing_snapshot_guard before update on private.world_fishing_attempt_snapshots
  for each row execute function private.world_fishing_snapshot_guard_v1();
create trigger world_fishing_receipt_guard before update on private.world_fishing_settlements
  for each row execute function private.world_inventory_mutation_append_only_v1();
revoke all on function private.world_fishing_snapshot_guard_v1() from public,anon,authenticated,service_role;

create function private.world_fishing_require_server_v1(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  if private.world_activity_account_ok_v1(p_user) is not true then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.world_fishing_require_server_v1(uuid) from public,anon,authenticated,service_role;

create function private.world_fishing_policy_validate_v1(p_policy jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_field text; v_value numeric;
begin
  if p_policy is null or jsonb_typeof(p_policy) <> 'object'
     or not p_policy ?& array['policyVersion','minWaitMs','maxWaitMs','responseWindowMs','attemptTtlMs','lifeXp']
     or (select count(*) from jsonb_object_keys(p_policy)) <> 6
     or jsonb_typeof(p_policy->'policyVersion') <> 'string'
     or p_policy->>'policyVersion' !~ '^[a-z][a-z0-9_.]{0,79}$' then
    raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
  end if;
  foreach v_field in array array['minWaitMs','maxWaitMs','responseWindowMs','attemptTtlMs','lifeXp'] loop
    if jsonb_typeof(p_policy->v_field) <> 'number' then
      raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
    end if;
    v_value := (p_policy->>v_field)::numeric;
    if v_value <> trunc(v_value) or v_value > 9007199254740991
       or v_value < (case when v_field='lifeXp' then 0 else 1 end) then
      raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
    end if;
  end loop;
  if (p_policy->>'maxWaitMs')::bigint < (p_policy->>'minWaitMs')::bigint
     or (p_policy->>'attemptTtlMs')::bigint <=
        (p_policy->>'maxWaitMs')::bigint + (p_policy->>'responseWindowMs')::bigint then
    raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.world_fishing_policy_validate_v1(jsonb) from public,anon,authenticated,service_role;

create function private.world_fishing_finish_v1(
  p_snapshot jsonb, p_status text, p_reason text, p_action text, p_now_ms bigint)
returns jsonb language sql immutable set search_path = '' as $$
  select p_snapshot || jsonb_build_object('status',p_status,'terminalAction',p_action,'result',
    jsonb_build_object(
      'resultRef','fishing_result:' || (p_snapshot->>'attemptId'),
      'activityId',p_snapshot->'activityId','attemptId',p_snapshot->'attemptId',
      'actorUserId',p_snapshot->'actorUserId','status',p_status,'reason',p_reason,
      'resolverVersion',p_snapshot->'resolverVersion','definitionVersion',p_snapshot->'definitionVersion',
      'outcomeSchemaVersion',p_snapshot->'outcomeSchemaVersion','policyVersion',p_snapshot->'policy'->'policyVersion',
      'resolvedAtMs',p_now_ms,'conditionSnapshot',jsonb_build_object(
        'sourceRef',p_snapshot->'sourceRef','startedAtMs',p_snapshot->'startedAtMs',
        'biteAtMs',p_snapshot->'biteAtMs','hookDeadlineMs',p_snapshot->'hookDeadlineMs',
        'expiresAtMs',p_snapshot->'expiresAtMs','weather','UNKNOWN'),
      'catch',case when p_status='SUCCEEDED' then jsonb_build_object(
        'speciesId','carp','itemId','material.fish_carp','quantity',1,
        'collectionEntryId','collection.fish.carp','skillId','life.fishing','lifeXp',p_snapshot->'policy'->'lifeXp')
      else 'null'::jsonb end));
$$;
revoke all on function private.world_fishing_finish_v1(jsonb,text,text,text,bigint) from public,anon,authenticated,service_role;

-- Pure DB decision helper: the live input RPC supplies the DB clock, never the browser.
create function private.world_fishing_resolve_v1(p_snapshot jsonb,p_action text,p_now bigint)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_status text; v_reason text;
begin
  if p_now < (p_snapshot->>'startedAtMs')::bigint then
    raise exception 'INVALID_SERVER_TIME' using errcode='22023';
  end if;
  if p_now >= (p_snapshot->>'expiresAtMs')::bigint then
    v_status:='EXPIRED'; v_reason:='ATTEMPT_EXPIRED';
  elsif p_action='CANCEL' then v_status:='CANCELLED'; v_reason:='PLAYER_CANCELLED';
  elsif p_now < (p_snapshot->>'biteAtMs')::bigint then v_status:='FAILED'; v_reason:='PREMATURE_HOOK';
  elsif p_now >= (p_snapshot->>'hookDeadlineMs')::bigint then v_status:='FAILED'; v_reason:='MISSED_BITE';
  else v_status:='SUCCEEDED'; v_reason:='CAUGHT';
  end if;
  return private.world_fishing_finish_v1(p_snapshot,v_status,v_reason,p_action,p_now);
end;
$$;
revoke all on function private.world_fishing_resolve_v1(jsonb,text,bigint) from public,anon,authenticated,service_role;

-- Caller holds the shared Activity account lock and fishing row lock.
create function private.world_fishing_commit_v1(p_user uuid,p_attempt_id uuid,p_next jsonb)
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
    v_reply := private.world_activity_finalize_v1(p_user,p_attempt_id,p_next->>'status',
      p_next->'result'->>'reason',case when p_next->>'status'='SUCCEEDED' then p_next->'result'->>'resultRef' else null end);
    if v_reply->'attempt'->>'status'='EXPIRED' then
      p_next := private.world_fishing_finish_v1(p_next,'EXPIRED','ATTEMPT_EXPIRED',
        p_next->>'terminalAction',floor(extract(epoch from clock_timestamp())*1000)::bigint);
    end if;
  end if;
  update private.world_fishing_attempt_snapshots set snapshot=p_next where attempt_id=p_attempt_id and user_id=p_user;
  return p_next;
end;
$$;
revoke all on function private.world_fishing_commit_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.world_fishing_expire_v1(p_user uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
  if p_snapshot->>'status'='ACTIVE' and v_now >= (p_snapshot->>'expiresAtMs')::bigint then
    return private.world_fishing_commit_v1(p_user,(p_snapshot->>'attemptId')::uuid,
      private.world_fishing_finish_v1(p_snapshot,'EXPIRED','ATTEMPT_EXPIRED','EXPIRE',v_now));
  end if;
  return p_snapshot;
end;
$$;
revoke all on function private.world_fishing_expire_v1(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.world_fishing_project_v1(p_snapshot jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select p_snapshot - array['actorUserId','policy','resolverVersion','definitionVersion','outcomeSchemaVersion','terminalAction'];
$$;
revoke all on function private.world_fishing_project_v1(jsonb) from public,anon,authenticated,service_role;

create function public.world_fishing_start_v1(p_user uuid,p_source_ref text,p_client_attempt_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_config private.world_fishing_runtime%rowtype; v_row record; v_start jsonb; v_snapshot jsonb;
  v_now bigint; v_wait bigint; v_id uuid; v_last bigint;
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
  v_wait := (v_config.policy->>'minWaitMs')::bigint + floor(random() *
    ((v_config.policy->>'maxWaitMs')::bigint-(v_config.policy->>'minWaitMs')::bigint+1))::bigint;
  v_start := private.world_activity_start_v1(p_user,'activity.fishing.inkyung',p_source_ref,p_client_attempt_key,1,1,
    to_timestamp((v_now+(v_config.policy->>'attemptTtlMs')::bigint)::double precision/1000));
  if v_start->>'status' <> 'STARTED' then raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505'; end if;
  v_id := (v_start->'attempt'->>'attemptId')::uuid;
  v_snapshot := jsonb_build_object(
    'activityId','activity.fishing.inkyung','sourceRef',p_source_ref,'clientAttemptKey',p_client_attempt_key,
    'attemptId',v_id,'actorUserId',p_user,'nonce',gen_random_uuid(),
    'resolverVersion','resolver.fishing.inkyung_v1','definitionVersion',1,'outcomeSchemaVersion',1,
    'status','ACTIVE','startedAtMs',v_now,'biteAtMs',v_now+v_wait,
    'hookDeadlineMs',v_now+v_wait+(v_config.policy->>'responseWindowMs')::bigint,
    'expiresAtMs',v_now+(v_config.policy->>'attemptTtlMs')::bigint,
    'policy',v_config.policy,'terminalAction',null,'result',null);
  insert into private.world_fishing_attempt_snapshots values (v_id,p_user,v_snapshot);
  return jsonb_build_object('status','STARTED','attempt',private.world_fishing_project_v1(v_snapshot));
end;
$$;

create function public.world_fishing_input_v1(
  p_user uuid,p_attempt_id uuid,p_source_ref text,p_nonce uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_next jsonb; v_now bigint;
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
  v_next := private.world_fishing_commit_v1(p_user,p_attempt_id,
    private.world_fishing_resolve_v1(v_snapshot,p_action,v_now));
  return jsonb_build_object('status','RESOLVED','attempt',private.world_fishing_project_v1(v_next));
end;
$$;

create function public.world_fishing_settle_v1(p_user uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_receipt jsonb; v_ref text; v_item jsonb; v_discovery jsonb; v_xp jsonb;
begin
  perform private.world_fishing_require_server_v1(p_user);
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  select snapshot into v_snapshot from private.world_fishing_attempt_snapshots
    where attempt_id=p_attempt_id and user_id=p_user for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0002'; end if;
  select receipt into v_receipt from private.world_fishing_settlements where attempt_id=p_attempt_id;
  if found then return jsonb_build_object('status','ALREADY_PROCESSED','receipt',v_receipt); end if;
  if v_snapshot->>'status' <> 'SUCCEEDED' then
    raise exception 'FISHING_NOT_SUCCEEDED' using errcode='P0001';
  end if;
  v_ref := v_snapshot->'result'->>'resultRef';
  v_item := private.world_inventory_grant_v1(p_user,'material.fish_carp',1,'ACTIVITY',v_ref,
    v_ref || '/item',null,jsonb_build_object('activityAttemptId',p_attempt_id));
  if v_item->>'originalStatus' is distinct from 'GRANTED' then
    raise exception 'OUTPUT_UNAVAILABLE' using errcode='P0001';
  end if;
  v_discovery := private.world_collection_discover_v1(p_user,'collection.fish.carp','ACTIVITY',
    'activity.fishing.inkyung',v_ref,v_ref || '/discovery',null);
  if (v_snapshot->'policy'->>'lifeXp')::bigint > 0 then
    v_xp := private.world_life_skill_xp_apply_v1(p_user,'life.fishing',
      (v_snapshot->'policy'->>'lifeXp')::bigint,'activity',v_ref,v_ref || '/xp');
  end if;
  v_receipt := jsonb_build_object('resultRef',v_ref,'attemptId',p_attempt_id,
    'item',v_item,'discovery',v_discovery,'lifeXp',v_xp);
  insert into private.world_fishing_settlements values (p_attempt_id,v_ref,v_receipt);
  return jsonb_build_object('status','SETTLED','receipt',v_receipt);
end;
$$;

create function public.world_fishing_read_v1(p_user uuid,p_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot jsonb; v_receipt jsonb; v_id uuid; v_quantity integer;
  v_entry private.world_collection_entry_catalog%rowtype;
begin
  perform private.world_fishing_require_server_v1(p_user);
  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));
  if p_attempt_id is null then
    select attempt_id,snapshot into v_id,v_snapshot from private.world_fishing_attempt_snapshots
      where user_id=p_user order by (snapshot->>'startedAtMs')::bigint desc,attempt_id desc limit 1 for update;
  else
    select attempt_id,snapshot into v_id,v_snapshot from private.world_fishing_attempt_snapshots
      where user_id=p_user and attempt_id=p_attempt_id for update;
    if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  if v_snapshot is not null then
    v_snapshot := private.world_fishing_expire_v1(p_user,v_snapshot);
    select receipt into v_receipt from private.world_fishing_settlements where attempt_id=v_id;
  end if;
  select quantity into v_quantity from private.world_player_items where user_id=p_user and item_id='material.fish_carp';
  select * into strict v_entry from private.world_collection_entry_catalog where entry_id='collection.fish.carp';
  return jsonb_build_object(
    'attempt',case when v_snapshot is null then null else private.world_fishing_project_v1(v_snapshot) end,
    'settlement',case when v_snapshot is null or v_snapshot->>'status' <> 'SUCCEEDED' then 'NOT_REQUIRED'
      when v_receipt is null then 'PENDING' else 'SETTLED' end,'receipt',v_receipt,
    'inventory',jsonb_build_object('itemId','material.fish_carp','quantity',coalesce(v_quantity,0)),
    'discovery',private.world_collection_entry_snapshot_v1(p_user,v_entry),
    'lifeSkill',private.world_life_skill_snapshot_v1(p_user,'life.fishing'));
end;
$$;

revoke all on function public.world_fishing_start_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_fishing_input_v1(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.world_fishing_settle_v1(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.world_fishing_read_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.world_fishing_start_v1(uuid,text,uuid) to service_role;
grant execute on function public.world_fishing_input_v1(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.world_fishing_settle_v1(uuid,uuid) to service_role;
grant execute on function public.world_fishing_read_v1(uuid,uuid) to service_role;
