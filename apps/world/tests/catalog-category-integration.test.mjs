import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEM_CATEGORIES, ITEM_CATALOG, catalogAuthorityRow } from '../src/collection/item-catalog.js';

const migration = name => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const categoryCheck = sql => {
  const match = /add constraint world_item_catalog_category_check\s+check\s*\(category in\s*\(([\s\S]*?)\)\)/i.exec(sql);
  assert.ok(match, 'the candidate has an explicit category check');
  return [...match[1].matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
};
const cooking = migration('20261010102000_world_cooking_b2_candidate.sql');
const finishes = migration('20261010190000_world_room_finish_catalog_p0.sql');

test('later finish migration preserves every cooking category and matches the client union', () => {
  const before = categoryCheck(cooking);
  const after = categoryCheck(finishes);
  assert.deepEqual(after, [...before, 'ROOM_FINISH']);
  assert.deepEqual(after, [...ITEM_CATEGORIES]);
  for (const row of ITEM_CATALOG.map(catalogAuthorityRow)) {
    assert.ok(after.includes(row.category), `${row.item_id} survives the later category check`);
  }
});

test('finish integration changes the allowed category union without activating cooking or finish items', () => {
  assert.equal(ITEM_CATALOG.length, 42);
  const additions = ITEM_CATALOG.filter(d => d.itemId.startsWith('finish.') ||
    ['furniture.cooking_station', 'consumable.grilled_carp'].includes(d.itemId));
  assert.equal(additions.length, 6);
  assert.ok(additions.every(d => d.status === 'COMING_SOON'));
  assert.doesNotMatch(finishes, /(?:update|delete\s+from)\s+private\.world_(?:item_catalog|player_items|recipe_catalog)/i);
  assert.match(cooking, /'recipe\.carp_grill',1,'COOK','COOKING_STATION','furniture\.cooking_station','COMING_SOON'/);
});
