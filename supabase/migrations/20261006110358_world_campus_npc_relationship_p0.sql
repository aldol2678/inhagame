-- INHA WORLD Campus NPC Relationship Authority P0.
-- HERO 10 persistence only. No gameplay source calls this writer in this slice.
--
-- Authority:
-- - Affinity is account-scoped, server-authoritative and keyed only by stable npc_id.
-- - Relationship tier is derived from affinity and never stored.
-- - Browser clients may read only their own projection.
-- - Only service_role may apply a verified relationship event.
-- - Shared NPC world state / NPC↔NPC social graph are separate authorities.

create table if not exists private.world_campus_npc_relationship_npc_catalog (
  npc_id text primary key check (npc_id ~ '^INKYUNG-NPC-[0-9]{3}$'),
  relationship_class text not null check (relationship_class in ('HERO','RESIDENT','CROWD')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED','HIDDEN')),
  definition_version integer not null default 1 check (definition_version >= 1)
);

insert into private.world_campus_npc_relationship_npc_catalog(
  npc_id,relationship_class,status,definition_version)
values
  ('INKYUNG-NPC-001','HERO','ACTIVE',1),
  ('INKYUNG-NPC-002','HERO','ACTIVE',1),
  ('INKYUNG-NPC-005','HERO','ACTIVE',1),
  ('INKYUNG-NPC-008','HERO','ACTIVE',1),
  ('INKYUNG-NPC-012','HERO','ACTIVE',1),
  ('INKYUNG-NPC-016','HERO','ACTIVE',1),
  ('INKYUNG-NPC-029','HERO','ACTIVE',1),
  ('INKYUNG-NPC-034','HERO','ACTIVE',1),
  ('INKYUNG-NPC-042','HERO','ACTIVE',1),
  ('INKYUNG-NPC-046','HERO','ACTIVE',1)
on conflict (npc_id) do nothing;

create table if not exists private.world_campus_npc_relationship_events (
  relationship_event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  npc_id text not null references private.world_campus_npc_relationship_npc_catalog(npc_id),
  event_type text not null check (event_type in (
    'FIRST_MEETING','REUNION','MEANINGFUL_DIALOGUE','SHARED_ACTIVITY','HELPED_NPC',
    'PERSONAL_QUEST_STEP','PERSONAL_QUEST_COMPLETE','MEANINGFUL_CHOICE','NEGATIVE_CHOICE'
  )),
  signal text check (
    signal is null or (
      signal ~ '^[A-Z][A-Z0-9_]{1,63}$' and char_length(signal) <= 64
    )
  ),
  occurrence integer not null check (occurrence between 1 and 1000),
  requested_delta smallint not null check (requested_delta between -10 and 10 and requested_delta <> 0),
  applied_delta smallint not null check (applied_delta between -10 and 10),
  affinity_before smallint not null check (affinity_before between 0 and 100),
  affinity_after smallint not null check (affinity_after between 0 and 100),
  source_type text not null check (source_type in ('DIALOGUE','ACTIVITY','QUEST','WORLD','SYSTEM','ADMIN')),
  source_ref text not null check (
    source_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and char_length(source_ref) <= 200
  ),
  idempotency_key text not null unique check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and char_length(idempotency_key) <= 200
  ),
  definition_version integer not null check (definition_version >= 1),
  applied_at timestamptz not null default now(),
  constraint world_campus_npc_relationship_delta_check
    check (affinity_after - affinity_before = applied_delta),
  constraint world_campus_npc_relationship_sign_check
    check (
      (event_type = 'NEGATIVE_CHOICE' and requested_delta < 0)
      or
      (event_type <> 'NEGATIVE_CHOICE' and requested_delta > 0)
    ),
  constraint world_campus_npc_first_meeting_occurrence_check
    check (event_type <> 'FIRST_MEETING' or occurrence = 1)
);

create table if not exists private.world_player_campus_npc_relationships (
  user_id uuid not null references auth.users(id) on delete cascade,
  npc_id text not null references private.world_campus_npc_relationship_npc_catalog(npc_id),
  affinity smallint not null check (affinity between 0 and 100),
  encounter_count integer not null default 0 check (encounter_count >= 0),
  meaningful_interaction_count integer not null default 0 check (meaningful_interaction_count >= 0),
  first_interaction_at timestamptz not null,
  last_interaction_at timestamptz not null,
  last_meaningful_at timestamptz,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id,npc_id),
  constraint world_campus_npc_relationship_time_order check (
    last_interaction_at >= first_interaction_at
    and (last_meaningful_at is null or last_meaningful_at >= first_interaction_at)
    and updated_at >= first_interaction_at
  )
);

