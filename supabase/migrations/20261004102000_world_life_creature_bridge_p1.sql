-- INHA WORLD Life Activity -> Creature Bridge P1.
--
-- Bridges verified Life Activity outcomes into Creature Core without moving authority:
-- - Activity owns attempt/result identity.
-- - Life owns Life Skill status/XP.
-- - Creature Core owns Creature XP, Memory and evolution inputs.
-- - Client/browser never supplies Creature id, Creature XP, Memory tags or party revision.
--
-- P1 is wired but intentionally dormant:
-- - Life Skills remain COMING_SOON.
-- - Creature bridge rows are COMING_SOON.
-- - Creature XP values are 0.
-- Activation/tuning must happen in later forward migrations.

insert into private.world_creature_activity_bridge_catalog(
  bridge_id,source_domain,semantic_event_type,memory_tag,
  xp_amount,cooldown_seconds,daily_cap,status,definition_version)
values
  (
    'creature.bridge.activity.fishing','ACTIVITY','activity.fishing.catch',
    'memory.life.fishing',0,0,null,'COMING_SOON',1
  ),
  (
    'creature.bridge.activity.gathering','ACTIVITY','activity.gathering.harvest',
    'memory.life.gathering',0,0,null,'COMING_SOON',1
  ),
  (
    'creature.bridge.activity.archaeology','ACTIVITY','activity.archaeology.excavate',
    'memory.life.archaeology',0,0,null,'COMING_SOON',1
  )
on conflict (bridge_id) do nothing;

create table if not exists private.world_life_creature_bridge_catalog (
  bridge_id text primary key
    references private.world_creature_activity_bridge_catalog(bridge_id) on delete restrict,
  activity_id text not null unique
    check (
      activity_id ~ '^activity\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(activity_id) <= 120
    ),
  life_skill_id text not null
    references private.world_life_skill_catalog(skill_id) on delete restrict,
  required_activity_definition_version integer not null
    check (required_activity_definition_version >= 1),
  created_at timestamptz not null default now()
);
comment on table private.world_life_creature_bridge_catalog is
  'Cross-domain routing catalog from canonical Life Activity identity to Creature Core bridge identity.';

insert into private.world_life_creature_bridge_catalog(
  bridge_id,activity_id,life_skill_id,required_activity_definition_version)
values
  (
    'creature.bridge.activity.fishing',
    'activity.fishing.inkyung',
    'life.fishing',
    1
  ),
  (
    'creature.bridge.activity.gathering',
    'activity.gathering.campus',
    'life.gathering',
    1
  ),
  (
    'creature.bridge.activity.archaeology',
    'activity.archaeology.campus_history',
    'life.archaeology',
    1
  )
on conflict (bridge_id) do nothing;

create table if not exists private.world_life_creature_activity_contexts (
  attempt_id uuid primary key
    references private.world_activity_attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null,
  party_revision bigint not null check (party_revision >= 0),
  bound_at timestamptz not null default now(),
  constraint world_life_creature_context_activity_fk
    foreign key (activity_id)
    references private.world_life_creature_bridge_catalog(activity_id)
    on delete restrict
);
comment on table private.world_life_creature_activity_contexts is
  'Append-only Creature party revision captured when a mapped Life Activity starts.';

