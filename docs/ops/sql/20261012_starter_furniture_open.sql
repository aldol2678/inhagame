-- Narrow, separately reviewed Production data operation. NOT a Public migration-chain replay.
-- The operator must verify the deployed PR #354 code/CI first and target GAMES explicitly.
-- Insert exactly two new offers. Existing rows, item definitions and player value are untouched.
-- A second execution is rejected; inspect an uncertain outcome instead of retrying blindly.
do $$
declare
  v_before jsonb;
  v_shops jsonb;
  v_position integer;
  v_inserted integer;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);
  lock table private.world_shop_listings in share row exclusive mode;
  if not exists (select 1 from private.world_shops where shop_id='shop.dorm_furniture' and status='ACTIVE')
    or to_regprocedure('public.get_world_shop_v1(text)') is null
    or to_regprocedure('public.purchase_world_shop_listing_v1(text,text)') is null then
    raise exception 'STARTER_SHOP_PREREQUISITE';
  end if;
  if (select count(*) from private.world_item_catalog where item_id in
      ('furniture.study_books_set','furniture.dorm_single_sofa')
      and category='FURNITURE' and ownership_policy='UNIQUE' and max_stack is null and status='COMING_SOON')<>2 then
    raise exception 'STARTER_CATALOG_PREREQUISITE';
  end if;
  if (select count(*) from private.world_room_furniture_v1() where
      (item_id='furniture.study_books_set' and width=.38 and height=.18 and depth=.22 and surfaces=array['desk'])
      or (item_id='furniture.dorm_single_sofa' and width=1.1 and height=.72 and depth=.78 and surfaces=array['floor']))<>2 then
    raise exception 'STARTER_PLACEMENT_PREREQUISITE';
  end if;
  if exists(select 1 from private.world_shop_listings where item_id in
      ('furniture.study_books_set','furniture.dorm_single_sofa') or listing_id in
      ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa')) then
    raise exception 'STARTER_LISTING_ALREADY_EXISTS_INSPECT_FIRST';
  end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by listing_id),'[]'::jsonb) into v_before from private.world_shop_listings l;
  select coalesce(jsonb_agg(to_jsonb(s) order by shop_id),'[]'::jsonb) into v_shops from private.world_shops s;
  select coalesce(max(position),-1) into v_position from private.world_shop_listings where shop_id='shop.dorm_furniture';
  insert into private.world_shop_listings
    (listing_id,shop_id,position,item_id,currency_id,price,quantity,required_level,purchase_limit,start_at,end_at,status)
  values
    ('offer.dorm_furniture.study_books_set','shop.dorm_furniture',v_position+1,'furniture.study_books_set','currency.induck_coin',120,1,1,null,null,null,'ACTIVE'),
    ('offer.dorm_furniture.dorm_single_sofa','shop.dorm_furniture',v_position+2,'furniture.dorm_single_sofa','currency.induck_coin',480,1,1,null,null,null,'ACTIVE');
  get diagnostics v_inserted = row_count;
  if v_inserted<>2 then raise exception 'STARTER_INSERT_COUNT'; end if;
  if v_before is distinct from (select coalesce(jsonb_agg(to_jsonb(l) order by listing_id),'[]'::jsonb)
      from private.world_shop_listings l where listing_id not in
      ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa'))
    or v_shops is distinct from (select coalesce(jsonb_agg(to_jsonb(s) order by shop_id),'[]'::jsonb) from private.world_shops s) then
    raise exception 'STARTER_UNRELATED_STOCK_CHANGED';
  end if;
end;
$$;
