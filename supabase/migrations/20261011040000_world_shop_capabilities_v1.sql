-- Append-only compatibility API. This migration deliberately changes no catalog,
-- vendor, stock, purchase, wallet or inventory data. Public development replay already
-- includes the earlier split migrations; independent rollout stages are documented in
-- docs/ops/NPC_SHOP_STAGED_ROLLOUT.md and must not replay that lineage in Production.
create function public.get_world_shop_capabilities_v1() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scoped oid := to_regprocedure('public.purchase_world_shop_listing_v2(text,text,text)');
  v_legacy oid := to_regprocedure('public.purchase_world_shop_listing_v1(text,text)');
  v_rpc text;
  v_layout text;
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_inventory_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  -- Check the caller role's grant, not the SECURITY DEFINER owner's privileges.
  if v_scoped is not null and has_function_privilege('authenticated', v_scoped, 'EXECUTE') then
    v_rpc := 'purchase_world_shop_listing_v2';
  elsif v_legacy is not null and has_function_privilege('authenticated', v_legacy, 'EXECUTE') then
    v_rpc := 'purchase_world_shop_listing_v1';
  else
    raise exception 'SHOP_API_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- This is the physical catalog binding, not a claim about UI deployment, proximity,
  -- product availability or vendor identity. All six durable listings must be present.
  -- Inactive/hidden products keep their status; get_world_shop_v1 still decides visibility.
  with expected(listing_id, split_shop_id) as (values
    ('offer.student_center.campus_mug', 'shop.student_center'),
    ('offer.student_center.induck_cap', 'shop.student_center_fashion'),
    ('offer.student_center.campus_sneakers', 'shop.student_center_fashion'),
    ('offer.student_center.induck_hoodie', 'shop.student_center_fashion'),
    ('offer.student_center.induck_backpack', 'shop.student_center_fashion'),
    ('offer.student_center.campus_map_poster', 'shop.dorm_furniture')
  )
  select case
    when count(l.listing_id) <> 6 then 'mixed'
    when bool_and(l.shop_id = 'shop.student_center') then 'legacy'
    when bool_and(l.shop_id = e.split_shop_id) then 'split'
    else 'mixed'
  end into v_layout
  from expected e left join private.world_shop_listings l on l.listing_id = e.listing_id;

  return jsonb_build_object('version', 1, 'purchaseRpc', v_rpc, 'catalogLayout', v_layout);
end;
$$;
revoke all on function public.get_world_shop_capabilities_v1() from public, anon, authenticated, service_role;
grant execute on function public.get_world_shop_capabilities_v1() to authenticated;
comment on function public.get_world_shop_capabilities_v1() is
  'Read-only shop API/catalog capability. Split is usable only with v2; mixed fails closed in clients. No UI-deployment or spatial-authorization claim.';
