-- INHA WORLD · activate already-live collection items shown in Inventory / Wardrobe.
-- The code catalog is the presentation canon and private.world_item_catalog is its server mirror.
-- Both items are already obtainable in live flows, so COMING_SOON is stale state rather than a gate.
update private.world_item_catalog
set status = 'ACTIVE'
where item_id in ('badge.main_gate', 'head.induck_cap')
  and status <> 'ACTIVE';
