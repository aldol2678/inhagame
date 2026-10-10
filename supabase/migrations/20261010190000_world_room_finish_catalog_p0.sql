-- Housing Finish P0: register identity and locked shop offers only.
-- Public disposable-stack migration; Production DB application is separately authorized.
-- Do not grant existing users, change rooms, debit wallets, or activate sales in this phase.
-- The already-shipped Wood Floor 051 remains the visual default in existing runtime code.
-- Integration candidate: preserve CONSUMABLE from the earlier Cooking B2 migration.
-- This file is new to the release base; no applied historical migration is rewritten.
alter table private.world_item_catalog
  drop constraint if exists world_item_catalog_category_check;
alter table private.world_item_catalog
  add constraint world_item_catalog_category_check
  check (category in (
    'WEARABLE', 'BADGE', 'EMOTE', 'FURNITURE', 'MOUNT', 'MOUNT_COSMETIC',
    'MEMORABILIA', 'MATERIAL', 'CONSUMABLE', 'ROOM_FINISH'
  ));

insert into private.world_item_catalog(item_id, category, ownership_policy, max_stack, status) values
  ('finish.wall_basic',            'ROOM_FINISH', 'UNIQUE', null, 'COMING_SOON'),
  ('finish.wall_white_plaster_02', 'ROOM_FINISH', 'UNIQUE', null, 'COMING_SOON'),
  ('finish.floor_basic',           'ROOM_FINISH', 'UNIQUE', null, 'COMING_SOON'),
  ('finish.floor_wood_051',        'ROOM_FINISH', 'UNIQUE', null, 'COMING_SOON')
on conflict (item_id) do nothing;

insert into private.world_shops(shop_id, display_name, status, tags) values
  ('shop.room_finishes', '생활관 인테리어 상점', 'ACTIVE', array['housing', 'room_finish'])
on conflict (shop_id) do nothing;

-- LOCKED is server-enforced inside purchase_world_shop_listing_v1.
-- Do not activate these listings before inventory grandfathering + room finish save/read authority.
insert into private.world_shop_listings
  (listing_id, shop_id, "position", item_id, currency_id, price, quantity, required_level, purchase_limit, status)
values
  ('offer.room_finishes.wall_white_plaster_02', 'shop.room_finishes', 0, 'finish.wall_white_plaster_02',
   'currency.induck_coin', 1500, 1, null, 1, 'LOCKED'),
  ('offer.room_finishes.floor_wood_051', 'shop.room_finishes', 1, 'finish.floor_wood_051',
   'currency.induck_coin', 1500, 1, null, 1, 'LOCKED')
on conflict (listing_id) do nothing;

-- Refuse silent pre-existing ID/listing conflicts rather than changing any owned inventory.
do $$
begin
  if (select count(*) from private.world_item_catalog
      where item_id in ('finish.wall_basic','finish.wall_white_plaster_02','finish.floor_basic','finish.floor_wood_051')
        and category='ROOM_FINISH' and ownership_policy='UNIQUE'
        and max_stack is null and status='COMING_SOON') <> 4 then
    raise exception 'ROOM_FINISH_CATALOG_CONFLICT';
  end if;
  if (select count(*) from private.world_shop_listings
      where shop_id='shop.room_finishes' and status='LOCKED'
        and currency_id='currency.induck_coin' and price=1500
        and quantity=1 and purchase_limit=1
        and required_level is null
        and (listing_id, item_id, "position") in (
          ('offer.room_finishes.wall_white_plaster_02','finish.wall_white_plaster_02',0::smallint),
          ('offer.room_finishes.floor_wood_051','finish.floor_wood_051',1::smallint)
        )) <> 2 then
    raise exception 'ROOM_FINISH_LISTING_CONFLICT';
  end if;
end;
$$;
