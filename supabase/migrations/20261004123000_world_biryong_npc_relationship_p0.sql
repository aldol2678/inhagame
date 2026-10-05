-- INHA WORLD Biryong Village NPC Relationship Authority P0.
-- Public forward schema only.
--
-- IMPORTANT SPOILER BOUNDARY:
-- - This public repository defines the authority model and opaque fact storage schema.
-- - Stage 2/3 fact payload rows are intentionally NOT seeded here because the repository is public.
-- - Production may seed private.world_biryong_npc_relationship_fact_catalog through a private
--   Production migration. Browser clients can read only facts whose unlock_stage <= their
--   server-authoritative relationship stage.
--
-- Authority:
-- - Stage 1 is the implicit default.
-- - Only service_role may advance Stage 1 -> 2 -> 3.
-- - Authenticated permanent accounts may read only their own projection.
-- - No client role receives table writes or EXECUTE on the advance RPC.

create table if not exists private.world_biryong_npc_relationship_npc_catalog (
  npc_id text primary key
    check (npc_id ~ '^BR_NPC_00[1-8]$'),
  display_name text not null
    check (char_length(display_name) between 1 and 40),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','DISABLED','HIDDEN')),
  definition_version integer not null default 1
    check (definition_version >= 1)
);

insert into private.world_biryong_npc_relationship_npc_catalog(
  npc_id,display_name,status,definition_version)
values
  ('BR_NPC_001','강소라','ACTIVE',1),
  ('BR_NPC_002','한여울','ACTIVE',1),
  ('BR_NPC_003','남이솔','ACTIVE',1),
  ('BR_NPC_004','윤하린','ACTIVE',1),
  ('BR_NPC_005','오미래','ACTIVE',1),
  ('BR_NPC_006','한세온','ACTIVE',1),
  ('BR_NPC_007','류가람','ACTIVE',1),
  ('BR_NPC_008','이담','ACTIVE',1)
on conflict (npc_id) do nothing;

create table if not exists private.world_biryong_npc_relationship_fact_catalog (
  fact_id text primary key
    check (
      fact_id ~ '^biryong\.relationship\.br_npc_00[1-8]\.s[23]\.[a-z][a-z0-9_]{1,80}$'
      and char_length(fact_id) <= 140
    ),
  npc_id text not null references private.world_biryong_npc_relationship_npc_catalog(npc_id),
  unlock_stage smallint not null check (unlock_stage in (2,3)),
  topic_id text not null
    check (topic_id ~ '^[a-z][a-z0-9_]{1,40}$'),
  topic_label text not null
    check (char_length(topic_label) between 1 and 40),
  fact_text text not null
    check (char_length(fact_text) between 1 and 500),
  dialogue_line text not null
    check (char_length(dialogue_line) between 1 and 500),
  generative_safe boolean not null default false,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','DISABLED','HIDDEN')),
  definition_version integer not null default 1
    check (definition_version >= 1),
  unique (npc_id,fact_id)
);
comment on table private.world_biryong_npc_relationship_fact_catalog is
  'Private spoiler payload. Public repo intentionally ships schema without Stage 2/3 rows.';

create table if not exists private.world_biryong_npc_relationship_events (
  relationship_event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  npc_id text not null references private.world_biryong_npc_relationship_npc_catalog(npc_id),
  from_stage smallint not null check (from_stage between 1 and 2),
  to_stage smallint not null check (to_stage between 2 and 3),
  source_type text not null check (source_type in ('QUEST','EVENT','SYSTEM','ADMIN')),
  source_ref text not null
    check (
      source_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(source_ref) <= 200
    ),
  result_ref text check (
    result_ref is null or (
      result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(result_ref) <= 200
    )
  ),
  idempotency_key text not null unique
    check (
      idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(idempotency_key) <= 200
    ),
  definition_version integer not null check (definition_version >= 1),
  advanced_at timestamptz not null default now(),
  constraint world_biryong_relationship_event_step check (to_stage = from_stage + 1)
);
comment on table private.world_biryong_npc_relationship_events is
  'Append-only verified Stage advancement provenance. Browser clients never write this table.';

