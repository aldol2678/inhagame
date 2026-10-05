-- INHA WORLD Combat -> Creature Bridge P1.
--
-- Authority boundaries:
-- - Combat owns encounter identity, terminal status and result_ref.
-- - Creature Core owns Creature XP, Memory and evolution inputs.
-- - Client/browser never supplies Creature id, Creature XP, Memory tag or party revision.
--
-- P1 is deliberately dormant:
-- - no Combat definitions are active yet,
-- - this Creature bridge remains COMING_SOON,
-- - Creature XP is 0.
-- Support/protection memories are deferred until Combat Core emits those verified semantics.

insert into private.world_creature_activity_bridge_catalog(
  bridge_id,source_domain,semantic_event_type,memory_tag,
  xp_amount,cooldown_seconds,daily_cap,status,definition_version)
values (
  'creature.bridge.combat.victory',
  'COMBAT',
  'combat.succeeded',
  'memory.combat.victory',
  0,
  0,
  null,
  'COMING_SOON',
  1
)
on conflict (bridge_id) do nothing;

create table if not exists private.world_combat_creature_bridge_catalog (
  bridge_id text primary key
    references private.world_creature_activity_bridge_catalog(bridge_id) on delete restrict,
  required_terminal_status text not null
    check (required_terminal_status in ('SUCCEEDED')),
  created_at timestamptz not null default now()
);
comment on table private.world_combat_creature_bridge_catalog is
  'Cross-domain routing catalog from verified Combat terminal semantics to Creature Core.';

insert into private.world_combat_creature_bridge_catalog(
  bridge_id,required_terminal_status)
values (
  'creature.bridge.combat.victory',
  'SUCCEEDED'
)
on conflict (bridge_id) do nothing;