create table if not exists private.world_life_creature_bridge_decisions (
  attempt_id uuid primary key
    references private.world_activity_attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id text not null
    references private.world_life_creature_bridge_catalog(bridge_id) on delete restrict,
  decision text not null check (decision in (
    'FORWARDED',
    'NOOP_ACTIVITY_NOT_SUCCEEDED',
    'NOOP_NO_CONTEXT',
    'NOOP_INACTIVE'
  )),
  creature_activity_event_id uuid
    references private.world_creature_activity_events(creature_activity_event_id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint world_life_creature_bridge_decision_shape check (
    (decision = 'FORWARDED' and creature_activity_event_id is not null)
    or
    (decision <> 'FORWARDED' and creature_activity_event_id is null)
  )
);
comment on table private.world_life_creature_bridge_decisions is
  'Append-only first-finalization decision; prevents retroactive Creature growth after later activation.';

alter table private.world_life_creature_bridge_catalog enable row level security;
alter table private.world_life_creature_activity_contexts enable row level security;
alter table private.world_life_creature_bridge_decisions enable row level security;
revoke all on table
  private.world_life_creature_bridge_catalog,
  private.world_life_creature_activity_contexts,
  private.world_life_creature_bridge_decisions
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_creature_context_append_only
  on private.world_life_creature_activity_contexts;
create trigger world_life_creature_context_append_only
  before update or delete on private.world_life_creature_activity_contexts
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_life_creature_decision_append_only
  on private.world_life_creature_bridge_decisions;
create trigger world_life_creature_decision_append_only
  before update or delete on private.world_life_creature_bridge_decisions
  for each row execute function private.world_creature_append_only_v1();

create or replace function private.world_life_creature_context_json_v1(
  p_context private.world_life_creature_activity_contexts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId',p_context.attempt_id,
    'userId',p_context.user_id,
    'activityId',p_context.activity_id,
    'partyRevision',p_context.party_revision,
    'boundAt',p_context.bound_at
  );
$$;
revoke all on function private.world_life_creature_context_json_v1(
  private.world_life_creature_activity_contexts)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_creature_context_bind_v1(
  p_user uuid,
  p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.world_activity_attempts%rowtype;
  v_mapping private.world_life_creature_bridge_catalog%rowtype;
  v_context private.world_life_creature_activity_contexts%rowtype;
  v_party_revision bigint := 0;
begin
  if p_attempt_id is null then
    raise exception 'INVALID_ATTEMPT_ID' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('world_life_creature_context:' || p_user::text,0));

  select * into v_context
    from private.world_life_creature_activity_contexts c
   where c.attempt_id = p_attempt_id;
  if found then
    if v_context.user_id <> p_user then
      raise exception 'CREATURE_CONTEXT_OWNER_CONFLICT' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'context',private.world_life_creature_context_json_v1(v_context)
    );
  end if;

  select * into v_attempt
    from private.world_activity_attempts a
   where a.attempt_id = p_attempt_id
     and a.user_id = p_user;
  if not found then
    raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_mapping
    from private.world_life_creature_bridge_catalog m
   where m.activity_id = v_attempt.activity_id;
  if not found then
    raise exception 'LIFE_CREATURE_ACTIVITY_NOT_MAPPED' using errcode = 'P0002';
  end if;

  if v_attempt.definition_version <> v_mapping.required_activity_definition_version then
    raise exception 'ACTIVITY_DEFINITION_VERSION_MISMATCH' using errcode = 'P0001';
  end if;

  if v_attempt.status not in ('CREATED','ACTIVE') then
    raise exception 'LIFE_CREATURE_CONTEXT_TOO_LATE' using errcode = 'P0001';
  end if;

  select p.revision into v_party_revision
    from private.world_creature_party_state p
   where p.user_id = p_user;
  v_party_revision := coalesce(v_party_revision,0);

  if v_party_revision > 0 and not exists (
    select 1
      from private.world_creature_party_history h
     where h.user_id = p_user
       and h.revision = v_party_revision
  ) then
    raise exception 'CREATURE_PARTY_HISTORY_INVALID' using errcode = 'P0001';
  end if;

  insert into private.world_life_creature_activity_contexts(
    attempt_id,user_id,activity_id,party_revision)
  values (
    v_attempt.attempt_id,p_user,v_attempt.activity_id,v_party_revision)
  returning * into v_context;

  return jsonb_build_object(
    'status','SUCCESS',
    'context',private.world_life_creature_context_json_v1(v_context)
  );
