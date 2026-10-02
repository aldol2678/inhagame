-- Public forward migration: ported from the private Inventory Mutation migration (Production lineage
-- version 20261002120738). Versions are not shared across the two lineages.
-- INHA WORLD P0 Inventory Mutation.
--
-- Adds STACKABLE-only consumption + atomic private N-consume/M-grant settlement.
-- No generic public mutation RPC is exposed. Future narrow domain RPCs call the private core.
-- Existing private.world_inventory_grant_v1 remains the only item-increase primitive.

create table if not exists private.world_inventory_mutations (
  mutation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_type text not null check (mutation_type in (
    'CONSUME','CRAFT','PROCESS','COOK','DISASSEMBLE','ENHANCE','RESEARCH','SYSTEM_EXCHANGE'
  )),
  source_type text not null check (source_type in (
    'DEFAULT','QUEST','EXPLORATION','ACHIEVEMENT','EVENT','MINIGAME','SHOP','INHAGAME_REWARD',
    'ACTIVITY','CRAFTING','EQUIPMENT','RESEARCH','SYSTEM','ADMIN'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  status text not null default 'COMPLETED' check (status = 'COMPLETED'),
  created_at timestamptz not null default now()
);
comment on table private.world_inventory_mutations is
  'Atomic Inventory mutation receipts. Completed rows only; failed mutations roll back completely.';

create table if not exists private.world_item_consumptions (
  consume_id text primary key
    check (consume_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null
    check (item_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' and char_length(item_id) <= 80),
  quantity_requested integer not null check (quantity_requested >= 1),
  quantity_before integer not null check (quantity_before >= 1),
  quantity_consumed integer not null check (quantity_consumed >= 1),
  quantity_after integer not null check (quantity_after >= 0),
  source_type text not null check (source_type in (
    'DEFAULT','QUEST','EXPLORATION','ACHIEVEMENT','EVENT','MINIGAME','SHOP','INHAGAME_REWARD',
    'ACTIVITY','CRAFTING','EQUIPMENT','RESEARCH','SYSTEM','ADMIN'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  parent_mutation_id uuid references private.world_inventory_mutations(mutation_id) on delete cascade,
  metadata jsonb check (metadata is null
    or (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048)),
  created_at timestamptz not null default now(),
  constraint world_item_consumptions_math check (
    quantity_consumed = quantity_requested
    and quantity_after = quantity_before - quantity_consumed
  )
);
comment on table private.world_item_consumptions is
  'Append-only successful STACKABLE consumption ledger. Quantity zero is represented by no ownership row.';

create table if not exists private.world_inventory_mutation_entries (
  mutation_id uuid not null references private.world_inventory_mutations(mutation_id) on delete cascade,
  position integer not null check (position >= 0 and position < 32),
  direction text not null check (direction in ('CONSUME','GRANT')),
  item_id text not null
    check (item_id ~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$' and char_length(item_id) <= 80),
  quantity integer not null check (quantity >= 1),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  child_idempotency_key text not null
    check (child_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  child_ref text not null check (char_length(child_ref) between 1 and 200),
  primary key (mutation_id, position)
);
comment on table private.world_inventory_mutation_entries is
  'Historical child receipt entries for one completed atomic Inventory mutation.';

create index if not exists world_inventory_mutations_user_created_idx
  on private.world_inventory_mutations(user_id, created_at desc);
create index if not exists world_item_consumptions_user_created_idx
  on private.world_item_consumptions(user_id, created_at desc);

alter table private.world_inventory_mutations enable row level security;
alter table private.world_item_consumptions enable row level security;
alter table private.world_inventory_mutation_entries enable row level security;
revoke all on table private.world_inventory_mutations, private.world_item_consumptions,
  private.world_inventory_mutation_entries from public, anon, authenticated, service_role;

create or replace function private.world_inventory_mutation_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'INVENTORY_MUTATION_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_inventory_mutation_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_inventory_mutations_append_only on private.world_inventory_mutations;
create trigger world_inventory_mutations_append_only
  before update on private.world_inventory_mutations
  for each row execute function private.world_inventory_mutation_append_only_v1();

drop trigger if exists world_item_consumptions_append_only on private.world_item_consumptions;
create trigger world_item_consumptions_append_only
  before update on private.world_item_consumptions
  for each row execute function private.world_inventory_mutation_append_only_v1();

drop trigger if exists world_inventory_mutation_entries_append_only on private.world_inventory_mutation_entries;
create trigger world_inventory_mutation_entries_append_only
  before update on private.world_inventory_mutation_entries
  for each row execute function private.world_inventory_mutation_append_only_v1();

create or replace function private.world_inventory_normalize_plan_v1(p_plan jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_consumes jsonb;
  v_grants jsonb;
  v_normal_consumes jsonb;
  v_normal_grants jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'INVALID_MUTATION_PLAN' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_plan) as keys(key)
     where keys.key not in ('consumes','grants')
  ) then
    raise exception 'INVALID_MUTATION_PLAN' using errcode = '22023';
  end if;

  v_consumes := coalesce(p_plan -> 'consumes', '[]'::jsonb);
  v_grants := coalesce(p_plan -> 'grants', '[]'::jsonb);

  if jsonb_typeof(v_consumes) <> 'array'
     or jsonb_typeof(v_grants) <> 'array'
     or jsonb_array_length(v_consumes) < 1
     or jsonb_array_length(v_consumes) > 16
     or jsonb_array_length(v_grants) > 16 then
    raise exception 'INVALID_MUTATION_PLAN' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_consumes) as e(value)
     where jsonb_typeof(e.value) <> 'object'
  ) or exists (
    select 1
      from jsonb_array_elements(v_grants) as e(value)
     where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'INVALID_MUTATION_PLAN' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_consumes) as e(value)
     where exists (
       select 1
         from jsonb_object_keys(e.value) as keys(key)
        where keys.key not in ('itemId','quantity')
     )
        or coalesce(e.value ->> 'itemId','') !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'
        or char_length(coalesce(e.value ->> 'itemId','')) > 80
        or coalesce(e.value ->> 'quantity','') !~ '^[1-9][0-9]{0,8}$'
  ) or exists (
    select 1
      from jsonb_array_elements(v_grants) as e(value)
     where exists (
       select 1
         from jsonb_object_keys(e.value) as keys(key)
        where keys.key not in ('itemId','quantity')
     )
        or coalesce(e.value ->> 'itemId','') !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'
        or char_length(coalesce(e.value ->> 'itemId','')) > 80
        or coalesce(e.value ->> 'quantity','') !~ '^[1-9][0-9]{0,8}$'
  ) then
    raise exception 'INVALID_MUTATION_PLAN' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_consumes) as e(value)
     group by e.value ->> 'itemId'
    having count(*) > 1
  ) or exists (
    select 1
      from jsonb_array_elements(v_grants) as e(value)
     group by e.value ->> 'itemId'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_MUTATION_ITEM' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_consumes) as c(value)
      join jsonb_array_elements(v_grants) as g(value)
        on c.value ->> 'itemId' = g.value ->> 'itemId'
  ) then
    raise exception 'MUTATION_ITEM_OVERLAP' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId', e.value ->> 'itemId',
        'quantity', (e.value ->> 'quantity')::integer
      )
      order by e.value ->> 'itemId'
    ),
    '[]'::jsonb
  )
    into v_normal_consumes
    from jsonb_array_elements(v_consumes) as e(value);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemId', e.value ->> 'itemId',
        'quantity', (e.value ->> 'quantity')::integer
      )
      order by e.value ->> 'itemId'
    ),
    '[]'::jsonb
  )
    into v_normal_grants
    from jsonb_array_elements(v_grants) as e(value);

  return jsonb_build_object(
    'consumes', v_normal_consumes,
    'grants', v_normal_grants
  );