create index if not exists world_campus_npc_relationship_events_user_npc_idx
  on private.world_campus_npc_relationship_events(user_id,npc_id,applied_at desc);
create index if not exists world_campus_npc_relationship_state_user_updated_idx
  on private.world_player_campus_npc_relationships(user_id,updated_at desc);

alter table private.world_campus_npc_relationship_npc_catalog enable row level security;
alter table private.world_campus_npc_relationship_events enable row level security;
alter table private.world_player_campus_npc_relationships enable row level security;

revoke all on table
  private.world_campus_npc_relationship_npc_catalog,
  private.world_campus_npc_relationship_events,
  private.world_player_campus_npc_relationships
  from public, anon, authenticated, service_role;

create or replace function private.world_campus_npc_relationship_event_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users u where u.id = old.user_id
  ) then
    return old;
  end if;
  raise exception 'CAMPUS_NPC_RELATIONSHIP_EVENT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_campus_npc_relationship_event_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_campus_npc_relationship_event_append_only
  on private.world_campus_npc_relationship_events;
create trigger world_campus_npc_relationship_event_append_only
  before update or delete on private.world_campus_npc_relationship_events
  for each row execute function private.world_campus_npc_relationship_event_append_only_v1();

create or replace function private.world_campus_npc_relationship_projection_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.user_id,new.npc_id,new.first_interaction_at)
     is distinct from
     (old.user_id,old.npc_id,old.first_interaction_at) then
    raise exception 'CAMPUS_NPC_RELATIONSHIP_PROJECTION_IMMUTABLE' using errcode = '42501';
  end if;
  if new.revision <> old.revision + 1
     or abs(new.affinity - old.affinity) > 10
     or new.encounter_count < old.encounter_count
     or new.encounter_count > old.encounter_count + 1
     or new.meaningful_interaction_count < old.meaningful_interaction_count
     or new.meaningful_interaction_count > old.meaningful_interaction_count + 1
     or new.last_interaction_at < old.last_interaction_at
     or (old.last_meaningful_at is not null and new.last_meaningful_at is null)
     or (old.last_meaningful_at is not null and new.last_meaningful_at < old.last_meaningful_at)
     or new.updated_at < old.updated_at then
    raise exception 'CAMPUS_NPC_RELATIONSHIP_PROJECTION_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_campus_npc_relationship_projection_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_campus_npc_relationship_projection_guard
  on private.world_player_campus_npc_relationships;
create trigger world_campus_npc_relationship_projection_guard
  before update on private.world_player_campus_npc_relationships
  for each row execute function private.world_campus_npc_relationship_projection_guard_v1();

