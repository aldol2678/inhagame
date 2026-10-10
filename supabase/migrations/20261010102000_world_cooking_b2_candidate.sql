-- Cooking B2 forward candidate. Closed by default; no grants, shop listings, Life XP or combat effects.
-- This repository's migrations target disposable local databases only, never Production.
alter table private.world_item_catalog drop constraint world_item_catalog_category_check;
alter table private.world_item_catalog add constraint world_item_catalog_category_check check (category in (
  'WEARABLE','BADGE','EMOTE','FURNITURE','MOUNT','MOUNT_COSMETIC','MEMORABILIA','MATERIAL','CONSUMABLE'
));
insert into private.world_item_catalog(item_id,category,ownership_policy,max_stack,status) values
  ('furniture.cooking_station','FURNITURE','UNIQUE',null,'COMING_SOON'),
  ('consumable.grilled_carp','CONSUMABLE','STACKABLE',20,'COMING_SOON');

create or replace function private.world_room_furniture_v1()
returns table(item_id text, width double precision, height double precision, depth double precision, surfaces text[], solid boolean, flat boolean)
language sql stable security definer set search_path = ''
as $$
  select * from (values
    ('furniture.campus_map_poster', .9::float8, .65::float8, .04::float8, array['north','east','south','west'], false, false),
    ('furniture.induck_cushion', .45, .14, .4, array['floor','bed'], true, false),
    ('furniture.dorm_desk_lamp', .22, .45, .22, array['desk','floor'], true, false),
    ('furniture.induck_chair', .6, .65, .65, array['floor'], true, false),
    ('furniture.mini_induck', .22, .28, .22, array['desk','floor'], true, false),
    ('furniture.campus_rug_blue', 2, .02, 1.5, array['floor'], false, true),
    ('furniture.dorm_resident_plate', .6, .22, .04, array['north','east','south','west'], false, false),
    ('furniture.mcm_2026_landlord_figure', .32, .35, .32, array['desk','floor'], true, false),
    ('furniture.mcm_2026_poster', 1, .75, .04, array['north','east','south','west'], false, false),
    ('furniture.dorm_single_sofa', 1.10, .72, .78, array['floor'], true, false),
    ('furniture.dorm_side_table_low', .65, .38, .65, array['floor'], true, false),
    ('furniture.dorm_bookshelf_slim', .75, 1.25, .35, array['floor'], true, false),
    ('furniture.dorm_plant_medium', .55, .80, .55, array['floor'], true, false),
    ('furniture.dorm_monitor', .52, .36, .18, array['desk'], true, false),
    ('furniture.dorm_trophy_shelf', .90, 1.10, .32, array['floor'], true, false),
    ('furniture.study_books_set', .38, .18, .22, array['desk'], true, false),
    ('furniture.cooking_station', 1.00, .90, .65, array['floor'], true, false)
  ) as furniture(item_id, width, height, depth, surfaces, solid, flat);
$$;
revoke all on function private.world_room_furniture_v1() from public, anon, authenticated;

