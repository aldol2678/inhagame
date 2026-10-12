-- Indoor Plant P0 candidate. Disposable local DB only; no Production activation.
-- Separate from STATIC furniture.dorm_plant_medium. No Wallet, XP, consume, sale or replant.
insert into private.world_item_catalog(item_id,category,ownership_policy,max_stack,status)
values ('furniture.indoor_planter','FURNITURE','UNIQUE',null,'COMING_SOON');

-- Explicit server kill switch. Activation requires a separate reviewed migration plus an ACTIVE
-- item catalog and client release; no browser flag, query string or public setter can enable it.
create function private.world_room_plant_enabled_v1() returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
revoke all on function private.world_room_plant_enabled_v1() from public,anon,authenticated,service_role;

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
    ('furniture.cooking_station', 1.00, .90, .65, array['floor'], true, false),
    ('furniture.indoor_planter', .55, .80, .55, array['floor'], true, false)
  ) as furniture(item_id, width, height, depth, surfaces, solid, flat);
$$;
revoke all on function private.world_room_furniture_v1() from public, anon, authenticated;

-- Ownership identity survives recall/re-add (Housing generates a fresh placement UUID).
-- Exactly one permanent, non-replantable crop per UNIQUE planter. Stage is read-derived.
create table private.world_room_plants (
  user_id uuid not null references auth.users(id) on delete cascade,
  planter_item_id text not null default 'furniture.indoor_planter'
    references private.world_item_catalog(item_id) check (planter_item_id='furniture.indoor_planter'),
  plant_id text not null default 'plant.room_flower' check (plant_id='plant.room_flower'),
  definition_version integer not null default 1 check (definition_version=1),
  planted_at timestamptz not null,
  first_cared_at timestamptz,
  second_cared_at timestamptz,
  revision integer not null check (revision between 1 and 3),
  primary key(user_id,planter_item_id),
  check (first_cared_at is null or first_cared_at >= planted_at),
  check (second_cared_at is null or (first_cared_at is not null and second_cared_at >= first_cared_at + interval '20 hours')),
  check (revision = 1 + (first_cared_at is not null)::integer + (second_cared_at is not null)::integer)
);
create table private.world_room_plant_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  room_id uuid not null,
  object_id uuid not null,
  action text not null check (action in ('PLANT','CARE')),
  expected_revision integer not null,
  plant_revision integer not null check (plant_revision between 1 and 3),
  receipt jsonb not null check (jsonb_typeof(receipt)='object'),
  primary key(user_id,request_id),
  -- At most three successful command receipts per owner. Rejected/no-op spam creates no rows.
  unique(user_id,plant_revision)
);
alter table private.world_room_plants enable row level security;
alter table private.world_room_plant_receipts enable row level security;
revoke all on private.world_room_plants,private.world_room_plant_receipts from public,anon,authenticated,service_role;
create function private.world_room_plant_receipt_append_only_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and not exists (select 1 from auth.users where id=old.user_id) then return old; end if;
  raise exception 'PLANT_RECEIPT_APPEND_ONLY' using errcode='42501';
end;
$$;
revoke all on function private.world_room_plant_receipt_append_only_v1() from public,anon,authenticated,service_role;
create trigger world_room_plant_receipts_append_only before update or delete on private.world_room_plant_receipts
for each row execute function private.world_room_plant_receipt_append_only_v1();

create function public.claim_my_room_planter_v1(p_room uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1(); v_grant jsonb;
begin
  if not private.world_inventory_account_ok_v1(v_user) then raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  -- Preserve the existing Inventory -> room -> layout lock ordering.
  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || v_user::text,0));
  perform 1 from public.world_player_rooms where id=p_room and owner_user_id=v_user and room_type='DORM_1_BASIC' for update;
  if not found or private.world_room_access_v1(v_user,p_room)<>'OWNER' then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  if not private.world_room_plant_enabled_v1() or not exists (select 1 from private.world_item_catalog
    where item_id='furniture.indoor_planter' and status='ACTIVE' and ownership_policy='UNIQUE') then
    raise exception 'PLANT_UNAVAILABLE' using errcode='P0001';
  end if;
  -- A deterministic server-owned key keeps repeated claims bounded, including after ownership revocation.
  v_grant := private.world_inventory_grant_v1(v_user,'furniture.indoor_planter',1,'DEFAULT',
    'housing.planter_starter.v1','room-planter-starter:' || v_user::text,null,null);
  return jsonb_build_object('status','SUCCESS','userId',v_user,'roomId',p_room,
    'itemId','furniture.indoor_planter','inventory',v_grant);
