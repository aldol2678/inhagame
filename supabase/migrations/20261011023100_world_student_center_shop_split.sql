-- Local candidate only. Rollout requires the fashion route and reachable NPC binding
-- alongside the shop split. The approved existing shop workers map in client routing:
-- INKYUNG-NPC-003 (나수현) -> vendor.student_center_souvenir -> shop.student_center
-- INKYUNG-NPC-012 (가지안) -> vendor.student_center_fashion -> shop.student_center_fashion
-- This is routing metadata, not server-enforced NPC proximity authorization.
-- Copy availability from the existing shop rather than promoting inactive stock.
insert into private.world_shops(shop_id, display_name, status, vendor_id)
select 'shop.student_center_fashion', '패션 상점', status, 'vendor.student_center_fashion'
from private.world_shops where shop_id = 'shop.student_center';

-- Listing IDs are durable identities even though their historical prefix names the old
-- shop. Preserve prices, requirements, availability, limits, positions and all history.
update private.world_shop_listings
set shop_id = 'shop.student_center_fashion'
where shop_id = 'shop.student_center'
  and listing_id in (
    'offer.student_center.induck_cap',
    'offer.student_center.campus_sneakers',
    'offer.student_center.induck_hoodie',
    'offer.student_center.induck_backpack'
  );
update private.world_shops
set display_name = '학생회관 기념품점', vendor_id = 'vendor.student_center_souvenir'
where shop_id = 'shop.student_center';
