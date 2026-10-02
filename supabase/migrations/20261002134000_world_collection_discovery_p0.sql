-- Public forward migration: ported from the private migration recorded in the Production lineage as
-- 20261002120838 (Collection discovery). Versions are not shared across the two lineages.
-- INHA WORLD P0 Collection Discovery Authority.
--
-- Ownership != Discovery. Code Registry is product-semantic canon; this DB mirror is only the
-- write-validation subset. Only ACTIVE + SERVER_PERSISTED entries can be committed.
-- DERIVED_FROM_OWNER entries remain owned by their source domain and are never duplicated here.

create table if not exists private.world_collection_entry_catalog (
  entry_id text primary key
    check (entry_id ~ '^collection\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(entry_id) <= 120),
  category text not null
    check (category ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  persistence_mode text not null check (persistence_mode in (
    'SERVER_PERSISTED','DERIVED_FROM_OWNER','SESSION_ONLY','PRESENTATION_ONLY'
  )),
  owner_domain text,
  owner_ref text,
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null check (definition_version >= 1),
  constraint world_collection_entry_catalog_owner_shape check (
    (persistence_mode = 'SERVER_PERSISTED' and owner_domain is null and owner_ref is null)
    or
    (persistence_mode = 'DERIVED_FROM_OWNER'
      and owner_domain is not null and char_length(owner_domain) between 1 and 200
      and owner_ref is not null and char_length(owner_ref) between 1 and 200)
    or
    (persistence_mode in ('SESSION_ONLY','PRESENTATION_ONLY')
      and owner_domain is null and owner_ref is null)
  )
);
comment on table private.world_collection_entry_catalog is
  'Write-authority mirror of the Collection Entry code Registry. Not a presentation catalog.';

insert into private.world_collection_entry_catalog(
  entry_id, category, persistence_mode, owner_domain, owner_ref, status, definition_version)
values
  ('collection.fish.carp', 'FISH', 'SERVER_PERSISTED', null, null, 'COMING_SOON', 1),
  ('collection.plant.campus_leaf', 'PLANT', 'SERVER_PERSISTED', null, null, 'COMING_SOON', 1),
  ('collection.artifact.campus_fragment_01', 'ARTIFACT', 'SERVER_PERSISTED', null, null, 'COMING_SOON', 1),
  ('collection.place.biryong_tower', 'PLACE', 'DERIVED_FROM_OWNER', 'BIRYONG', 'BR01', 'ACTIVE', 1)
on conflict (entry_id) do nothing;

create table if not exists private.world_collection_discovery_events (
  discovery_event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null
    check (entry_id ~ '^collection\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(entry_id) <= 120),
  source_type text not null check (source_type in (
    'ACTIVITY','OWNERSHIP','QUEST','EVENT','COMBAT','RESEARCH','SYSTEM','ADMIN'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  result_ref text check (
    result_ref is null or (
      result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(result_ref) <= 200
    )
  ),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  definition_version integer not null check (definition_version >= 1),
  metadata jsonb check (
    metadata is null or (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048)
  ),
  discovered_at timestamptz not null default now()
);
comment on table private.world_collection_discovery_events is
  'Append-only verified discovery events. One idempotency key represents one verified source result.';

create table if not exists private.world_player_collection_discoveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id text not null
    check (entry_id ~ '^collection\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
      and char_length(entry_id) <= 120),
  first_discovered_at timestamptz not null,
  last_discovered_at timestamptz not null,
  discovery_count bigint not null check (discovery_count >= 1),
  first_source_type text not null check (first_source_type in (
    'ACTIVITY','OWNERSHIP','QUEST','EVENT','COMBAT','RESEARCH','SYSTEM','ADMIN'
  )),
  first_source_ref text not null check (char_length(first_source_ref) between 1 and 200),
  first_result_ref text check (
    first_result_ref is null or (
      first_result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      and char_length(first_result_ref) <= 200
    )
  ),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  constraint world_player_collection_discoveries_time check (
    last_discovered_at >= first_discovered_at
  )
);
comment on table private.world_player_collection_discoveries is
  'Current server-persisted Discovery projection. First provenance is immutable; count/version advance together.';

create index if not exists world_collection_discovery_events_user_created_idx
  on private.world_collection_discovery_events(user_id, discovered_at desc);
create index if not exists world_player_collection_discoveries_user_updated_idx
  on private.world_player_collection_discoveries(user_id, updated_at desc);

alter table private.world_collection_entry_catalog enable row level security;
alter table private.world_collection_discovery_events enable row level security;
alter table private.world_player_collection_discoveries enable row level security;
revoke all on table private.world_collection_entry_catalog,
  private.world_collection_discovery_events,
  private.world_player_collection_discoveries
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_discovery_event_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'COLLECTION_DISCOVERY_EVENT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_collection_discovery_event_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_collection_discovery_event_append_only
  on private.world_collection_discovery_events;
create trigger world_collection_discovery_event_append_only
  before update on private.world_collection_discovery_events
  for each row execute function private.world_collection_discovery_event_append_only_v1();

create or replace function private.world_collection_projection_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.user_id, new.entry_id, new.first_discovered_at, new.first_source_type,
      new.first_source_ref, new.first_result_ref)
     is distinct from
     (old.user_id, old.entry_id, old.first_discovered_at, old.first_source_type,
      old.first_source_ref, old.first_result_ref) then
    raise exception 'COLLECTION_FIRST_PROVENANCE_IMMUTABLE' using errcode = '42501';
  end if;

  if new.discovery_count <> old.discovery_count + 1
     or new.version <> old.version + 1
     or new.last_discovered_at < old.last_discovered_at
     or new.updated_at < old.updated_at then
    raise exception 'COLLECTION_PROJECTION_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function private.world_collection_projection_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_collection_projection_guard
  on private.world_player_collection_discoveries;
create trigger world_collection_projection_guard
  before update on private.world_player_collection_discoveries
  for each row execute function private.world_collection_projection_guard_v1();

create or replace function private.world_collection_account_ok_v1(p_user uuid)
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
revoke all on function private.world_collection_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_projection_json_v1(
  p_projection private.world_player_collection_discoveries)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'entryId', p_projection.entry_id,
    'discovered', true,
    'discoveryState', 'DISCOVERED',
    'firstDiscoveredAt', p_projection.first_discovered_at,
    'lastDiscoveredAt', p_projection.last_discovered_at,
    'discoveryCount', p_projection.discovery_count,
    'firstSourceType', p_projection.first_source_type,
    'firstSourceRef', p_projection.first_source_ref,
    'firstResultRef', p_projection.first_result_ref,
    'version', p_projection.version,
    'updatedAt', p_projection.updated_at
  );
$$;
revoke all on function private.world_collection_projection_json_v1(
  private.world_player_collection_discoveries)
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_entry_snapshot_v1(
  p_user uuid,
  p_entry private.world_collection_entry_catalog)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_projection private.world_player_collection_discoveries%rowtype;
begin
  if p_entry.persistence_mode = 'SERVER_PERSISTED' then
    select * into v_projection
      from private.world_player_collection_discoveries d
     where d.user_id = p_user
       and d.entry_id = p_entry.entry_id;

    return jsonb_build_object(
      'entryId', p_entry.entry_id,
      'category', p_entry.category,
      'persistenceMode', p_entry.persistence_mode,
      'ownerDomain', null,
      'ownerRef', null,
      'catalogStatus', p_entry.status,
      'definitionVersion', p_entry.definition_version,
      'discoveryState', case when found then 'DISCOVERED' else 'UNKNOWN' end,
      'discovered', found,
      'firstDiscoveredAt', case when found then v_projection.first_discovered_at else null end,
      'lastDiscoveredAt', case when found then v_projection.last_discovered_at else null end,
      'discoveryCount', case when found then v_projection.discovery_count else 0 end,
      'version', case when found then v_projection.version else 0 end
    );
  end if;

  if p_entry.persistence_mode = 'DERIVED_FROM_OWNER' then
    return jsonb_build_object(
      'entryId', p_entry.entry_id,
      'category', p_entry.category,
      'persistenceMode', p_entry.persistence_mode,
      'ownerDomain', p_entry.owner_domain,
      'ownerRef', p_entry.owner_ref,
      'catalogStatus', p_entry.status,
      'definitionVersion', p_entry.definition_version,
      'discoveryState', 'OWNER_DERIVED',
      'discovered', null,
      'firstDiscoveredAt', null,
      'lastDiscoveredAt', null,
      'discoveryCount', null,
      'version', null
    );
  end if;

  return jsonb_build_object(
    'entryId', p_entry.entry_id,
    'category', p_entry.category,
    'persistenceMode', p_entry.persistence_mode,
    'ownerDomain', null,
    'ownerRef', null,
    'catalogStatus', p_entry.status,
    'definitionVersion', p_entry.definition_version,
    'discoveryState', 'NOT_PERSISTED',
    'discovered', null,
    'firstDiscoveredAt', null,
    'lastDiscoveredAt', null,
    'discoveryCount', null,
    'version', null
  );
end;
$$;
revoke all on function private.world_collection_entry_snapshot_v1(
  uuid,private.world_collection_entry_catalog)
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_discovery_result_v1(
  p_event private.world_collection_discovery_events,
  p_status text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_status,
    'discoveryEventId', p_event.discovery_event_id,
    'userId', p_event.user_id,
    'entryId', p_event.entry_id,
    'sourceType', p_event.source_type,
    'sourceRef', p_event.source_ref,
    'resultRef', p_event.result_ref,
    'idempotencyKey', p_event.idempotency_key,
    'definitionVersion', p_event.definition_version,
    'discoveredAt', p_event.discovered_at,
    'projection', private.world_collection_projection_json_v1(d)
  )
  from private.world_player_collection_discoveries d
  where d.user_id = p_event.user_id
    and d.entry_id = p_event.entry_id;
$$;
revoke all on function private.world_collection_discovery_result_v1(
  private.world_collection_discovery_events,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_discover_v1(
  p_user uuid,
  p_entry_id text,
  p_source_type text,
  p_source_ref text,
  p_result_ref text,
  p_idempotency_key text,
  p_metadata jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entry private.world_collection_entry_catalog%rowtype;
  v_event private.world_collection_discovery_events%rowtype;
  v_projection private.world_player_collection_discoveries%rowtype;
  v_now timestamptz := now();
  v_status text;
begin
  if p_entry_id is null
     or p_entry_id !~ '^collection\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
     or char_length(p_entry_id) > 120 then
    raise exception 'INVALID_COLLECTION_ENTRY_ID' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'ACTIVITY','OWNERSHIP','QUEST','EVENT','COMBAT','RESEARCH','SYSTEM','ADMIN')
     or p_source_ref is null or char_length(p_source_ref) not between 1 and 200 then
    raise exception 'INVALID_DISCOVERY_SOURCE' using errcode = '22023';
  end if;
  if p_result_ref is not null and (
       p_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
       or char_length(p_result_ref) > 200) then
    raise exception 'INVALID_RESULT_REF' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_metadata is not null and (
       jsonb_typeof(p_metadata) <> 'object'
       or octet_length(p_metadata::text) > 2048) then
    raise exception 'INVALID_METADATA' using errcode = '22023';
  end if;
  if not private.world_collection_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_collection:' || p_user::text, 0));

  select * into v_event
    from private.world_collection_discovery_events e
   where e.idempotency_key = p_idempotency_key;
  if found then
    if (v_event.user_id, v_event.entry_id, v_event.source_type, v_event.source_ref,
        v_event.result_ref, v_event.metadata)
       is distinct from
       (p_user, p_entry_id, p_source_type, p_source_ref, p_result_ref, p_metadata) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_collection_discovery_result_v1(v_event, 'ALREADY_PROCESSED');
  end if;

  select * into v_entry
    from private.world_collection_entry_catalog c
   where c.entry_id = p_entry_id;
  if not found then
    raise exception 'COLLECTION_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_entry.status <> 'ACTIVE' then
    raise exception 'COLLECTION_ENTRY_INACTIVE' using errcode = 'P0001';
  end if;
  if v_entry.persistence_mode <> 'SERVER_PERSISTED' then
    raise exception 'COLLECTION_WRITE_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  insert into private.world_collection_discovery_events(
    user_id, entry_id, source_type, source_ref, result_ref,
    idempotency_key, definition_version, metadata, discovered_at)
  values (
    p_user, p_entry_id, p_source_type, p_source_ref, p_result_ref,
    p_idempotency_key, v_entry.definition_version, p_metadata, v_now)
  returning * into v_event;

  select * into v_projection
    from private.world_player_collection_discoveries d
   where d.user_id = p_user
     and d.entry_id = p_entry_id
   for update;

  if not found then
    insert into private.world_player_collection_discoveries(
      user_id, entry_id,
      first_discovered_at, last_discovered_at, discovery_count,
      first_source_type, first_source_ref, first_result_ref,
      version, updated_at)
    values (
      p_user, p_entry_id,
      v_now, v_now, 1,
      p_source_type, p_source_ref, p_result_ref,
      1, v_now)
    returning * into v_projection;
    v_status := 'DISCOVERED';
  else
    update private.world_player_collection_discoveries d
       set last_discovered_at = v_now,
           discovery_count = d.discovery_count + 1,
           version = d.version + 1,
           updated_at = v_now
     where d.user_id = p_user
       and d.entry_id = p_entry_id
    returning * into v_projection;
    v_status := 'REDISCOVERED';
  end if;

  return private.world_collection_discovery_result_v1(v_event, v_status);
exception when unique_violation then
  select * into v_event
    from private.world_collection_discovery_events e
   where e.idempotency_key = p_idempotency_key;
  if found
     and (v_event.user_id, v_event.entry_id, v_event.source_type, v_event.source_ref,
          v_event.result_ref, v_event.metadata)
         is not distinct from
         (p_user, p_entry_id, p_source_type, p_source_ref, p_result_ref, p_metadata) then
    return private.world_collection_discovery_result_v1(v_event, 'ALREADY_PROCESSED');
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
end;
$$;
revoke all on function private.world_collection_discover_v1(
  uuid,text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_collection_list_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.world_collection_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'userId', p_user,
    'entries', coalesce((
      select jsonb_agg(
        private.world_collection_entry_snapshot_v1(p_user, c)
        order by c.entry_id
      )
      from private.world_collection_entry_catalog c
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_collection_list_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.world_collection_discover_v1(
  p_user uuid,
  p_entry_id text,
  p_source_type text,
  p_source_ref text,
  p_result_ref text,
  p_idempotency_key text,
  p_metadata jsonb default null)
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
  return private.world_collection_discover_v1(
    p_user, p_entry_id, p_source_type, p_source_ref,
    p_result_ref, p_idempotency_key, p_metadata);
end;
$$;

create or replace function public.world_collection_list_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  return private.world_collection_list_v1(p_user);
end;
$$;

revoke execute on function public.world_collection_discover_v1(
  uuid,text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.world_collection_list_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.world_collection_discover_v1(
  uuid,text,text,text,text,text,jsonb)
  to service_role;
grant execute on function public.world_collection_list_v1(uuid)
  to service_role;