end;
$$;

create function private.world_room_plant_command_v1(p_room uuid,p_object uuid,p_revision integer,p_request uuid,p_action text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1(); v_previous private.world_room_plant_receipts%rowtype;
  v_layout private.world_room_layouts%rowtype; v_plant private.world_room_plants%rowtype;
  v_now timestamptz; v_receipt jsonb;
begin
  if not private.world_inventory_account_ok_v1(v_user) then raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  if p_room is null or p_object is null or p_request is null or p_revision is null or p_revision not between 0 and 3
    or p_action is null or p_action not in ('PLANT','CARE') or (p_action='PLANT' and p_revision<>0) then
    raise exception 'INVALID_PLANT_REQUEST' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || v_user::text,0));
  perform 1 from public.world_player_rooms where id=p_room and owner_user_id=v_user and room_type='DORM_1_BASIC' for update;
  if not found or private.world_room_access_v1(v_user,p_room)<>'OWNER' then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  select * into v_previous from private.world_room_plant_receipts where user_id=v_user and request_id=p_request;
  if found then
    if (v_previous.room_id,v_previous.object_id,v_previous.action,v_previous.expected_revision)
      is distinct from (p_room,p_object,p_action,p_revision) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    -- Historical proof only. Caller must re-read current state; this never restores ownership or placement.
    return v_previous.receipt;
  end if;
  if not private.world_room_plant_enabled_v1() then raise exception 'PLANT_UNAVAILABLE' using errcode='P0001'; end if;
  select * into v_layout from private.world_room_layouts where room_id=p_room for update;
  if not found or not exists (select 1 from jsonb_array_elements(v_layout.objects) o where o->>'id'=p_object::text
    and o->>'itemId'='furniture.indoor_planter' and o->>'surface'='floor') then
    raise exception 'PLANTER_REQUIRED' using errcode='42501';
  end if;
  perform 1 from private.world_player_items i join private.world_item_catalog c on c.item_id=i.item_id
    where i.user_id=v_user and i.item_id='furniture.indoor_planter' and i.quantity=1
      and c.status='ACTIVE' and c.category='FURNITURE' and c.ownership_policy='UNIQUE' for share of i,c;
  if not found then raise exception 'PLANTER_REQUIRED' using errcode='42501'; end if;
  select * into v_plant from private.world_room_plants where user_id=v_user and planter_item_id='furniture.indoor_planter' for update;
  v_now := clock_timestamp(); -- captured once AFTER locks; clients never submit growth time.
  if p_action='PLANT' then
    if found then raise exception 'PLANT_ALREADY_PLANTED' using errcode='P0001'; end if;
    insert into private.world_room_plants(user_id,planted_at,revision) values(v_user,v_now,1) returning * into v_plant;
  else
    if not found then raise exception 'PLANT_REQUIRED' using errcode='P0001'; end if;
    if v_plant.revision<>p_revision then raise exception 'PLANT_CONFLICT' using errcode='40001'; end if;
    if v_plant.first_cared_at is null then
      update private.world_room_plants set first_cared_at=v_now,revision=2 where user_id=v_user returning * into v_plant;
    elsif v_plant.second_cared_at is null and v_now>=v_plant.first_cared_at+interval '20 hours' then
      update private.world_room_plants set second_cared_at=v_now,revision=3 where user_id=v_user returning * into v_plant;
    else
      raise exception 'PLANT_NOT_READY' using errcode='P0001';
    end if;
  end if;
  v_receipt := jsonb_build_object('status','SUCCESS','userId',v_user,'roomId',p_room,'objectId',p_object,
    'requestId',p_request,'action',p_action,'plantRevision',v_plant.revision,'definitionVersion',v_plant.definition_version);
  insert into private.world_room_plant_receipts(user_id,request_id,room_id,object_id,action,expected_revision,plant_revision,receipt)
    values(v_user,p_request,p_room,p_object,p_action,p_revision,v_plant.revision,v_receipt);
  return v_receipt;
