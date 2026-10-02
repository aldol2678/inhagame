-- Public forward migration: ported from the private Housing D3 migration (Production lineage version
-- 20261002110639). Versions are not shared across the two lineages.
-- Housing D3/H2: Collection-owned furniture, atomic room snapshots and revision conflict protection.
-- Base DORM_1_BASIC fixtures stay template-owned. Placement never grants/consumes inventory items.
create table private.world_room_layouts (
  room_id uuid primary key references public.world_player_rooms(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  objects jsonb not null default '[]'::jsonb check (jsonb_typeof(objects) = 'array' and jsonb_array_length(objects) <= 32),
  updated_at timestamptz not null default now()
);
alter table private.world_room_layouts enable row level security;
revoke all on private.world_room_layouts from public, anon, authenticated;
grant select, insert, update, delete on private.world_room_layouts to service_role;

-- Match apps/world/src/rooms/furniture-layout.js. These are existing Collection IDs, not new grants.
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
    ('furniture.mcm_2026_poster', 1, .75, .04, array['north','east','south','west'], false, false)
  ) as furniture(item_id, width, height, depth, surfaces, solid, flat);
$$;
revoke all on function private.world_room_furniture_v1() from public, anon, authenticated;

create or replace function private.validate_world_room_furniture_v1(p_user uuid, p_objects jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_object jsonb; v_def record; v_fixed record; v_prior jsonb;
  v_seen text[] := array[]::text[]; v_boxes jsonb := '[]'::jsonb;
  v_x float8; v_z float8; v_yaw float8; v_hw float8; v_hd float8;
  v_x1 float8; v_x2 float8; v_z1 float8; v_z2 float8;
  v_surface text; v_id text; v_count integer; v_owned integer;
  v_epsilon constant float8 := .0000001;
begin
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'INVALID_LAYOUT' using errcode = '22023';
  end if;
  if jsonb_array_length(p_objects) > 32 or octet_length(p_objects::text) > 16384 then
    raise exception 'INVALID_LAYOUT' using errcode = '22023';
  end if;
  for v_object in select value from jsonb_array_elements(p_objects) loop
    if jsonb_typeof(v_object) <> 'object' then raise exception 'INVALID_LAYOUT' using errcode = '22023'; end if;
    if (select count(*) from jsonb_object_keys(v_object)) <> 6 or not v_object ?& array['id','itemId','surface','x','z','yaw'] or
      jsonb_typeof(v_object->'id') <> 'string' or jsonb_typeof(v_object->'itemId') <> 'string' or jsonb_typeof(v_object->'surface') <> 'string' or
      jsonb_typeof(v_object->'x') <> 'number' or jsonb_typeof(v_object->'z') <> 'number' or jsonb_typeof(v_object->'yaw') <> 'number' then
      raise exception 'INVALID_LAYOUT' using errcode = '22023';
    end if;
    v_id := v_object->>'id'; v_surface := v_object->>'surface';
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_id = any(v_seen) then
      raise exception 'INVALID_LAYOUT' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_id);
    select * into v_def from private.world_room_furniture_v1() where item_id = v_object->>'itemId';
    if not found or not v_surface = any(v_def.surfaces) then raise exception 'INVALID_LAYOUT' using errcode = '22023'; end if;
    -- Reject enormous JSON numbers before casting to float8. Coordinates are small room-local values.
    if abs((v_object->>'x')::numeric) > 16 or abs((v_object->>'z')::numeric) > 16 or
      (v_object->>'yaw')::numeric < 0 or (v_object->>'yaw')::numeric >= 360 or mod((v_object->>'yaw')::numeric,45) <> 0 then
      raise exception 'INVALID_LAYOUT' using errcode = '22023';
    end if;
    v_x := (v_object->>'x')::float8; v_z := (v_object->>'z')::float8; v_yaw := (v_object->>'yaw')::float8;
    if (v_surface in ('floor','desk','bed') and (mod((v_object->>'x')::numeric,.25) <> 0 or mod((v_object->>'z')::numeric,.25) <> 0)) or
      (v_surface = 'north' and (abs(v_z-4.15) > v_epsilon or v_yaw <> 0 or mod((v_object->>'x')::numeric,.25) <> 0)) or
      (v_surface = 'south' and (abs(v_z+4.15) > v_epsilon or v_yaw <> 180 or mod((v_object->>'x')::numeric,.25) <> 0)) or
      (v_surface = 'east' and (abs(v_x-5.35) > v_epsilon or v_yaw <> 90 or mod((v_object->>'z')::numeric,.25) <> 0)) or
      (v_surface = 'west' and (abs(v_x+5.35) > v_epsilon or v_yaw <> 270 or mod((v_object->>'z')::numeric,.25) <> 0)) then
      raise exception 'INVALID_LAYOUT' using errcode = '22023';
    end if;
    select count(*) into v_count from jsonb_array_elements(p_objects) o where o->>'itemId' = v_def.item_id;
    select i.quantity into v_owned from private.world_player_items i join private.world_item_catalog c on c.item_id = i.item_id
      where i.user_id = p_user and i.item_id = v_def.item_id and c.category = 'FURNITURE';
    if v_count > coalesce(v_owned,0) then raise exception 'ITEM_NOT_OWNED' using errcode = '42501'; end if;
    v_hw := (abs(cos(radians(v_yaw))) * v_def.width + abs(sin(radians(v_yaw))) * v_def.depth)/2;
    v_hd := (abs(sin(radians(v_yaw))) * v_def.width + abs(cos(radians(v_yaw))) * v_def.depth)/2;
    v_x1 := v_x-v_hw; v_x2 := v_x+v_hw; v_z1 := v_z-v_hd; v_z2 := v_z+v_hd;
    if v_surface = 'floor' then
      if v_x1 < -5.3-v_epsilon or v_x2 > 5.3+v_epsilon or v_z1 < -4.1-v_epsilon or v_z2 > 4.1+v_epsilon then
        raise exception 'ROOM_BOUNDS' using errcode = '22023';
      end if;
      if v_x1 < .9-v_epsilon and v_x2 > -.9+v_epsilon and v_z1 < -2.25-v_epsilon and v_z2 > -4.2+v_epsilon then
        raise exception 'EXIT_BLOCKED' using errcode = '22023';
      end if;
      for v_fixed in select * from (values
        (-4.6::float8,-3.0::float8,.55::float8,3.25::float8,false), -- bed
        (2.0,3.9,1.325,2.075,false), -- desk
        (2.675,3.225,.575,1.125,false), -- fixed chair
        (4.35,4.95,1.4,2.9,false), -- bookshelf
        (4.275,4.725,-3.125,-2.675,false), -- plant
        (-1.4,1.4,-.4,1.7,true) -- base rug: only another rug conflicts
      ) as fixture(x1,x2,z1,z2,flat) loop
        if (not v_fixed.flat or v_def.flat) and v_x1 < v_fixed.x2-v_epsilon and v_x2 > v_fixed.x1+v_epsilon and
          v_z1 < v_fixed.z2-v_epsilon and v_z2 > v_fixed.z1+v_epsilon then
          raise exception 'FURNITURE_OVERLAP' using errcode = '22023';
        end if;
      end loop;
    elsif v_surface = 'desk' then
      if v_x1 < 2.05-v_epsilon or v_x2 > 3.85+v_epsilon or v_z1 < 1.375-v_epsilon or v_z2 > 2.025+v_epsilon then
        raise exception 'ROOM_BOUNDS' using errcode = '22023';
      end if;
      if v_x1 < 3.51-v_epsilon and v_x2 > 3.09+v_epsilon and v_z1 < 1.84-v_epsilon and v_z2 > 1.56+v_epsilon then
        raise exception 'FURNITURE_OVERLAP' using errcode = '22023';
      end if;
    elsif v_surface = 'bed' then
      if v_x1 < -4.55-v_epsilon or v_x2 > -3.05+v_epsilon or v_z1 < .6-v_epsilon or v_z2 > 3.2+v_epsilon then
        raise exception 'ROOM_BOUNDS' using errcode = '22023';
      end if;
      if v_x1 < -3.304-v_epsilon and v_x2 > -4.296+v_epsilon and v_z1 < 3.11-v_epsilon and v_z2 > 2.63+v_epsilon then
        raise exception 'FURNITURE_OVERLAP' using errcode = '22023';
      end if;
    else
      if (v_surface in ('north','south') and abs(v_x)+v_def.width/2 > 5.3+v_epsilon) or
        (v_surface in ('east','west') and abs(v_z)+v_def.width/2 > 4.1+v_epsilon) then
        raise exception 'ROOM_BOUNDS' using errcode = '22023';
      end if;
      if v_surface = 'north' and v_x-v_def.width/2 < 1.8 and v_x+v_def.width/2 > -.8 then
        raise exception 'FURNITURE_OVERLAP' using errcode = '22023';
      end if;
      if v_surface = 'south' and abs(v_x) < .68+v_def.width/2 then raise exception 'EXIT_BLOCKED' using errcode = '22023'; end if;
    end if;
    for v_prior in select value from jsonb_array_elements(v_boxes) loop
      if v_prior->>'surface' <> v_surface or (v_surface = 'floor' and (v_prior->>'flat')::boolean <> v_def.flat) then continue; end if;
      if v_x1 < (v_prior->>'x2')::float8-v_epsilon and v_x2 > (v_prior->>'x1')::float8+v_epsilon and
        v_z1 < (v_prior->>'z2')::float8-v_epsilon and v_z2 > (v_prior->>'z1')::float8+v_epsilon then
        raise exception 'FURNITURE_OVERLAP' using errcode = '22023';
      end if;
    end loop;
    v_boxes := v_boxes || jsonb_build_array(jsonb_build_object('surface',v_surface,'flat',v_def.flat,'x1',v_x1,'x2',v_x2,'z1',v_z1,'z2',v_z2));
  end loop;