end;
$$;
revoke all on function private.world_life_creature_context_bind_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_activity_start_with_creature_v1(
  p_user uuid,
  p_activity_id text,
  p_source_ref text,
  p_client_attempt_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_expires_at timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mapping private.world_life_creature_bridge_catalog%rowtype;
  v_skill private.world_life_skill_catalog%rowtype;
  v_activity jsonb;
  v_attempt_id uuid;
  v_context jsonb;
begin
  select * into v_mapping
    from private.world_life_creature_bridge_catalog m
   where m.activity_id = p_activity_id;
  if not found then
    raise exception 'LIFE_CREATURE_ACTIVITY_NOT_MAPPED' using errcode = 'P0002';
  end if;

  select * into strict v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = v_mapping.life_skill_id;
  if v_skill.status <> 'ACTIVE' then
    raise exception 'LIFE_SKILL_INACTIVE' using errcode = 'P0001';
  end if;

  if p_definition_version <> v_mapping.required_activity_definition_version then
    raise exception 'ACTIVITY_DEFINITION_VERSION_MISMATCH' using errcode = 'P0001';
  end if;

  v_activity := private.world_activity_start_v1(
    p_user,p_activity_id,p_source_ref,p_client_attempt_key,
    p_definition_version,p_resolver_version,p_expires_at);

  v_attempt_id := nullif(v_activity->'attempt'->>'attemptId','')::uuid;
  if v_attempt_id is null then
    raise exception 'ACTIVITY_START_RESULT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.world_life_creature_context_bind_v1(
    p_user,v_attempt_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'activity',v_activity,
    'creatureContext',v_context
  );