end;
$$;
revoke all on function private.world_inventory_normalize_plan_v1(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_inventory_consume_result_v1(
  p_consumption private.world_item_consumptions,
  p_status text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_status,
    'consumeId', p_consumption.consume_id,
    'userId', p_consumption.user_id,
    'itemId', p_consumption.item_id,
    'quantityBefore', p_consumption.quantity_before,
    'quantityConsumed', p_consumption.quantity_consumed,
    'quantityAfter', p_consumption.quantity_after,
    'ownedAfter', p_consumption.quantity_after > 0,
    'sourceType', p_consumption.source_type,
    'sourceRef', p_consumption.source_ref,
    'parentMutationId', p_consumption.parent_mutation_id,
    'consumedAt', p_consumption.created_at
  );
$$;
revoke all on function private.world_inventory_consume_result_v1(private.world_item_consumptions,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_inventory_consume_v1(
  p_user uuid,
  p_item_id text,
  p_quantity integer,
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text,
  p_parent_mutation_id uuid default null,
  p_metadata jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_catalog private.world_item_catalog%rowtype;
  v_owned private.world_player_items%rowtype;
  v_consumption private.world_item_consumptions%rowtype;
  v_after integer;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_item_id is null or p_item_id !~ '^[a-z][a-z0-9_]*\.[a-z0-9_]+$'
     or char_length(p_item_id) > 80 then
    raise exception 'INVALID_ITEM_ID' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'DEFAULT','QUEST','EXPLORATION','ACHIEVEMENT','EVENT','MINIGAME','SHOP','INHAGAME_REWARD',
       'ACTIVITY','CRAFTING','EQUIPMENT','RESEARCH','SYSTEM','ADMIN')
     or p_source_ref is null or char_length(p_source_ref) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_metadata is not null and (jsonb_typeof(p_metadata) <> 'object'
      or octet_length(p_metadata::text) > 2048) then
    raise exception 'INVALID_METADATA' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || p_user::text, 0));

  select * into v_consumption
    from private.world_item_consumptions c
   where c.consume_id = p_idempotency_key;
  if found then
    if (v_consumption.user_id, v_consumption.item_id, v_consumption.quantity_requested,
        v_consumption.source_type, v_consumption.source_ref, v_consumption.parent_mutation_id)
       is distinct from
       (p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_parent_mutation_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_inventory_consume_result_v1(v_consumption, 'ALREADY_PROCESSED');
  end if;

  select * into v_catalog
    from private.world_item_catalog c
   where c.item_id = p_item_id;
  if not found then
    raise exception 'UNKNOWN_ITEM' using errcode = '22023';
  end if;
  if v_catalog.status in ('DISABLED','HIDDEN') then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_catalog.ownership_policy <> 'STACKABLE' then
    raise exception 'CONSUME_POLICY_UNSUPPORTED' using errcode = 'P0001';
  end if;

  select * into v_owned
    from private.world_player_items i
   where i.user_id = p_user and i.item_id = p_item_id
   for update;
  if not found then
    raise exception 'ITEM_NOT_OWNED' using errcode = 'P0002';
  end if;
  if v_owned.quantity < p_quantity then
    raise exception 'INSUFFICIENT_QUANTITY' using errcode = 'P0001';
  end if;

  v_after := v_owned.quantity - p_quantity;

  begin
    insert into private.world_item_consumptions(
      consume_id, user_id, item_id, quantity_requested, quantity_before,
      quantity_consumed, quantity_after, source_type, source_ref, parent_mutation_id, metadata)
    values (
      p_idempotency_key, p_user, p_item_id, p_quantity, v_owned.quantity,
      p_quantity, v_after, p_source_type, p_source_ref, p_parent_mutation_id, p_metadata)
    returning * into v_consumption;
  exception when unique_violation then
    select * into strict v_consumption
      from private.world_item_consumptions c
     where c.consume_id = p_idempotency_key;
    if (v_consumption.user_id, v_consumption.item_id, v_consumption.quantity_requested,
        v_consumption.source_type, v_consumption.source_ref, v_consumption.parent_mutation_id)
       is distinct from
       (p_user, p_item_id, p_quantity, p_source_type, p_source_ref, p_parent_mutation_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_inventory_consume_result_v1(v_consumption, 'ALREADY_PROCESSED');
  end;

  if v_after = 0 then
    delete from private.world_player_items i where i.id = v_owned.id;
  else
    update private.world_player_items i
       set quantity = v_after,
           updated_at = now()
     where i.id = v_owned.id;
  end if;

  return private.world_inventory_consume_result_v1(v_consumption, 'SUCCESS');
end;
$$;
revoke all on function private.world_inventory_consume_v1(uuid,text,integer,text,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.world_inventory_mutation_receipt_v1(
  p_mutation private.world_inventory_mutations,
  p_status text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_status,
    'replayed', p_status = 'ALREADY_PROCESSED',
    'mutationId', p_mutation.mutation_id,
    'userId', p_mutation.user_id,
    'mutationType', p_mutation.mutation_type,
    'sourceType', p_mutation.source_type,
    'sourceRef', p_mutation.source_ref,
    'idempotencyKey', p_mutation.idempotency_key,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', e.position,
        'direction', e.direction,
        'itemId', e.item_id,
        'quantity', e.quantity,
        'quantityBefore', e.quantity_before,
        'quantityAfter', e.quantity_after,
        'ownedAfter', e.quantity_after > 0,
        'childIdempotencyKey', e.child_idempotency_key,
        'childRef', e.child_ref
      ) order by e.position)
      from private.world_inventory_mutation_entries e
      where e.mutation_id = p_mutation.mutation_id
    ), '[]'::jsonb),
    'createdAt', p_mutation.created_at
  );
