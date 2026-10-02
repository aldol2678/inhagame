import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_CATALOG, PILOT_ITEM_IDS, DEFAULT_ITEM_IDS, VS_ECONOMY_ITEM_IDS, ITEM_ID_PATTERN,
  getItemDefinition, validateCatalog, describeOwnedItem, catalogAuthorityRow
} from '../src/collection/item-catalog.js';

const STARTER_20 = [
  'top.induck_hoodie', 'head.induck_cap', 'back.induck_backpack', 'shoes.campus_sneakers', 'top.mcm_jacket',
  'memorabilia.campus_mug', 'furniture.campus_map_poster', 'furniture.induck_cushion', 'furniture.dorm_desk_lamp',
  'furniture.induck_chair', 'furniture.mini_induck', 'furniture.campus_rug_blue',
  'badge.campus_first_step', 'badge.campus_explorer', 'furniture.dorm_resident_plate',
  'badge.mcm_2026_landlord', 'memorabilia.mcm_2026_wristband', 'top.mcm_2026_survivor',
  'furniture.mcm_2026_landlord_figure', 'furniture.mcm_2026_poster'
];

test('the committed catalog passes every C0 rule', () => {
  assert.deepEqual(validateCatalog(ITEM_CATALOG), []);
});

test('catalog is the 6 pilot fixtures plus the Starter Catalog 20, with stable lowercase ids', () => {
  const ids = ITEM_CATALOG.map(d => d.itemId);
  assert.deepEqual(ids, [...PILOT_ITEM_IDS, ...STARTER_20], 'order and membership are the committed contract');
  assert.equal(new Set(ids).size, 26);
  for (const id of ids) assert.match(id, ITEM_ID_PATTERN);
  assert.ok(ids.every(id => id === id.toLowerCase()), 'no uppercase COSMETIC_* style ids');
  for (const id of VS_ECONOMY_ITEM_IDS) assert.ok(getItemDefinition(id), `vertical slice item ${id} exists`);
  assert.equal(VS_ECONOMY_ITEM_IDS.length, 8);
});

test('pilot fixtures keep their C0 §1.6 contract', () => {
  const expected = {
    'head.inha_cap': ['WEARABLE', 'HEAD', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'head.inkyung_duck': ['WEARABLE', 'HEAD', 'UNCOMMON', 'COMING_SOON', 'EXPLORATION'],
    'top.inha_basic': ['WEARABLE', 'TOP', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'back.freshman_bag': ['WEARABLE', 'BACK', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'badge.main_gate': ['BADGE', 'BADGE', 'UNCOMMON', 'COMING_SOON', 'QUEST'],
    'emote.wave_plus': ['EMOTE', null, 'UNCOMMON', 'COMING_SOON', 'QUEST']
  };
  for (const [id, [category, slot, rarity, status, source]] of Object.entries(expected)) {
    const d = getItemDefinition(id);
    assert.deepEqual([d.category, d.equipSlot, d.rarity, d.status, d.acquisition[0].source],
      [category, slot, rarity, status, source], id);
  }
  assert.equal(getItemDefinition('badge.main_gate').acquisition[0].ref, 'quest.first_campus');
  assert.deepEqual(DEFAULT_ITEM_IDS, ['head.inha_cap', 'top.inha_basic', 'back.freshman_bag']);
});

test('every item is cosmetic, account bound, unique and price-free in P0-B', () => {
  for (const d of ITEM_CATALOG) {
    assert.equal(d.cosmeticOnly, true, d.itemId);
    assert.equal(d.tradePolicy, 'ACCOUNT_BOUND', d.itemId);
    assert.equal(d.ownershipPolicy, 'UNIQUE', d.itemId);
    assert.equal(d.stackable, false, d.itemId);
    assert.ok(!('price' in d) && !('cost' in d), `${d.itemId} carries no price`);
    assert.ok(Object.isFrozen(d), `${d.itemId} is immutable`);
  }
  const event = ITEM_CATALOG.filter(d => d.tags.includes('mcm_2026'));
  assert.equal(event.length, 5);
  assert.ok(event.every(d => d.eventId === 'event.mcm_2026' && d.acquisition[0].source === 'EVENT'));
  const furniture = ITEM_CATALOG.filter(d => d.category === 'FURNITURE');
  assert.ok(furniture.every(d => d.subtype && d.equipSlot === null), 'furniture carries a placement subtype, no slot');
  assert.deepEqual(Object.keys(catalogAuthorityRow(getItemDefinition('furniture.induck_cushion'))).sort(),
    ['category', 'item_id', 'max_stack', 'ownership_policy', 'status'], 'no position/rotation in the catalog');
});

test('invalid fixtures fail validation', () => {
  const base = getItemDefinition('head.induck_cap');
  const cases = [
    [[base, base], /duplicate itemId/],
    [[{ ...base, itemId: 'COSMETIC_INDUCK_CAP' }], /lowercase/],
    [[{ ...base, category: 'WEAPON' }], /unknown category/],
    [[{ ...base, equipSlot: null }], /WEARABLE needs an appearance equipSlot/],
    [[{ ...base, equipSlot: 'TOP' }], /does not match prefix/],
    [[{ ...base, itemId: 'badge.bad', category: 'BADGE', equipSlot: 'HEAD' }], /BADGE profile slot/],
    [[{ ...getItemDefinition('furniture.induck_cushion'), subtype: 'CEILING' }], /subtype/],
    [[{ ...base, cosmeticOnly: false }], /cosmeticOnly/],
    [[{ ...base, ownershipPolicy: 'UNIQUE', maxStack: 5 }], /UNIQUE items/],
    [[{ ...base, ownershipPolicy: 'STACKABLE' }], /STACKABLE items need/],
    [[{ ...base, tradePolicy: 'TRADEABLE' }], /tradePolicy/],
    [[{ ...base, price: 320 }], /prices belong to Shop/],
    [[{ ...base, status: 'RETIRED' }], /unknown status/],
    [[{ ...base, acquisition: [{ source: 'GACHA' }] }], /acquisition/],
    [[{ ...base, itemId: 'emote.x', category: 'EMOTE', equipSlot: null }], null]
  ];
  for (const [items, pattern] of cases) {
    const errors = validateCatalog(items);
    if (pattern) assert.ok(errors.some(e => pattern.test(e)), `${pattern} in ${JSON.stringify(errors)}`);
    else assert.deepEqual(errors, []);
  }
  const stackable = { ...getItemDefinition('memorabilia.campus_mug'), itemId: 'memorabilia.ticket',
    ownershipPolicy: 'STACKABLE', stackable: true, maxStack: 99 };
  assert.deepEqual(validateCatalog([stackable]), [], 'the STACKABLE shape is structurally valid');
});

test('an owned item missing from the catalog is kept as an UNKNOWN_ITEM placeholder', () => {
  const owned = [
    { itemId: 'head.induck_cap', quantity: 1, sourceType: 'SHOP' },
    { itemId: 'head.retired_hat', quantity: 1, sourceType: 'EVENT' }
  ].map(describeOwnedItem);
  assert.equal(owned.length, 2, 'nothing is filtered out');
  assert.equal(owned[0].known, true);
  assert.equal(owned[0].displayName, '인덕 캠퍼스 캡');
  assert.deepEqual([owned[1].known, owned[1].catalogStatus, owned[1].itemId, owned[1].quantity],
    [false, 'UNKNOWN_ITEM', 'head.retired_hat', 1]);
});