end;
$$;
revoke all on function private.world_life_activity_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_activity_finalize_with_creature_v1(
  p_user uuid,
  p_attempt_id uuid,
  p_terminal_status text,
  p_outcome_type text,
  p_result_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_activity jsonb;
  v_attempt private.world_activity_attempts%rowtype;
  v_mapping private.world_life_creature_bridge_catalog%rowtype;
  v_bridge private.world_creature_activity_bridge_catalog%rowtype;
  v_skill private.world_life_skill_catalog%rowtype;
  v_context private.world_life_creature_activity_contexts%rowtype;
  v_decision private.world_life_creature_bridge_decisions%rowtype;
  v_creature_event private.world_creature_activity_events%rowtype;
  v_creature jsonb;
  v_creature_event_id uuid;
  v_event_key text;
begin
  v_activity := private.world_activity_finalize_v1(
    p_user,p_attempt_id,p_terminal_status,p_outcome_type,p_result_ref);

  select * into strict v_attempt
    from private.world_activity_attempts a
   where a.attempt_id = p_attempt_id
     and a.user_id = p_user;

  select * into v_mapping
    from private.world_life_creature_bridge_catalog m
   where m.activity_id = v_attempt.activity_id;
  if not found then
    raise exception 'LIFE_CREATURE_ACTIVITY_NOT_MAPPED' using errcode = 'P0002';
  end if;

  if v_attempt.definition_version <> v_mapping.required_activity_definition_version then
    raise exception 'ACTIVITY_DEFINITION_VERSION_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_decision
    from private.world_life_creature_bridge_decisions d
   where d.attempt_id = p_attempt_id
     and d.user_id = p_user;
  if found then
    if v_decision.decision = 'FORWARDED' then
      select * into strict v_creature_event
        from private.world_creature_activity_events e
       where e.creature_activity_event_id = v_decision.creature_activity_event_id;
      return jsonb_build_object(
        'status','SUCCESS',
        'activity',v_activity,
        'creatureBridge',jsonb_build_object(
          'status','ALREADY_PROCESSED',
          'decision','FORWARDED',
          'event',private.world_creature_activity_event_json_v1(v_creature_event)
        )
      );
    end if;
    return jsonb_build_object(
      'status','SUCCESS',
      'activity',v_activity,
      'creatureBridge',jsonb_build_object(
        'status','ALREADY_PROCESSED',
        'decision',v_decision.decision
      )
    );
  end if;

  if v_attempt.status <> 'SUCCEEDED' then
    insert into private.world_life_creature_bridge_decisions(
      attempt_id,user_id,bridge_id,decision)
    values (
      p_attempt_id,p_user,v_mapping.bridge_id,'NOOP_ACTIVITY_NOT_SUCCEEDED');

    return jsonb_build_object(
      'status','SUCCESS',
      'activity',v_activity,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_ACTIVITY_NOT_SUCCEEDED'
      )
    );
  end if;

  select * into v_context
    from private.world_life_creature_activity_contexts c
   where c.attempt_id = p_attempt_id
     and c.user_id = p_user;
  if not found then
    insert into private.world_life_creature_bridge_decisions(
      attempt_id,user_id,bridge_id,decision)
    values (
      p_attempt_id,p_user,v_mapping.bridge_id,'NOOP_NO_CONTEXT');

    return jsonb_build_object(
      'status','SUCCESS',
      'activity',v_activity,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_NO_CONTEXT'
      )
    );
  end if;

  select * into strict v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = v_mapping.life_skill_id;

  select * into strict v_bridge
    from private.world_creature_activity_bridge_catalog b
   where b.bridge_id = v_mapping.bridge_id;

  if v_skill.status <> 'ACTIVE' or v_bridge.status <> 'ACTIVE' then
    insert into private.world_life_creature_bridge_decisions(
      attempt_id,user_id,bridge_id,decision)
    values (
      p_attempt_id,p_user,v_mapping.bridge_id,'NOOP_INACTIVE');

    return jsonb_build_object(
      'status','SUCCESS',
      'activity',v_activity,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_INACTIVE'
      )
    );
  end if;

  if v_attempt.result_ref is null or v_attempt.finalized_at is null then
    raise exception 'ACTIVITY_SUCCESS_PROVENANCE_INVALID' using errcode = 'P0001';
  end if;

  v_event_key := 'life-creature:' || v_attempt.attempt_id::text;

  v_creature := private.world_creature_activity_accept_v1(
    p_user,
    v_mapping.bridge_id,
    v_attempt.source_ref,
    v_attempt.result_ref,
    v_event_key,
    v_context.party_revision,
    v_attempt.finalized_at
  );

  v_creature_event_id := nullif(
    v_creature->'event'->>'creatureActivityEventId','')::uuid;
  if v_creature_event_id is null then
    raise exception 'CREATURE_BRIDGE_RESULT_INVALID' using errcode = 'P0001';
  end if;

  insert into private.world_life_creature_bridge_decisions(
    attempt_id,user_id,bridge_id,decision,creature_activity_event_id)
  values (
    p_attempt_id,p_user,v_mapping.bridge_id,'FORWARDED',v_creature_event_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'activity',v_activity,
    'creatureBridge',jsonb_build_object(
      'status','FORWARDED',
      'result',v_creature
    )
  );
end;
$$;
revoke all on function private.world_life_activity_finalize_with_creature_v1(
  uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.world_life_activity_start_with_creature_v1(
  p_user uuid,
  p_activity_id text,
  p_source_ref text,
  p_client_attempt_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_expires_at timestamptz default null)
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
  return private.world_life_activity_start_with_creature_v1(
    p_user,p_activity_id,p_source_ref,p_client_attempt_key,
    p_definition_version,p_resolver_version,p_expires_at);
end;
$$;

create or replace function public.world_life_activity_finalize_with_creature_v1(
  p_user uuid,
  p_attempt_id uuid,
  p_terminal_status text,
  p_outcome_type text,
  p_result_ref text default null)
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
  return private.world_life_activity_finalize_with_creature_v1(
    p_user,p_attempt_id,p_terminal_status,p_outcome_type,p_result_ref);
end;
$$;

revoke execute on function public.world_life_activity_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_life_activity_finalize_with_creature_v1(
  uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.world_life_activity_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,timestamptz)
  to service_role;
grant execute on function public.world_life_activity_finalize_with_creature_v1(
  uuid,uuid,text,text,text)
  to service_role;