create table if not exists private.world_combat_creature_contexts (
  encounter_id uuid primary key
    references private.world_combat_encounters(encounter_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  combat_id text not null,
  party_revision bigint not null check (party_revision >= 0),
  bound_at timestamptz not null default now()
);
comment on table private.world_combat_creature_contexts is
  'Append-only Creature party revision captured when Combat begins.';

create table if not exists private.world_combat_creature_bridge_decisions (
  encounter_id uuid primary key
    references private.world_combat_encounters(encounter_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bridge_id text not null
    references private.world_combat_creature_bridge_catalog(bridge_id) on delete restrict,
  decision text not null check (decision in (
    'FORWARDED',
    'NOOP_NOT_SUCCEEDED',
    'NOOP_NO_CONTEXT',
    'NOOP_INACTIVE'
  )),
  creature_activity_event_id uuid
    references private.world_creature_activity_events(creature_activity_event_id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint world_combat_creature_decision_shape check (
    (decision = 'FORWARDED' and creature_activity_event_id is not null)
    or
    (decision <> 'FORWARDED' and creature_activity_event_id is null)
  )
);
comment on table private.world_combat_creature_bridge_decisions is
  'Append-only first-finalization decision; prevents later bridge activation from backfilling old Combat.';

alter table private.world_combat_creature_bridge_catalog enable row level security;
alter table private.world_combat_creature_contexts enable row level security;
alter table private.world_combat_creature_bridge_decisions enable row level security;

revoke all on table
  private.world_combat_creature_bridge_catalog,
  private.world_combat_creature_contexts,
  private.world_combat_creature_bridge_decisions
  from public, anon, authenticated, service_role;

drop trigger if exists world_combat_creature_context_append_only
  on private.world_combat_creature_contexts;
create trigger world_combat_creature_context_append_only
  before update or delete on private.world_combat_creature_contexts
  for each row execute function private.world_creature_append_only_v1();

drop trigger if exists world_combat_creature_decision_append_only
  on private.world_combat_creature_bridge_decisions;
create trigger world_combat_creature_decision_append_only
  before update or delete on private.world_combat_creature_bridge_decisions
  for each row execute function private.world_creature_append_only_v1();

create or replace function private.world_combat_creature_context_json_v1(
  p_context private.world_combat_creature_contexts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'encounterId',p_context.encounter_id,
    'userId',p_context.user_id,
    'combatId',p_context.combat_id,
    'partyRevision',p_context.party_revision,
    'boundAt',p_context.bound_at
  );
$$;
revoke all on function private.world_combat_creature_context_json_v1(
  private.world_combat_creature_contexts)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_creature_context_bind_v1(
  p_user uuid,
  p_encounter_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
  v_context private.world_combat_creature_contexts%rowtype;
  v_party_revision bigint := 0;
begin
  if p_encounter_id is null then
    raise exception 'INVALID_ENCOUNTER_ID' using errcode = '22023';
  end if;
  if not private.world_creature_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('world_combat_creature_context:' || p_user::text,0));

  select * into v_context
    from private.world_combat_creature_contexts c
   where c.encounter_id = p_encounter_id;
  if found then
    if v_context.user_id <> p_user then
      raise exception 'CREATURE_CONTEXT_OWNER_CONFLICT' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'context',private.world_combat_creature_context_json_v1(v_context)
    );
  end if;

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id = p_encounter_id
     and e.user_id = p_user;
  if not found then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_encounter.status not in ('CREATED','ACTIVE') then
    raise exception 'COMBAT_CREATURE_CONTEXT_TOO_LATE' using errcode = 'P0001';
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

  insert into private.world_combat_creature_contexts(
    encounter_id,user_id,combat_id,party_revision)
  values (
    v_encounter.encounter_id,p_user,v_encounter.combat_id,v_party_revision)
  returning * into v_context;

  return jsonb_build_object(
    'status','SUCCESS',
    'context',private.world_combat_creature_context_json_v1(v_context)
  );
end;
$$;
revoke all on function private.world_combat_creature_context_bind_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_start_with_creature_v1(
  p_user uuid,
  p_combat_id text,
  p_source_ref text,
  p_client_encounter_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_initial_state jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_combat jsonb;
  v_encounter_id uuid;
  v_context jsonb;
begin
  v_combat := private.world_combat_start_v1(
    p_user,p_combat_id,p_source_ref,p_client_encounter_key,
    p_definition_version,p_resolver_version,p_initial_state);

  v_encounter_id := nullif(v_combat->'encounter'->>'encounterId','')::uuid;
  if v_encounter_id is null then
    raise exception 'COMBAT_START_RESULT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.world_combat_creature_context_bind_v1(
    p_user,v_encounter_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'combat',v_combat,
    'creatureContext',v_context
  );
end;
$$;
revoke all on function private.world_combat_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_combat_finalize_with_creature_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_terminal_status text,
  p_result_ref text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_combat jsonb;
  v_encounter private.world_combat_encounters%rowtype;
  v_routing private.world_combat_creature_bridge_catalog%rowtype;
  v_bridge private.world_creature_activity_bridge_catalog%rowtype;
  v_context private.world_combat_creature_contexts%rowtype;
  v_decision private.world_combat_creature_bridge_decisions%rowtype;
  v_creature_event private.world_creature_activity_events%rowtype;
  v_creature jsonb;
  v_creature_event_id uuid;
  v_event_key text;
begin
  v_combat := private.world_combat_finalize_v1(
    p_user,p_encounter_id,p_terminal_status,p_result_ref);

  select * into strict v_encounter
    from private.world_combat_encounters e
   where e.encounter_id = p_encounter_id
     and e.user_id = p_user;

  select * into strict v_routing
    from private.world_combat_creature_bridge_catalog r
   where r.bridge_id = 'creature.bridge.combat.victory';

  select * into v_decision
    from private.world_combat_creature_bridge_decisions d
   where d.encounter_id = p_encounter_id
     and d.user_id = p_user;
  if found then
    if v_decision.decision = 'FORWARDED' then
      select * into strict v_creature_event
        from private.world_creature_activity_events e
       where e.creature_activity_event_id = v_decision.creature_activity_event_id;
      return jsonb_build_object(
        'status','SUCCESS',
        'combat',v_combat,
        'creatureBridge',jsonb_build_object(
          'status','ALREADY_PROCESSED',
          'decision','FORWARDED',
          'event',private.world_creature_activity_event_json_v1(v_creature_event)
        )
      );
    end if;

    return jsonb_build_object(
      'status','SUCCESS',
      'combat',v_combat,
      'creatureBridge',jsonb_build_object(
        'status','ALREADY_PROCESSED',
        'decision',v_decision.decision
      )
    );
  end if;

  if v_encounter.status <> v_routing.required_terminal_status then
    insert into private.world_combat_creature_bridge_decisions(
      encounter_id,user_id,bridge_id,decision)
    values (
      p_encounter_id,p_user,v_routing.bridge_id,'NOOP_NOT_SUCCEEDED');

    return jsonb_build_object(
      'status','SUCCESS',
      'combat',v_combat,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_NOT_SUCCEEDED'
      )
    );
  end if;

  select * into v_context
    from private.world_combat_creature_contexts c
   where c.encounter_id = p_encounter_id
     and c.user_id = p_user;
  if not found then
    insert into private.world_combat_creature_bridge_decisions(
      encounter_id,user_id,bridge_id,decision)
    values (
      p_encounter_id,p_user,v_routing.bridge_id,'NOOP_NO_CONTEXT');

    return jsonb_build_object(
      'status','SUCCESS',
      'combat',v_combat,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_NO_CONTEXT'
      )
    );
  end if;

  select * into strict v_bridge
    from private.world_creature_activity_bridge_catalog b
   where b.bridge_id = v_routing.bridge_id;

  if v_bridge.status <> 'ACTIVE' then
    insert into private.world_combat_creature_bridge_decisions(
      encounter_id,user_id,bridge_id,decision)
    values (
      p_encounter_id,p_user,v_routing.bridge_id,'NOOP_INACTIVE');

    return jsonb_build_object(
      'status','SUCCESS',
      'combat',v_combat,
      'creatureBridge',jsonb_build_object(
        'status','NOOP_INACTIVE'
      )
    );
  end if;

  if v_encounter.result_ref is null or v_encounter.finalized_at is null then
    raise exception 'COMBAT_SUCCESS_PROVENANCE_INVALID' using errcode = 'P0001';
  end if;

  v_event_key := 'combat-creature:' || v_encounter.encounter_id::text;

  v_creature := private.world_creature_activity_accept_v1(
    p_user,
    v_routing.bridge_id,
    v_encounter.source_ref,
    v_encounter.result_ref,
    v_event_key,
    v_context.party_revision,
    v_encounter.finalized_at
  );

  v_creature_event_id := nullif(
    v_creature->'event'->>'creatureActivityEventId','')::uuid;
  if v_creature_event_id is null then
    raise exception 'CREATURE_BRIDGE_RESULT_INVALID' using errcode = 'P0001';
  end if;

  insert into private.world_combat_creature_bridge_decisions(
    encounter_id,user_id,bridge_id,decision,creature_activity_event_id)
  values (
    p_encounter_id,p_user,v_routing.bridge_id,'FORWARDED',v_creature_event_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'combat',v_combat,
    'creatureBridge',jsonb_build_object(
      'status','FORWARDED',
      'result',v_creature
    )
  );
end;
$$;
revoke all on function private.world_combat_finalize_with_creature_v1(
  uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.world_combat_start_with_creature_v1(
  p_user uuid,
  p_combat_id text,
  p_source_ref text,
  p_client_encounter_key uuid,
  p_definition_version integer,
  p_resolver_version integer,
  p_initial_state jsonb default '{}'::jsonb)
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

  return private.world_combat_start_with_creature_v1(
    p_user,p_combat_id,p_source_ref,p_client_encounter_key,
    p_definition_version,p_resolver_version,p_initial_state);
end;
$$;

create or replace function public.world_combat_finalize_with_creature_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_terminal_status text,
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

  return private.world_combat_finalize_with_creature_v1(
    p_user,p_encounter_id,p_terminal_status,p_result_ref);
end;
$$;

revoke execute on function public.world_combat_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_combat_finalize_with_creature_v1(
  uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.world_combat_start_with_creature_v1(
  uuid,text,text,uuid,integer,integer,jsonb)
  to service_role;
grant execute on function public.world_combat_finalize_with_creature_v1(
  uuid,uuid,text,text)
  to service_role;