-- One semantic catalog shared with future crafting. A domain command selects the mutation type;
-- callers never supply a plan, amount, account, room or furniture identity.
create table private.world_recipe_catalog (
  recipe_id text primary key check (recipe_id ~ '^recipe\.[a-z0-9_]+$'),
  definition_version integer not null check (definition_version > 0),
  mutation_type text not null check (mutation_type in ('COOK','CRAFT')),
  required_capability text not null check (required_capability in ('COOKING_STATION','WORKBENCH')),
  required_item_id text not null references private.world_item_catalog(item_id),
  status text not null check (status in ('COMING_SOON','ACTIVE','DISABLED')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object')
);
alter table private.world_recipe_catalog enable row level security;
revoke all on private.world_recipe_catalog from public,anon,authenticated,service_role;
insert into private.world_recipe_catalog values (
  'recipe.carp_grill',1,'COOK','COOKING_STATION','furniture.cooking_station','COMING_SOON',
  '{"consumes":[{"itemId":"material.fish_carp","quantity":1}],"grants":[{"itemId":"consumable.grilled_carp","quantity":1}]}'::jsonb
);

-- Freeze the original response, including definition version, layout revision and mutation receipt.
-- Replays do not consult a changed recipe or current inventory and cannot cook again.
create table private.world_recipe_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  recipe_id text not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table private.world_recipe_receipts enable row level security;
revoke all on private.world_recipe_receipts from public,anon,authenticated,service_role;
create function private.world_recipe_receipt_append_only_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then return old; end if;
  raise exception 'RECIPE_RECEIPT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_recipe_receipt_append_only_v1() from public,anon,authenticated,service_role;
create trigger world_recipe_receipts_append_only before update or delete on private.world_recipe_receipts
for each row execute function private.world_recipe_receipt_append_only_v1();

create function public.cook_my_world_recipe_v1(p_recipe_id text,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1();
  v_recipe private.world_recipe_catalog%rowtype;
  v_previous private.world_recipe_receipts%rowtype;
  v_room public.world_player_rooms%rowtype;
  v_layout private.world_room_layouts%rowtype;
  v_mutation jsonb; v_receipt jsonb;
begin
  -- Also check the stored account, not only claims. This guard applies to historical replay too.
  if not private.world_inventory_account_ok_v1(v_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  if p_request_id is null or p_recipe_id is null or p_recipe_id !~ '^recipe\.[a-z0-9_]+$'
     or length(p_recipe_id) > 80 then raise exception 'INVALID_RECIPE_REQUEST' using errcode = '22023'; end if;
  -- Lock order: Inventory account -> room -> layout -> station ownership -> Inventory item rows.
  -- Housing save locks room -> layout, and only reads Inventory without a row/advisory lock.
  -- It never waits on the Inventory account/item lock, so the two paths have no lock cycle.
  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || v_user::text,0));
  select * into v_previous from private.world_recipe_receipts where user_id=v_user and request_id=p_request_id;
  if found then
    if v_previous.recipe_id <> p_recipe_id then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505'; end if;
    return v_previous.receipt;
  end if;
  select * into v_recipe from private.world_recipe_catalog where recipe_id=p_recipe_id for share;
  if not found or v_recipe.status <> 'ACTIVE' or v_recipe.mutation_type <> 'COOK'
    or v_recipe.required_capability <> 'COOKING_STATION' or v_recipe.required_item_id <> 'furniture.cooking_station' then
    raise exception 'RECIPE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  select * into v_room from public.world_player_rooms where owner_user_id=v_user and room_type='DORM_1_BASIC' for update;
  if not found then raise exception 'COOKING_STATION_REQUIRED' using errcode = '42501'; end if;
  select * into v_layout from private.world_room_layouts where room_id=v_room.id for update;
  if not found or not exists (select 1 from jsonb_array_elements(v_layout.objects) o
    where o->>'itemId'=v_recipe.required_item_id and o->>'surface'='floor') then
    raise exception 'COOKING_STATION_REQUIRED' using errcode = '42501';
  end if;
  perform 1 from private.world_player_items i join private.world_item_catalog c on c.item_id=i.item_id
    where i.user_id=v_user and i.item_id=v_recipe.required_item_id and i.quantity>0
      and c.category='FURNITURE' and c.status not in ('DISABLED','HIDDEN') for share of i,c;
  if not found then raise exception 'COOKING_STATION_REQUIRED' using errcode = '42501'; end if;
  v_mutation := private.world_inventory_mutate_v1(v_user,'COOK','CRAFTING',v_recipe.recipe_id,
    'recipe:' || v_user::text || ':' || p_request_id::text,v_recipe.plan);
  v_receipt := jsonb_build_object('status','SUCCESS','recipeId',v_recipe.recipe_id,'requestId',p_request_id,
    'userId',v_user,'roomId',v_room.id,'layoutRevision',v_layout.revision,'definitionVersion',v_recipe.definition_version,
    'inventory',v_mutation);
  insert into private.world_recipe_receipts(user_id,request_id,recipe_id,receipt)
    values(v_user,p_request_id,v_recipe.recipe_id,v_receipt);
  return v_receipt;
end;
$$;
revoke all on function public.cook_my_world_recipe_v1(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cook_my_world_recipe_v1(text,uuid) to authenticated;