create table if not exists private.world_player_biryong_npc_relationships (
  user_id uuid not null references auth.users(id) on delete cascade,
  npc_id text not null references private.world_biryong_npc_relationship_npc_catalog(npc_id),
  stage smallint not null check (stage between 2 and 3),
  revision bigint not null default 1 check (revision >= 1),
  stage2_unlocked_at timestamptz not null,
  stage3_unlocked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id,npc_id),
  constraint world_biryong_relationship_stage3_time check (
    (stage = 2 and stage3_unlocked_at is null)
    or
    (stage = 3 and stage3_unlocked_at is not null and stage3_unlocked_at >= stage2_unlocked_at)
  )
);
comment on table private.world_player_biryong_npc_relationships is
  'Current server-authoritative relationship projection. Missing row means Stage 1.';

create index if not exists world_biryong_relationship_events_user_npc_idx
  on private.world_biryong_npc_relationship_events(user_id,npc_id,advanced_at desc);
create index if not exists world_biryong_relationship_state_user_updated_idx
  on private.world_player_biryong_npc_relationships(user_id,updated_at desc);
create index if not exists world_biryong_relationship_fact_npc_stage_idx
  on private.world_biryong_npc_relationship_fact_catalog(npc_id,unlock_stage,status);

alter table private.world_biryong_npc_relationship_npc_catalog enable row level security;
alter table private.world_biryong_npc_relationship_fact_catalog enable row level security;
alter table private.world_biryong_npc_relationship_events enable row level security;
alter table private.world_player_biryong_npc_relationships enable row level security;

revoke all on table
  private.world_biryong_npc_relationship_npc_catalog,
  private.world_biryong_npc_relationship_fact_catalog,
  private.world_biryong_npc_relationship_events,
  private.world_player_biryong_npc_relationships
  from public, anon, authenticated, service_role;

create or replace function private.world_biryong_relationship_event_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'BIRYONG_RELATIONSHIP_EVENT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_biryong_relationship_event_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_biryong_relationship_event_append_only
  on private.world_biryong_npc_relationship_events;
create trigger world_biryong_relationship_event_append_only
  before update or delete on private.world_biryong_npc_relationship_events
  for each row execute function private.world_biryong_relationship_event_append_only_v1();

create or replace function private.world_biryong_relationship_projection_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.user_id,new.npc_id,new.stage2_unlocked_at)
     is distinct from
     (old.user_id,old.npc_id,old.stage2_unlocked_at) then
    raise exception 'BIRYONG_RELATIONSHIP_PROJECTION_IMMUTABLE' using errcode = '42501';
  end if;
  if new.stage <> old.stage + 1
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'BIRYONG_RELATIONSHIP_PROJECTION_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_biryong_relationship_projection_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_biryong_relationship_projection_guard
  on private.world_player_biryong_npc_relationships;
create trigger world_biryong_relationship_projection_guard
  before update on private.world_player_biryong_npc_relationships
  for each row execute function private.world_biryong_relationship_projection_guard_v1();