end;
$$;
revoke all on function private.validate_world_room_furniture_v1(uuid,jsonb) from public, anon, authenticated;

create or replace function public.get_world_room_furniture_v1(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := private.world_room_caller_v1();
  v_role text; v_layout private.world_room_layouts%rowtype;
begin
  v_role := private.world_room_access_v1(v_user,p_room);
  if v_role not in ('OWNER','VISITOR') then raise exception 'LAYOUT_DENIED' using errcode = '42501'; end if;
  select * into v_layout from private.world_room_layouts where room_id = p_room;
  return jsonb_build_object('roomId',p_room,'role',lower(v_role),'revision',coalesce(v_layout.revision,0),'objects',coalesce(v_layout.objects,'[]'::jsonb));
end;
$$;

create or replace function public.save_my_room_furniture_v1(p_room uuid, p_revision integer, p_objects jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := private.world_room_caller_v1();
  v_layout private.world_room_layouts%rowtype; v_objects jsonb;
begin
  if private.world_room_access_v1(v_user,p_room) <> 'OWNER' then raise exception 'LAYOUT_DENIED' using errcode = '42501'; end if;
  -- Serialize saves on the existing authority row, including a first empty layout, across tabs.
  perform 1 from public.world_player_rooms where id = p_room and owner_user_id = v_user for update;
  if not found then raise exception 'LAYOUT_DENIED' using errcode = '42501'; end if;
  if p_revision is null or p_revision < 0 then raise exception 'INVALID_LAYOUT' using errcode = '22023'; end if;
  perform private.validate_world_room_furniture_v1(v_user,p_objects);
  select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into v_objects from jsonb_array_elements(p_objects);
  insert into private.world_room_layouts(room_id) values(p_room) on conflict (room_id) do nothing;
  select * into strict v_layout from private.world_room_layouts where room_id = p_room for update;
  -- A lost response can retry the identical snapshot without another revision. No last-write-wins.
  if v_layout.objects <> v_objects then
    if v_layout.revision <> p_revision then raise exception 'LAYOUT_CONFLICT' using errcode = '40001'; end if;
    if v_layout.revision = 2147483647 then raise exception 'LAYOUT_CONFLICT' using errcode = '40001'; end if;
    update private.world_room_layouts set objects = v_objects, revision = revision+1, updated_at = now() where room_id = p_room returning * into v_layout;
  end if;
  return jsonb_build_object('roomId',p_room,'role','owner','revision',v_layout.revision,'objects',v_layout.objects);
end;
$$;
revoke all on function public.get_world_room_furniture_v1(uuid), public.save_my_room_furniture_v1(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.get_world_room_furniture_v1(uuid), public.save_my_room_furniture_v1(uuid,integer,jsonb) to authenticated;