create or replace function private.world_campus_npc_relationship_account_ok_v1(p_user uuid)
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
revoke all on function private.world_campus_npc_relationship_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_campus_npc_relationship_tier_v1(p_affinity integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_affinity between 0 and 9 then 'STRANGER'
    when p_affinity between 10 and 24 then 'FAMILIAR'
    when p_affinity between 25 and 44 then 'FRIENDLY'
    when p_affinity between 45 and 69 then 'FRIEND'
    when p_affinity between 70 and 100 then 'TRUSTED'
    else null
  end;
$$;
revoke all on function private.world_campus_npc_relationship_tier_v1(integer)
  from public, anon, authenticated, service_role;

create or replace function private.world_campus_npc_relationship_snapshot_v1(
  p_user uuid,
  p_npc_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_npc private.world_campus_npc_relationship_npc_catalog%rowtype;
  v_state private.world_player_campus_npc_relationships%rowtype;
  v_affinity smallint := 0;
  v_encounters integer := 0;
  v_meaningful integer := 0;
  v_revision bigint := 0;
begin
  if not private.world_campus_npc_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_npc
    from private.world_campus_npc_relationship_npc_catalog n
   where n.npc_id = p_npc_id;
  if not found or v_npc.status <> 'ACTIVE' then
    raise exception 'CAMPUS_NPC_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select * into v_state
    from private.world_player_campus_npc_relationships r
   where r.user_id = p_user
     and r.npc_id = p_npc_id;

  if found then
    v_affinity := v_state.affinity;
    v_encounters := v_state.encounter_count;
    v_meaningful := v_state.meaningful_interaction_count;
    v_revision := v_state.revision;
  end if;

  return jsonb_build_object(
    'npcId',v_npc.npc_id,
    'relationshipClass',v_npc.relationship_class,
    'definitionVersion',v_npc.definition_version,
    'affinity',v_affinity,
    'tier',private.world_campus_npc_relationship_tier_v1(v_affinity),
    'encounterCount',v_encounters,
    'meaningfulInteractionCount',v_meaningful,
    'firstInteractionAt',case when found then v_state.first_interaction_at else null end,
    'lastInteractionAt',case when found then v_state.last_interaction_at else null end,
    'lastMeaningfulAt',case when found then v_state.last_meaningful_at else null end,
    'revision',v_revision,
    'updatedAt',case when found then v_state.updated_at else null end
  );
end;
$$;
revoke all on function private.world_campus_npc_relationship_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_campus_npc_relationship_list_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.world_campus_npc_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'relationships',coalesce((
      select jsonb_agg(
        private.world_campus_npc_relationship_snapshot_v1(p_user,n.npc_id)
        order by n.npc_id
      )
      from private.world_campus_npc_relationship_npc_catalog n
      where n.status = 'ACTIVE'
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_campus_npc_relationship_list_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_campus_npc_relationship_apply_v1(
  p_user uuid,
  p_npc_id text,
  p_definition_version integer,
  p_event_type text,
  p_signal text,
  p_occurrence integer,
  p_requested_delta smallint,
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_npc private.world_campus_npc_relationship_npc_catalog%rowtype;
  v_event private.world_campus_npc_relationship_events%rowtype;
  v_state private.world_player_campus_npc_relationships%rowtype;
  v_before smallint := 0;
  v_after smallint := 0;
  v_applied smallint := 0;
  v_encounter_inc integer := 0;
  v_meaningful_inc integer := 0;
  v_state_found boolean := false;
  v_now timestamptz := now();
begin
  if p_event_type is null or p_event_type not in (
    'FIRST_MEETING','REUNION','MEANINGFUL_DIALOGUE','SHARED_ACTIVITY','HELPED_NPC',
    'PERSONAL_QUEST_STEP','PERSONAL_QUEST_COMPLETE','MEANINGFUL_CHOICE','NEGATIVE_CHOICE'
  ) then
    raise exception 'INVALID_CAMPUS_NPC_RELATIONSHIP_EVENT' using errcode = '22023';
  end if;
  if p_event_type = 'FIRST_MEETING' and p_occurrence <> 1 then
    raise exception 'INVALID_FIRST_MEETING_OCCURRENCE' using errcode = '22023';
  end if;
  if p_occurrence is null or p_occurrence < 1 or p_occurrence > 1000 then
    raise exception 'INVALID_RELATIONSHIP_OCCURRENCE' using errcode = '22023';
  end if;
  if p_requested_delta is null or p_requested_delta = 0 or p_requested_delta < -10 or p_requested_delta > 10 then
    raise exception 'INVALID_RELATIONSHIP_DELTA' using errcode = '22023';
  end if;
  if (p_event_type = 'NEGATIVE_CHOICE' and p_requested_delta > 0)
     or (p_event_type <> 'NEGATIVE_CHOICE' and p_requested_delta < 0) then
    raise exception 'RELATIONSHIP_DELTA_SIGN_MISMATCH' using errcode = '22023';
  end if;
  if p_signal is not null and (
       p_signal !~ '^[A-Z][A-Z0-9_]{1,63}$' or char_length(p_signal) > 64) then
    raise exception 'INVALID_RELATIONSHIP_SIGNAL' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in ('DIALOGUE','ACTIVITY','QUEST','WORLD','SYSTEM','ADMIN') then
    raise exception 'INVALID_RELATIONSHIP_SOURCE' using errcode = '22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or char_length(p_source_ref) > 200 then
    raise exception 'INVALID_RELATIONSHIP_SOURCE_REF' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or char_length(p_idempotency_key) > 200 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_campus_npc_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_npc
    from private.world_campus_npc_relationship_npc_catalog n
   where n.npc_id = p_npc_id;
  if not found or v_npc.status <> 'ACTIVE' then
    raise exception 'CAMPUS_NPC_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  if p_definition_version is distinct from v_npc.definition_version then
    raise exception 'RELATIONSHIP_DEFINITION_VERSION_MISMATCH' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('world_campus_npc_relationship:' || p_user::text || ':' || p_npc_id,0));

  select * into v_event
    from private.world_campus_npc_relationship_events e
   where e.idempotency_key = p_idempotency_key;
  if found then
    if (v_event.user_id,v_event.npc_id,v_event.definition_version,v_event.event_type,
        v_event.signal,v_event.occurrence,v_event.requested_delta,v_event.source_type,v_event.source_ref)
       is distinct from
       (p_user,p_npc_id,p_definition_version,p_event_type,p_signal,p_occurrence,p_requested_delta,p_source_type,p_source_ref) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'eventId',v_event.relationship_event_id,
      'relationship',private.world_campus_npc_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;

  if p_event_type = 'FIRST_MEETING' and exists (
    select 1 from private.world_campus_npc_relationship_events e
     where e.user_id = p_user and e.npc_id = p_npc_id and e.event_type = 'FIRST_MEETING'
  ) then
    return jsonb_build_object(
      'status','ALREADY_MET',
      'relationship',private.world_campus_npc_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;

  select * into v_state
    from private.world_player_campus_npc_relationships r
   where r.user_id = p_user and r.npc_id = p_npc_id
   for update;

  v_state_found := found;
  if v_state_found then v_before := v_state.affinity; end if;
  v_after := greatest(0,least(100,v_before + p_requested_delta));
  v_applied := v_after - v_before;
  v_encounter_inc := case when p_event_type in ('FIRST_MEETING','REUNION') then 1 else 0 end;
  v_meaningful_inc := case when p_event_type in ('FIRST_MEETING','REUNION') then 0 else 1 end;

  insert into private.world_campus_npc_relationship_events(
    user_id,npc_id,event_type,signal,occurrence,requested_delta,applied_delta,
    affinity_before,affinity_after,source_type,source_ref,idempotency_key,
    definition_version,applied_at)
  values (
    p_user,p_npc_id,p_event_type,p_signal,p_occurrence,p_requested_delta,v_applied,
    v_before,v_after,p_source_type,p_source_ref,p_idempotency_key,
    v_npc.definition_version,v_now)
  returning * into v_event;

  if not v_state_found then
    insert into private.world_player_campus_npc_relationships(
      user_id,npc_id,affinity,encounter_count,meaningful_interaction_count,
      first_interaction_at,last_interaction_at,last_meaningful_at,revision,updated_at)
    values (
      p_user,p_npc_id,v_after,v_encounter_inc,v_meaningful_inc,
      v_now,v_now,case when v_meaningful_inc = 1 then v_now else null end,1,v_now);
  else
    update private.world_player_campus_npc_relationships r
       set affinity = v_after,
           encounter_count = r.encounter_count + v_encounter_inc,
           meaningful_interaction_count = r.meaningful_interaction_count + v_meaningful_inc,
           last_interaction_at = v_now,
           last_meaningful_at = case when v_meaningful_inc = 1 then v_now else r.last_meaningful_at end,
           revision = r.revision + 1,
           updated_at = v_now
     where r.user_id = p_user and r.npc_id = p_npc_id;
  end if;

  return jsonb_build_object(
    'status','APPLIED',
    'eventId',v_event.relationship_event_id,
    'requestedDelta',p_requested_delta,
    'appliedDelta',v_applied,
    'relationship',private.world_campus_npc_relationship_snapshot_v1(p_user,p_npc_id)
  );
exception when unique_violation then
  select * into v_event
    from private.world_campus_npc_relationship_events e
   where e.idempotency_key = p_idempotency_key;
  if found and
     (v_event.user_id,v_event.npc_id,v_event.definition_version,v_event.event_type,
      v_event.signal,v_event.occurrence,v_event.requested_delta,v_event.source_type,v_event.source_ref)
     is not distinct from
     (p_user,p_npc_id,p_definition_version,p_event_type,p_signal,p_occurrence,p_requested_delta,p_source_type,p_source_ref) then
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'eventId',v_event.relationship_event_id,
      'relationship',private.world_campus_npc_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
end;
$$;
revoke all on function private.world_campus_npc_relationship_apply_v1(
  uuid,text,integer,text,text,integer,smallint,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_world_campus_npc_relationship_v1(p_npc_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'SIGN_IN_REQUIRED' using errcode = '42501'; end if;
  return private.world_campus_npc_relationship_snapshot_v1(v_user,p_npc_id);
end;
$$;

create or replace function public.get_my_world_campus_npc_relationships_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'SIGN_IN_REQUIRED' using errcode = '42501'; end if;
  return private.world_campus_npc_relationship_list_v1(v_user);
end;
$$;

create or replace function public.world_campus_npc_relationship_apply_v1(
  p_user uuid,p_npc_id text,p_definition_version integer,p_event_type text,p_signal text,
  p_occurrence integer,p_requested_delta smallint,p_source_type text,p_source_ref text,p_idempotency_key text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.world_campus_npc_relationship_apply_v1(
    p_user,p_npc_id,p_definition_version,p_event_type,p_signal,p_occurrence,p_requested_delta,
    p_source_type,p_source_ref,p_idempotency_key);
$$;

revoke execute on function public.get_my_world_campus_npc_relationship_v1(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_my_world_campus_npc_relationships_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.world_campus_npc_relationship_apply_v1(
  uuid,text,integer,text,text,integer,smallint,text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_my_world_campus_npc_relationship_v1(text) to authenticated;
grant execute on function public.get_my_world_campus_npc_relationships_v1() to authenticated;
grant execute on function public.world_campus_npc_relationship_apply_v1(
  uuid,text,integer,text,text,integer,smallint,text,text,text) to service_role;
