-- Add friend care while all deployment gates remain CLOSED. No grants/rewards/prices change.
-- Tokens are optimistic-concurrency capabilities only; every command rechecks H3 authorization.
alter table private.world_room_plants add column care_token uuid not null default gen_random_uuid();
alter table private.world_room_plant_receipts
  add column owner_user_id uuid references auth.users(id) on delete cascade,
  add column request_care_token uuid,
  add column request_visit_session uuid,
  add column request_visit_lease uuid;
-- Historical owner-only rows have a NULL owner_user_id and retain exactly their original proof.
alter table private.world_room_plant_receipts drop constraint world_room_plant_receipts_user_id_plant_revision_key;
create unique index world_room_plant_receipts_owner_revision_key
  on private.world_room_plant_receipts ((coalesce(owner_user_id,user_id)),plant_revision);
create or replace function private.world_room_plant_receipt_append_only_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' and (not exists (select 1 from auth.users where id=old.user_id)
    or not exists (select 1 from auth.users where id=coalesce(old.owner_user_id,old.user_id))) then return old; end if;
  raise exception 'PLANT_RECEIPT_APPEND_ONLY' using errcode='42501';
end;
$$;

-- #353 owns this helper and its 30s session lease. A standalone plant candidate fails closed.
create function private.world_room_plant_visit_ok_v1(p_user uuid,p_room uuid,p_session uuid,p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if p_session is null or p_lease is null or to_regprocedure('private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)') is null then return false; end if;
  execute 'select private.world_room_chat_plant_lease_v1($1,$2,$3,$4)' into v_ok using p_user,p_room,p_session,p_lease;
  return coalesce(v_ok,false);
end;
$$;
revoke all on function private.world_room_plant_visit_ok_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.world_room_plant_command_v2(p_room uuid,p_object uuid,p_revision integer,p_request uuid,p_action text,p_care_token uuid,p_visit_session uuid,p_visit_lease uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := private.world_room_caller_v1(); v_owner uuid; v_role text;
  v_visitor boolean := p_care_token is not null;
  v_previous private.world_room_plant_receipts%rowtype;
  v_layout private.world_room_layouts%rowtype; v_plant private.world_room_plants%rowtype;
  v_now timestamptz; v_receipt jsonb; v_expected integer;
begin
  if not private.world_inventory_account_ok_v1(v_user) then raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  if p_room is null or p_object is null or p_request is null or p_action is null or p_action not in ('PLANT','CARE')
    or (v_visitor and (p_action<>'CARE' or p_revision is not null or p_visit_session is null or p_visit_lease is null))
    or (not v_visitor and (p_revision is null or p_revision not between 0 and 3 or (p_action='PLANT' and p_revision<>0))) then
    raise exception 'INVALID_PLANT_REQUEST' using errcode='22023';
  end if;
  select owner_user_id into v_owner from public.world_player_rooms where id=p_room and room_type='DORM_1_BASIC';
  if not found then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  -- Lock the asset owner, not the visiting actor. Owner/visitor care and Housing recall serialize.
  perform pg_advisory_xact_lock(hashtextextended('world_inventory:' || v_owner::text,0));
  perform 1 from public.world_player_rooms where id=p_room and owner_user_id=v_owner and room_type='DORM_1_BASIC' for update;
  if not found then raise exception 'PLANT_ACCESS_DENIED' using errcode='42501'; end if;
  v_role := private.world_room_access_v1(v_user,p_room);
  if (v_visitor and v_role is distinct from 'VISITOR') or (not v_visitor and (v_user<>v_owner or v_role is distinct from 'OWNER')) then
    raise exception 'PLANT_ACCESS_DENIED' using errcode='42501';
  end if;
  select * into v_previous from private.world_room_plant_receipts where user_id=v_user and request_id=p_request;
  if found then
    if (v_previous.room_id,v_previous.object_id,v_previous.action,coalesce(v_previous.owner_user_id,v_previous.user_id),v_previous.request_care_token,v_previous.request_visit_session,v_previous.request_visit_lease)
      is distinct from (p_room,p_object,p_action,v_owner,p_care_token,p_visit_session,p_visit_lease)
      or (not v_visitor and v_previous.expected_revision<>p_revision) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    -- Owner's old proof never restores ownership/placement; all callers need fresh readback.
    if not v_visitor then return v_previous.receipt; end if;
  end if;
  if not private.world_room_plant_enabled_v1() then raise exception 'PLANT_UNAVAILABLE' using errcode='P0001'; end if;
  select * into v_layout from private.world_room_layouts where room_id=p_room for update;
  if not found or not exists (select 1 from jsonb_array_elements(v_layout.objects) o where o->>'id'=p_object::text
    and o->>'itemId'='furniture.indoor_planter' and o->>'surface'='floor') then
    raise exception 'PLANTER_REQUIRED' using errcode='42501';
  end if;
  perform 1 from private.world_player_items i join private.world_item_catalog c on c.item_id=i.item_id
    where i.user_id=v_owner and i.item_id='furniture.indoor_planter' and i.quantity=1
      and c.status='ACTIVE' and c.category='FURNITURE' and c.ownership_policy='UNIQUE' for share of i,c;
  if not found then raise exception 'PLANTER_REQUIRED' using errcode='42501'; end if;
  -- Even an exact visitor retry requires present admission, saved placement and current ownership.
  select * into v_plant from private.world_room_plants where user_id=v_owner and planter_item_id='furniture.indoor_planter' for update;
  -- Every blocking asset lock has completed. Lease helper locks its row, then rechecks
  -- current server time, same actor/room/session, chat health/gate and current H3 authority.
  if v_visitor and not private.world_room_plant_visit_ok_v1(v_user,p_room,p_visit_session,p_visit_lease) then
    raise exception 'PLANT_ACCESS_DENIED' using errcode='42501';
  end if;
  if not private.world_inventory_account_ok_v1(v_user) or not private.world_inventory_account_ok_v1(v_owner) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  if not private.world_room_plant_enabled_v1() then raise exception 'PLANT_UNAVAILABLE' using errcode='P0001'; end if;
  if v_previous.request_id is not null then return v_previous.receipt; end if;
  v_now := clock_timestamp();
  if p_action='PLANT' then
    if v_plant.user_id is not null then raise exception 'PLANT_ALREADY_PLANTED' using errcode='P0001'; end if;
    v_expected := 0;
    insert into private.world_room_plants(user_id,planted_at,revision) values(v_owner,v_now,1) returning * into v_plant;
  else
    if v_plant.user_id is null then raise exception 'PLANT_REQUIRED' using errcode='P0001'; end if;
    if (v_visitor and v_plant.care_token<>p_care_token) or (not v_visitor and v_plant.revision<>p_revision) then
      raise exception 'PLANT_CONFLICT' using errcode='40001';
    end if;
    v_expected := v_plant.revision;
    if v_plant.first_cared_at is null then
      update private.world_room_plants set first_cared_at=v_now,revision=2,care_token=gen_random_uuid()
        where user_id=v_owner returning * into v_plant;
    elsif v_plant.second_cared_at is null and v_now>=v_plant.first_cared_at+interval '20 hours' then
      update private.world_room_plants set second_cared_at=v_now,revision=3,care_token=gen_random_uuid()
        where user_id=v_owner returning * into v_plant;
    else raise exception 'PLANT_NOT_READY' using errcode='P0001'; end if;
  end if;
  v_receipt := jsonb_build_object('status','SUCCESS','userId',v_user,'roomId',p_room,'objectId',p_object,
    'requestId',p_request,'action',p_action,'definitionVersion',v_plant.definition_version)
    || case when v_visitor then '{}'::jsonb else jsonb_build_object('plantRevision',v_plant.revision) end;
  insert into private.world_room_plant_receipts(user_id,owner_user_id,request_id,room_id,object_id,action,expected_revision,request_care_token,request_visit_session,request_visit_lease,plant_revision,receipt)
    values(v_user,v_owner,p_request,p_room,p_object,p_action,v_expected,p_care_token,p_visit_session,p_visit_lease,v_plant.revision,v_receipt);
  return v_receipt;
end;
$$;
revoke all on function private.world_room_plant_command_v2(uuid,uuid,integer,uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function private.world_room_plant_command_v1(p_room uuid,p_object uuid,p_revision integer,p_request uuid,p_action text)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.world_room_plant_command_v2(p_room,p_object,p_revision,p_request,p_action,null,null,null)
$$;
create function public.care_visited_room_plant_v1(p_room uuid,p_object uuid,p_care_token uuid,p_request_id uuid,p_visit_session uuid default null,p_visit_lease uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_care_token is null then raise exception 'INVALID_PLANT_REQUEST' using errcode='22023'; end if;
  return private.world_room_plant_command_v2(p_room,p_object,null,p_request_id,'CARE',p_care_token,p_visit_session,p_visit_lease);
end;
$$;
revoke all on function public.care_visited_room_plant_v1(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.care_visited_room_plant_v1(uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.get_world_room_plants_v1(p_room uuid) returns jsonb
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
    -- Only appearance and an opaque ready-care token. No owner revision, clock, inventory or receipts.
    return v_base || jsonb_build_object('plants',case when v_object is not null and v_stage is not null then
      jsonb_build_array(jsonb_build_object('objectId',v_object,'plantId',v_plant.plant_id,'stage',v_stage,
        'canCare',v_care,'careToken',case when v_care then v_plant.care_token else null end)) else '[]'::jsonb end);
  end if;
  return v_base || jsonb_build_object('serverNow',v_now,'planterOwned',v_owned,'plant',
    case when v_stage is null then null else jsonb_build_object('objectId',v_object,'plantId',v_plant.plant_id,
      'stage',v_stage,'revision',v_plant.revision,'nextStageAt',v_next,'canCare',v_care and v_object is not null) end);
end;
$$;