end;
$$;
revoke all on function private.world_room_plant_command_v1(uuid,uuid,integer,uuid,text) from public,anon,authenticated,service_role;
create function public.plant_my_room_plant_v1(p_room uuid,p_object uuid,p_request_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.world_room_plant_command_v1(p_room,p_object,0,p_request_id,'PLANT')
$$;
create function public.care_my_room_plant_v1(p_room uuid,p_object uuid,p_revision integer,p_request_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.world_room_plant_command_v1(p_room,p_object,p_revision,p_request_id,'CARE')
$$;

-- Pure server projection enables exact clock-boundary tests without client-supplied time.
create function private.world_room_plant_growth_v1(p_first timestamptz,p_second timestamptz,p_now timestamptz)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'stage',case when p_second is not null and p_now>=p_second+interval '20 hours' then 'BLOOM'
      when p_second is not null or (p_first is not null and p_now>=p_first+interval '20 hours') then 'BUD' else 'SPROUT' end,
    'nextStageAt',case when p_second is not null and p_now<p_second+interval '20 hours' then p_second+interval '20 hours'
      when p_second is null and p_first is not null and p_now<p_first+interval '20 hours' then p_first+interval '20 hours' else null end,
    'canCare',p_first is null or (p_second is null and p_now>=p_first+interval '20 hours'))
$$;
revoke all on function private.world_room_plant_growth_v1(timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.get_world_room_plants_v1(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1(); v_owner uuid; v_role text;
  v_layout private.world_room_layouts%rowtype; v_plant private.world_room_plants%rowtype;
  v_owned boolean; v_active boolean; v_object uuid; v_stage text; v_next timestamptz; v_care boolean := false;
  v_now timestamptz := statement_timestamp(); v_base jsonb; v_growth jsonb;
begin
  v_role := private.world_room_access_v1(v_user,p_room);
  if v_role not in ('OWNER','VISITOR') then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  select owner_user_id into v_owner from public.world_player_rooms where id=p_room and room_type='DORM_1_BASIC';
  if not found then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  select * into v_layout from private.world_room_layouts where room_id=p_room;
  v_active := private.world_room_plant_enabled_v1() and exists (select 1 from private.world_item_catalog
    where item_id='furniture.indoor_planter' and status='ACTIVE');
  v_base := jsonb_build_object('roomId',p_room,'role',lower(v_role),'layoutRevision',coalesce(v_layout.revision,0),
    'featureStatus',case when v_active then 'ACTIVE' else 'CLOSED' end);
  v_owned := v_active and exists (select 1 from private.world_player_items where user_id=v_owner
    and item_id='furniture.indoor_planter' and quantity=1);
  if v_owned then
    select (o->>'id')::uuid into v_object from jsonb_array_elements(coalesce(v_layout.objects,'[]'::jsonb)) o
      where o->>'itemId'='furniture.indoor_planter' and o->>'surface'='floor' limit 1;
    select * into v_plant from private.world_room_plants where user_id=v_owner and planter_item_id='furniture.indoor_planter';
    if found then
      v_growth := private.world_room_plant_growth_v1(v_plant.first_cared_at,v_plant.second_cared_at,v_now);
      v_stage := v_growth->>'stage'; v_next := (v_growth->>'nextStageAt')::timestamptz;
      v_care := (v_growth->>'canCare')::boolean;
    end if;
  end if;
  if v_role='VISITOR' then
    -- The authorized room's visible silhouette only; never owner inventory/timestamps/receipts/XP.
    return v_base || jsonb_build_object('plants',case when v_object is not null and v_stage is not null then
      jsonb_build_array(jsonb_build_object('objectId',v_object,'plantId',v_plant.plant_id,'stage',v_stage)) else '[]'::jsonb end);
  end if;
  return v_base || jsonb_build_object('serverNow',v_now,'planterOwned',v_owned,'plant',
    case when v_stage is null then null else jsonb_build_object('objectId',v_object,'plantId',v_plant.plant_id,
      'stage',v_stage,'revision',v_plant.revision,'nextStageAt',v_next,'canCare',v_care and v_object is not null) end);
end;
$$;
revoke all on function public.claim_my_room_planter_v1(uuid),public.plant_my_room_plant_v1(uuid,uuid,uuid),
  public.care_my_room_plant_v1(uuid,uuid,integer,uuid),public.get_world_room_plants_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_my_room_planter_v1(uuid),public.plant_my_room_plant_v1(uuid,uuid,uuid),
  public.care_my_room_plant_v1(uuid,uuid,integer,uuid),public.get_world_room_plants_v1(uuid) to authenticated;