create or replace function private.world_biryong_relationship_account_ok_v1(p_user uuid)
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
revoke all on function private.world_biryong_relationship_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_biryong_relationship_snapshot_v1(
  p_user uuid,
  p_npc_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_npc private.world_biryong_npc_relationship_npc_catalog%rowtype;
  v_state private.world_player_biryong_npc_relationships%rowtype;
  v_stage smallint := 1;
  v_revision bigint := 0;
  v_stage2 timestamptz := null;
  v_stage3 timestamptz := null;
  v_updated timestamptz := null;
begin
  if not private.world_biryong_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_npc
    from private.world_biryong_npc_relationship_npc_catalog n
   where n.npc_id = p_npc_id;
  if not found or v_npc.status <> 'ACTIVE' then
    raise exception 'BIRYONG_NPC_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  select * into v_state
    from private.world_player_biryong_npc_relationships r
   where r.user_id = p_user
     and r.npc_id = p_npc_id;

  if found then
    v_stage := v_state.stage;
    v_revision := v_state.revision;
    v_stage2 := v_state.stage2_unlocked_at;
    v_stage3 := v_state.stage3_unlocked_at;
    v_updated := v_state.updated_at;
  end if;

  return jsonb_build_object(
    'npcId',v_npc.npc_id,
    'stage',v_stage,
    'stageState',case v_stage
      when 1 then 'ACQUAINTED'
      when 2 then 'TRUSTED'
      else 'SHARED_RESPONSIBILITY'
    end,
    'nextStage',case when v_stage < 3 then v_stage + 1 else null end,
    'revision',v_revision,
    'stage2UnlockedAt',v_stage2,
    'stage3UnlockedAt',v_stage3,
    'updatedAt',v_updated,
    'unlockedFacts',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'factId',f.fact_id,
          'npcId',f.npc_id,
          'unlockStage',f.unlock_stage,
          'topicId',f.topic_id,
          'topicLabel',f.topic_label,
          'factText',f.fact_text,
          'dialogueLine',f.dialogue_line,
          'generativeSafe',f.generative_safe,
          'definitionVersion',f.definition_version
        )
        order by f.unlock_stage,f.fact_id
      )
      from private.world_biryong_npc_relationship_fact_catalog f
      where f.npc_id = p_npc_id
        and f.status = 'ACTIVE'
        and f.unlock_stage <= v_stage
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_biryong_relationship_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_biryong_relationship_list_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.world_biryong_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'relationships',coalesce((
      select jsonb_agg(
        private.world_biryong_relationship_snapshot_v1(p_user,n.npc_id)
        order by n.npc_id
      )
      from private.world_biryong_npc_relationship_npc_catalog n
      where n.status = 'ACTIVE'
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_biryong_relationship_list_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_biryong_relationship_advance_v1(
  p_user uuid,
  p_npc_id text,
  p_target_stage smallint,
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
  v_npc private.world_biryong_npc_relationship_npc_catalog%rowtype;
  v_event private.world_biryong_npc_relationship_events%rowtype;
  v_state private.world_player_biryong_npc_relationships%rowtype;
  v_current_stage smallint := 1;
  v_current_revision bigint := 0;
  v_now timestamptz := now();
begin
  if p_target_stage not in (2,3) then
    raise exception 'INVALID_RELATIONSHIP_STAGE' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in ('QUEST','EVENT','SYSTEM','ADMIN') then
    raise exception 'INVALID_RELATIONSHIP_SOURCE' using errcode = '22023';
  end if;
  if p_source_ref is null
     or p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or char_length(p_source_ref) > 200 then
    raise exception 'INVALID_RELATIONSHIP_SOURCE_REF' using errcode = '22023';
  end if;
  if p_result_ref is not null and (
       p_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
       or char_length(p_result_ref) > 200) then
    raise exception 'INVALID_RELATIONSHIP_RESULT_REF' using errcode = '22023';
  end if;
  if p_source_type in ('QUEST','EVENT') and p_result_ref is null then
    raise exception 'RELATIONSHIP_RESULT_REF_REQUIRED' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
     or char_length(p_idempotency_key) > 200 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_biryong_relationship_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_npc
    from private.world_biryong_npc_relationship_npc_catalog n
   where n.npc_id = p_npc_id;
  if not found or v_npc.status <> 'ACTIVE' then
    raise exception 'BIRYONG_NPC_NOT_AVAILABLE' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('world_biryong_relationship:' || p_user::text || ':' || p_npc_id,0));

  select * into v_event
    from private.world_biryong_npc_relationship_events e
   where e.idempotency_key = p_idempotency_key;
  if found then
    if (v_event.user_id,v_event.npc_id,v_event.to_stage,v_event.source_type,
        v_event.source_ref,v_event.result_ref)
       is distinct from
       (p_user,p_npc_id,p_target_stage,p_source_type,p_source_ref,p_result_ref) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'eventId',v_event.relationship_event_id,
      'relationship',private.world_biryong_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;

  select * into v_state
    from private.world_player_biryong_npc_relationships r
   where r.user_id = p_user
     and r.npc_id = p_npc_id
   for update;

  if found then
    v_current_stage := v_state.stage;
    v_current_revision := v_state.revision;
  end if;

  if p_target_stage <= v_current_stage then
    return jsonb_build_object(
      'status','ALREADY_UNLOCKED',
      'relationship',private.world_biryong_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;
  if p_target_stage <> v_current_stage + 1 then
    raise exception 'RELATIONSHIP_STAGE_STEP_REQUIRED' using errcode = 'P0001';
  end if;

  insert into private.world_biryong_npc_relationship_events(
    user_id,npc_id,from_stage,to_stage,source_type,source_ref,result_ref,
    idempotency_key,definition_version,advanced_at)
  values (
    p_user,p_npc_id,v_current_stage,p_target_stage,p_source_type,p_source_ref,p_result_ref,
    p_idempotency_key,v_npc.definition_version,v_now)
  returning * into v_event;

  if v_current_stage = 1 then
    insert into private.world_player_biryong_npc_relationships(
      user_id,npc_id,stage,revision,stage2_unlocked_at,stage3_unlocked_at,updated_at)
    values (
      p_user,p_npc_id,2,1,v_now,null,v_now);
  else
    update private.world_player_biryong_npc_relationships r
       set stage = 3,
           revision = v_current_revision + 1,
           stage3_unlocked_at = v_now,
           updated_at = v_now
     where r.user_id = p_user
       and r.npc_id = p_npc_id;
  end if;

  return jsonb_build_object(
    'status','ADVANCED',
    'eventId',v_event.relationship_event_id,
    'relationship',private.world_biryong_relationship_snapshot_v1(p_user,p_npc_id)
  );
exception when unique_violation then
  select * into v_event
    from private.world_biryong_npc_relationship_events e
   where e.idempotency_key = p_idempotency_key;
  if found
     and (v_event.user_id,v_event.npc_id,v_event.to_stage,v_event.source_type,
          v_event.source_ref,v_event.result_ref)
         is not distinct from
         (p_user,p_npc_id,p_target_stage,p_source_type,p_source_ref,p_result_ref) then
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'eventId',v_event.relationship_event_id,
      'relationship',private.world_biryong_relationship_snapshot_v1(p_user,p_npc_id)
    );
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
end;
$$;
revoke all on function private.world_biryong_relationship_advance_v1(
  uuid,text,smallint,text,text,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_biryong_npc_relationship_v1(p_npc_id text)
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
  return private.world_biryong_relationship_snapshot_v1(v_user,p_npc_id);
end;
$$;

create or replace function public.get_my_biryong_npc_relationships_v1()
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
  return private.world_biryong_relationship_list_v1(v_user);
end;
$$;

create or replace function public.world_biryong_npc_relationship_advance_v1(
  p_user uuid,
  p_npc_id text,
  p_target_stage smallint,
  p_source_type text,
  p_source_ref text,
  p_result_ref text,
  p_idempotency_key text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.world_biryong_relationship_advance_v1(
    p_user,p_npc_id,p_target_stage,p_source_type,p_source_ref,p_result_ref,p_idempotency_key);
$$;

revoke execute on function public.get_my_biryong_npc_relationship_v1(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_my_biryong_npc_relationships_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.world_biryong_npc_relationship_advance_v1(
  uuid,text,smallint,text,text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_my_biryong_npc_relationship_v1(text)
  to authenticated;
grant execute on function public.get_my_biryong_npc_relationships_v1()
  to authenticated;
grant execute on function public.world_biryong_npc_relationship_advance_v1(
  uuid,text,smallint,text,text,text,text)
  to service_role;
