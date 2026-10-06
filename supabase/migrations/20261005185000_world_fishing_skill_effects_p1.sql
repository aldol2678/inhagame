-- Fishing Life Skill Effects P1: make the first two Fishing tree nodes affect real server authority.
--
-- ACTIVE in this slice:
-- - steady_hands: +250 ms HOOK response window per rank (max +750 ms)
-- - fish_sense: -250 ms bite wait per rank (max -750 ms, never below 1 ms)
--
-- Deferred and kept COMING_SOON because their dependent gameplay does not exist yet:
-- baitcraft, rare_fish_sense, boat_fishing, deep_sea_fishing.
--
-- Effects are resolved from the current Life-tree epoch at cast start, applied to a copy of the
-- operator-owned Fishing policy, validated, and frozen into that attempt's private snapshot.
-- A later respec therefore cannot rewrite an in-flight attempt. The browser never supplies ranks,
-- policy values or effect values.

create or replace function private.world_fishing_skill_effects_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_steady integer;
  v_sense integer;
begin
  if p_user is null or not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;

  v_steady := private.world_life_node_rank_v1(p_user,'life.node.fishing.steady_hands');
  v_sense := private.world_life_node_rank_v1(p_user,'life.node.fishing.fish_sense');

  if v_steady not between 0 and 3 or v_sense not between 0 and 3 then
    raise exception 'FISHING_SKILL_EFFECT_INVALID' using errcode='22023';
  end if;

  return jsonb_build_object(
    'version','fishing.skill_effects.v1',
    'steadyHandsRank',v_steady,
    'fishSenseRank',v_sense,
    'responseWindowBonusMs',v_steady * 250,
    'waitReductionMs',v_sense * 250
  );