$$;
revoke all on function private.world_inventory_mutation_receipt_v1(private.world_inventory_mutations,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_inventory_mutate_v1(
  p_user uuid,
  p_mutation_type text,
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text,
  p_plan jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_mutation private.world_inventory_mutations%rowtype;
  v_catalog private.world_item_catalog%rowtype;
  v_owned private.world_player_items%rowtype;
  v_op jsonb;
  v_child jsonb;
  v_item_id text;
  v_child_key text;
  v_qty integer;
  v_before integer;
  v_pos integer := 0;
  v_child_pos integer := 0;
begin
  if p_mutation_type is null or p_mutation_type not in (
    'CONSUME','CRAFT','PROCESS','COOK','DISASSEMBLE','ENHANCE','RESEARCH','SYSTEM_EXCHANGE'
  ) then
    raise exception 'INVALID_MUTATION' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'DEFAULT','QUEST','EXPLORATION','ACHIEVEMENT','EVENT','MINIGAME','SHOP','INHAGAME_REWARD',
       'ACTIVITY','CRAFTING','EQUIPMENT','RESEARCH','SYSTEM','ADMIN')
     or p_source_ref is null or char_length(p_source_ref) not between 1 and 200 then
    raise exception 'MUTATION_SOURCE_INVALID' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  v_plan := private.world_inventory_normalize_plan_v1(p_plan);
  if p_mutation_type = 'CONSUME' and jsonb_array_length(v_plan -> 'grants') <> 0 then
    raise exception 'INVALID_MUTATION' using errcode = '22023';
  end if;
  if p_mutation_type <> 'CONSUME' and jsonb_array_length(v_plan -> 'grants') = 0 then
    raise exception 'INVALID_MUTATION' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || p_user::text, 0));

  select * into v_mutation
    from private.world_inventory_mutations m
   where m.idempotency_key = p_idempotency_key;
  if found then
    if (v_mutation.user_id, v_mutation.mutation_type, v_mutation.source_type,
        v_mutation.source_ref, v_mutation.plan)
       is distinct from
       (p_user, p_mutation_type, p_source_type, p_source_ref, v_plan) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_inventory_mutation_receipt_v1(v_mutation, 'ALREADY_PROCESSED');
  end if;

  -- Preflight every input under deterministic item ordering.
  for v_op in
    select value from jsonb_array_elements(v_plan -> 'consumes')
     order by value ->> 'itemId'
  loop
    v_item_id := v_op ->> 'itemId';
    v_qty := (v_op ->> 'quantity')::integer;

    select * into v_catalog from private.world_item_catalog c where c.item_id = v_item_id;
    if not found then raise exception 'INPUT_UNAVAILABLE' using errcode = 'P0001'; end if;
    if v_catalog.status in ('DISABLED','HIDDEN') then
      raise exception 'INPUT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if v_catalog.ownership_policy <> 'STACKABLE' then
      raise exception 'CONSUME_POLICY_UNSUPPORTED' using errcode = 'P0001';
    end if;

    select * into v_owned
      from private.world_player_items i
     where i.user_id = p_user and i.item_id = v_item_id
     for update;
    if not found or v_owned.quantity < v_qty then
      raise exception 'INSUFFICIENT_QUANTITY' using errcode = 'P0001';
    end if;
  end loop;

  -- Preflight every output before moving any input value.
  for v_op in
    select value from jsonb_array_elements(v_plan -> 'grants')
     order by value ->> 'itemId'
  loop
    v_item_id := v_op ->> 'itemId';
    v_qty := (v_op ->> 'quantity')::integer;

    select * into v_catalog from private.world_item_catalog c where c.item_id = v_item_id;
    if not found or v_catalog.status in ('DISABLED','HIDDEN') then
      raise exception 'OUTPUT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if v_catalog.ownership_policy = 'UNIQUE' and v_qty <> 1 then
      raise exception 'INVALID_QUANTITY' using errcode = '22023';
    end if;

    select * into v_owned
      from private.world_player_items i
     where i.user_id = p_user and i.item_id = v_item_id
     for update;
    v_before := coalesce(v_owned.quantity, 0);

    if v_catalog.ownership_policy = 'UNIQUE' and v_before > 0 then
      raise exception 'OUTPUT_ALREADY_OWNED' using errcode = 'P0001';
    end if;
    if v_catalog.ownership_policy = 'STACKABLE' and v_before + v_qty > v_catalog.max_stack then
      raise exception 'MAX_STACK_EXCEEDED' using errcode = 'P0001';
    end if;
  end loop;

  insert into private.world_inventory_mutations(
    user_id, mutation_type, source_type, source_ref, idempotency_key, plan)
  values (p_user, p_mutation_type, p_source_type, p_source_ref, p_idempotency_key, v_plan)
  returning * into v_mutation;

  -- Consume inputs first. Any later grant failure rolls the whole transaction back.
  v_child_pos := 0;
  for v_op in
    select value from jsonb_array_elements(v_plan -> 'consumes')
     order by value ->> 'itemId'
  loop
    v_item_id := v_op ->> 'itemId';
    v_qty := (v_op ->> 'quantity')::integer;
    v_child_key := p_idempotency_key || '/consume/' || v_child_pos::text;

    v_child := private.world_inventory_consume_v1(
      p_user, v_item_id, v_qty, p_source_type, p_source_ref, v_child_key,
      v_mutation.mutation_id, jsonb_build_object('mutationType', p_mutation_type));

    insert into private.world_inventory_mutation_entries(
      mutation_id, position, direction, item_id, quantity,
      quantity_before, quantity_after, child_idempotency_key, child_ref)
    values (
      v_mutation.mutation_id, v_pos, 'CONSUME', v_item_id, v_qty,
      (v_child ->> 'quantityBefore')::integer,
      (v_child ->> 'quantityAfter')::integer,
      v_child_key, v_child ->> 'consumeId');

    v_pos := v_pos + 1;
    v_child_pos := v_child_pos + 1;
  end loop;

  -- Reuse the existing Grant Core for outputs.
  v_child_pos := 0;
  for v_op in
    select value from jsonb_array_elements(v_plan -> 'grants')
     order by value ->> 'itemId'
  loop
    v_item_id := v_op ->> 'itemId';
    v_qty := (v_op ->> 'quantity')::integer;
    v_child_key := p_idempotency_key || '/grant/' || v_child_pos::text;

    v_child := private.world_inventory_grant_v1(
      p_user, v_item_id, v_qty, p_source_type, p_source_ref, v_child_key, null,
      jsonb_build_object('parentMutationId', v_mutation.mutation_id, 'mutationType', p_mutation_type));

    if v_child ->> 'originalStatus' <> 'GRANTED' then
      raise exception 'OUTPUT_UNAVAILABLE' using errcode = 'P0001';
    end if;

    insert into private.world_inventory_mutation_entries(
      mutation_id, position, direction, item_id, quantity,
      quantity_before, quantity_after, child_idempotency_key, child_ref)
    values (
      v_mutation.mutation_id, v_pos, 'GRANT', v_item_id, v_qty,
      (v_child ->> 'quantityBefore')::integer,
      (v_child ->> 'quantityAfter')::integer,
      v_child_key, v_child ->> 'grantId');

    v_pos := v_pos + 1;
    v_child_pos := v_child_pos + 1;
  end loop;

  return private.world_inventory_mutation_receipt_v1(v_mutation, 'SUCCESS');
exception when unique_violation then
  select * into v_mutation
    from private.world_inventory_mutations m
   where m.idempotency_key = p_idempotency_key;
  if found
     and (v_mutation.user_id, v_mutation.mutation_type, v_mutation.source_type,
          v_mutation.source_ref, v_mutation.plan)
         is not distinct from
         (p_user, p_mutation_type, p_source_type, p_source_ref, v_plan) then
    return private.world_inventory_mutation_receipt_v1(v_mutation, 'ALREADY_PROCESSED');
  end if;
  raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
end;
$$;
revoke all on function private.world_inventory_mutate_v1(uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
