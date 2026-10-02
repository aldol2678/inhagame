-- Public forward migration: ported from the private Life M1 migration (Production lineage version
-- 20261002112946). Versions are not shared across the two lineages.
-- INHA WORLD Life M1 · Material Catalog Compatibility.
--
-- Extends the existing C0/C1 catalog + grant authority without creating Activity/Life Skill/
-- Collection Discovery state yet. The code catalog remains product canon; this migration mirrors
-- the three first stackable MATERIAL fixtures and admits the generic server-side sources required
-- by future Activity/Crafting/Equipment/Research adapters.
--
-- Existing 26 collection/cosmetic items stay unchanged and UNIQUE.

-- ---- Catalog vocabulary ----
alter table private.world_item_catalog
  drop constraint if exists world_item_catalog_category_check;
alter table private.world_item_catalog
  add constraint world_item_catalog_category_check
  check (category in (
    'WEARABLE', 'BADGE', 'EMOTE', 'FURNITURE', 'MOUNT', 'MOUNT_COSMETIC', 'MEMORABILIA', 'MATERIAL'
  ));

alter table private.world_item_grants
  drop constraint if exists world_item_grants_source_type_check;
alter table private.world_item_grants
  add constraint world_item_grants_source_type_check
  check (source_type in (
    'DEFAULT', 'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'SHOP',
    'INHAGAME_REWARD', 'ACTIVITY', 'CRAFTING', 'EQUIPMENT', 'RESEARCH', 'SYSTEM', 'ADMIN'
  ));

-- ---- First real stackable materials ----
insert into private.world_item_catalog(item_id, category, ownership_policy, max_stack, status) values
  ('material.campus_leaf', 'MATERIAL', 'STACKABLE', 99, 'ACTIVE'),
  ('material.fish_carp', 'MATERIAL', 'STACKABLE', 99, 'ACTIVE'),
  ('material.artifact_fragment_01', 'MATERIAL', 'STACKABLE', 99, 'ACTIVE')
on conflict (item_id) do nothing;

-- ---- Grant core: same P0-B authority, expanded source vocabulary only ----
create or replace function private.world_inventory_grant_v1(
  p_user uuid,
  p_item_id text,
  p_quantity integer,
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text,
  p_event_id text,
  p_metadata jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_catalog private.world_item_catalog%rowtype;
  v_grant private.world_item_grants%rowtype;
  v_owned private.world_player_items%rowtype;
  v_before integer;
  v_result text;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_item_id is null or p_item_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' or char_length(p_item_id) > 80 then
    raise exception 'INVALID_ITEM_ID' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'DEFAULT', 'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'SHOP',
       'INHAGAME_REWARD', 'ACTIVITY', 'CRAFTING', 'EQUIPMENT', 'RESEARCH', 'SYSTEM', 'ADMIN')
     or p_source_ref is null or char_length(p_source_ref) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_event_id is not null and p_event_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' then
    raise exception 'INVALID_EVENT_ID' using errcode = '22023';
  end if;
  if p_metadata is not null and (jsonb_typeof(p_metadata) <> 'object'
       or octet_length(p_metadata::text) > 2048) then
    raise exception 'INVALID_METADATA' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || p_user::text, 0));

  select * into v_grant from private.world_item_grants g where g.grant_id = p_idempotency_key;
  if found then
    if (v_grant.user_id, v_grant.item_id, v_grant.quantity_requested, v_grant.source_type,
        v_grant.source_ref, v_grant.event_id)
       is distinct from (p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_event_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    select * into v_owned from private.world_player_items i
     where i.user_id = p_user and i.item_id = p_item_id;
    return private.world_inventory_grant_result_v1(v_grant, 'ALREADY_PROCESSED', v_owned.acquired_at);
  end if;

  select * into v_catalog from private.world_item_catalog c where c.item_id = p_item_id;
  if not found then
    raise exception 'UNKNOWN_ITEM' using errcode = '22023';
  end if;
  if v_catalog.status in ('DISABLED', 'HIDDEN') then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_catalog.ownership_policy = 'UNIQUE' and p_quantity <> 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select * into v_owned from private.world_player_items i
   where i.user_id = p_user and i.item_id = p_item_id
     for update;
  v_before := coalesce(v_owned.quantity, 0);

  if v_catalog.ownership_policy = 'UNIQUE' and v_before > 0 then
    v_result := 'ALREADY_OWNED';
  else
    if v_catalog.ownership_policy = 'STACKABLE' and v_before + p_quantity > v_catalog.max_stack then
      raise exception 'MAX_STACK_EXCEEDED' using errcode = 'P0001';
    end if;
    v_result := 'GRANTED';
  end if;

  begin
    insert into private.world_item_grants (
      grant_id, user_id, item_id, result, quantity_requested,
      quantity_before, quantity_granted, quantity_after,
      source_type, source_ref, event_id, acquisition_metadata)
    values (
      p_idempotency_key, p_user, p_item_id, v_result, p_quantity,
      v_before, case when v_result = 'GRANTED' then p_quantity else 0 end,
      v_before + case when v_result = 'GRANTED' then p_quantity else 0 end,
      p_source_type, p_source_ref, p_event_id, p_metadata)
    returning * into v_grant;
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end;

  if v_result = 'GRANTED' then
    if v_before = 0 then
      insert into private.world_player_items (
        user_id, item_id, quantity, source_type, source_ref, event_id, grant_id, acquisition_metadata)
      values (
        p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_event_id, p_idempotency_key, p_metadata)
      returning * into v_owned;
    else
      update private.world_player_items i
         set quantity = v_grant.quantity_after,
             updated_at = now()
       where i.id = v_owned.id
      returning * into v_owned;
    end if;
  end if;

  return private.world_inventory_grant_result_v1(v_grant, v_result, v_owned.acquired_at);
end;
$$;
revoke all on function private.world_inventory_grant_v1(uuid, text, integer, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

comment on table private.world_item_catalog is
  'Grant-authority mirror of the C0 code catalog. Life M1 adds STACKABLE MATERIAL fixtures; prices remain outside the catalog.';