end;
$$;
revoke all on function private.world_fishing_skill_effects_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function private.world_fishing_apply_skill_effects_v1(p_policy jsonb,p_effects jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_steady integer;
  v_sense integer;
  v_response_bonus bigint;
  v_wait_reduction bigint;
  v_min bigint;
  v_max bigint;
  v_effective jsonb;
begin
  perform private.world_fishing_policy_validate_v1(p_policy);

  if p_effects is null or jsonb_typeof(p_effects) <> 'object'
     or p_effects->>'version' <> 'fishing.skill_effects.v1'
     or not p_effects ?& array['steadyHandsRank','fishSenseRank','responseWindowBonusMs','waitReductionMs']
     or jsonb_typeof(p_effects->'steadyHandsRank') <> 'number'
     or jsonb_typeof(p_effects->'fishSenseRank') <> 'number'
     or jsonb_typeof(p_effects->'responseWindowBonusMs') <> 'number'
     or jsonb_typeof(p_effects->'waitReductionMs') <> 'number' then
    raise exception 'FISHING_SKILL_EFFECT_INVALID' using errcode='22023';
  end if;

  v_steady := (p_effects->>'steadyHandsRank')::integer;
  v_sense := (p_effects->>'fishSenseRank')::integer;
  v_response_bonus := (p_effects->>'responseWindowBonusMs')::bigint;
  v_wait_reduction := (p_effects->>'waitReductionMs')::bigint;

  if v_steady not between 0 and 3 or v_sense not between 0 and 3
     or v_response_bonus <> v_steady * 250
     or v_wait_reduction <> v_sense * 250 then
    raise exception 'FISHING_SKILL_EFFECT_INVALID' using errcode='22023';
  end if;

  v_min := greatest(1::bigint,(p_policy->>'minWaitMs')::bigint-v_wait_reduction);
  v_max := greatest(v_min,(p_policy->>'maxWaitMs')::bigint-v_wait_reduction);
  v_effective := p_policy || jsonb_build_object(
    'minWaitMs',v_min,
    'maxWaitMs',v_max,
    'responseWindowMs',(p_policy->>'responseWindowMs')::bigint+v_response_bonus
  );

  perform private.world_fishing_policy_validate_v1(v_effective);
  return v_effective;
end;
$$;
revoke all on function private.world_fishing_apply_skill_effects_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- Skill-effect details stay server-private. Players already receive the effective bite/deadline
-- timestamps they need to render the interaction.
create or replace function private.world_fishing_project_v1(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_snapshot - array[
    'actorUserId','policy','skillEffects','resolverVersion','definitionVersion',
    'outcomeSchemaVersion','terminalAction'
  ];
$$;
revoke all on function private.world_fishing_project_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.world_fishing_start_v1(p_user uuid,p_source_ref text,p_client_attempt_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config private.world_fishing_runtime%rowtype;
  v_row record;
  v_start jsonb;
  v_snapshot jsonb;
  v_effects jsonb;
  v_policy jsonb;
  v_now bigint;
  v_wait bigint;
  v_id uuid;
  v_last bigint;
  v_position private.world_fishing_positions%rowtype;
begin
  perform private.world_fishing_require_server_v1(p_user);
  if p_source_ref is null or p_source_ref not in ('fishing.inkyung.north_01','fishing.inkyung.south_01')
     or p_client_attempt_key is null then
    raise exception 'INVALID_FISHING_IDENTITY' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));

  select f.snapshot,a.source_ref into v_row
    from private.world_activity_attempts a
    left join private.world_fishing_attempt_snapshots f on f.attempt_id=a.attempt_id
   where a.user_id=p_user and a.client_attempt_key=p_client_attempt_key;
  if found then
    if v_row.snapshot is null or v_row.source_ref <> p_source_ref then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    v_snapshot := private.world_fishing_expire_v1(p_user,v_row.snapshot);
    return jsonb_build_object('status','ALREADY_PROCESSED','attempt',private.world_fishing_project_v1(v_snapshot));
  end if;

  for v_row in
    select * from private.world_fishing_attempt_snapshots
     where user_id=p_user and snapshot->>'status'='ACTIVE'
     for update
  loop
    v_snapshot := private.world_fishing_expire_v1(p_user,v_row.snapshot);
    if v_snapshot->>'status'='ACTIVE' then
      raise exception 'ATTEMPT_ALREADY_ACTIVE' using errcode='P0001';
    end if;
  end loop;

  select * into strict v_config from private.world_fishing_runtime where singleton for share;
  if not v_config.enabled then
    raise exception 'FISHING_UNAVAILABLE' using errcode='P0001';
  end if;
  perform private.world_fishing_policy_validate_v1(v_config.policy);
  if v_config.minimum_start_interval_ms is null then
    raise exception 'FISHING_POLICY_INVALID' using errcode='22023';
  end if;

  -- Read the current tree epoch exactly once for this cast, then freeze the resulting policy.
  v_effects := private.world_fishing_skill_effects_v1(p_user);
  v_policy := private.world_fishing_apply_skill_effects_v1(v_config.policy,v_effects);

  v_now := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if v_now + (v_policy->>'attemptTtlMs')::bigint > 9007199254740991 then
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
    v_position:=private.world_fishing_require_position_v1(p_user,p_source_ref);
    v_now:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
    delete from private.world_fishing_spot_leases
      where source_ref=p_source_ref and expires_at<=clock_timestamp();
    if exists(select 1 from private.world_fishing_spot_leases where source_ref=p_source_ref) then
      raise exception 'FISHING_SPOT_OCCUPIED' using errcode='P0001';
    end if;
  end if;

  v_wait := (v_policy->>'minWaitMs')::bigint + floor(random() *
    ((v_policy->>'maxWaitMs')::bigint-(v_policy->>'minWaitMs')::bigint+1))::bigint;

  v_start := private.world_life_activity_start_with_creature_v1(
    p_user,'activity.fishing.inkyung',p_source_ref,p_client_attempt_key,1,1,
    to_timestamp((v_now+(v_policy->>'attemptTtlMs')::bigint)::double precision/1000)
  );
  if v_start->'activity'->>'status' is distinct from 'STARTED' then
    raise exception 'ACTIVITY_OUTCOME_CONFLICT' using errcode='23505';
  end if;

  v_id := (v_start->'activity'->'attempt'->>'attemptId')::uuid;
  v_snapshot := jsonb_build_object(
    'activityId','activity.fishing.inkyung',
    'sourceRef',p_source_ref,
    'clientAttemptKey',p_client_attempt_key,
    'attemptId',v_id,
    'actorUserId',p_user,
    'nonce',gen_random_uuid(),
    'resolverVersion','resolver.fishing.inkyung_v1',
    'definitionVersion',1,
    'outcomeSchemaVersion',1,
    'status','ACTIVE',
    'startedAtMs',v_now,
    'biteAtMs',v_now+v_wait,
    'hookDeadlineMs',v_now+v_wait+(v_policy->>'responseWindowMs')::bigint,
    'expiresAtMs',v_now+(v_policy->>'attemptTtlMs')::bigint,
    'policy',v_policy,
    'skillEffects',v_effects,
    'terminalAction',null,
    'result',null
  );

  insert into private.world_fishing_attempt_snapshots values (v_id,p_user,v_snapshot);
  if v_config.presence_required then
    insert into private.world_fishing_spot_leases(source_ref,user_id,attempt_id,session_id,expires_at)
      values(
        p_source_ref,p_user,v_id,v_position.session_id,
        to_timestamp((v_snapshot->>'expiresAtMs')::double precision/1000)
      );
  end if;

  return jsonb_build_object('status','STARTED','attempt',private.world_fishing_project_v1(v_snapshot));
end;
$$;

-- Activate only effects that are real in this slice.
update private.world_life_skill_tree_catalog
   set status='ACTIVE'
 where node_id in (
   'life.node.fishing.steady_hands',
   'life.node.fishing.fish_sense'
 )
   and status='COMING_SOON';

do $$
begin
  if (select count(*) from private.world_life_skill_tree_catalog
       where node_id in ('life.node.fishing.steady_hands','life.node.fishing.fish_sense')
         and status='ACTIVE') <> 2
     or exists (
       select 1 from private.world_life_skill_tree_catalog
        where skill_id='life.fishing'
          and node_id not in ('life.node.fishing.steady_hands','life.node.fishing.fish_sense')
          and status <> 'COMING_SOON'
     ) then
    raise exception 'FISHING_SKILL_EFFECT_ACTIVATION_INCOMPLETE';
  end if;
end;
$$;
