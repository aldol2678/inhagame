import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_CATALOG, PILOT_ITEM_IDS, DEFAULT_ITEM_IDS, VS_ECONOMY_ITEM_IDS, F0_FURNITURE_IDS, LIFE_M1_MATERIAL_IDS, ITEM_ID_PATTERN,
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

const HOUSING_F0_NEW_7 = [
  'furniture.dorm_single_sofa', 'furniture.dorm_side_table_low', 'furniture.dorm_bookshelf_slim',
  'furniture.dorm_plant_medium', 'furniture.dorm_monitor', 'furniture.dorm_trophy_shelf',
  'furniture.study_books_set'
];

test('the committed catalog passes every C0 rule', () => {
  assert.deepEqual(validateCatalog(ITEM_CATALOG), []);
});

test('catalog is the 6 pilot fixtures plus Starter Catalog 20 plus Housing F0 7 plus Life M1 materials', () => {
  const ids = ITEM_CATALOG.map(d => d.itemId);
  assert.deepEqual(ids, [...PILOT_ITEM_IDS, ...STARTER_20, ...HOUSING_F0_NEW_7, ...LIFE_M1_MATERIAL_IDS], 'order and membership are the committed contract');
  assert.equal(new Set(ids).size, 36);
  for (const id of ids) assert.match(id, ITEM_ID_PATTERN);
  assert.ok(ids.every(id => id === id.toLowerCase()), 'no uppercase COSMETIC_* style ids');
  for (const id of VS_ECONOMY_ITEM_IDS) assert.ok(getItemDefinition(id), `vertical slice item ${id} exists`);
  assert.equal(VS_ECONOMY_ITEM_IDS.length, 8);
});

test('Housing F0 exposes exactly sixteen placeable furniture identities without activating acquisition', () => {
  assert.equal(F0_FURNITURE_IDS.length, 16);
  assert.equal(new Set(F0_FURNITURE_IDS).size, 16);
  assert.deepEqual(F0_FURNITURE_IDS.slice(-7), HOUSING_F0_NEW_7);
  for (const id of F0_FURNITURE_IDS) assert.equal(getItemDefinition(id)?.category, 'FURNITURE', id);
  for (const id of HOUSING_F0_NEW_7) {
    const item = getItemDefinition(id);
    assert.equal(item.status, 'COMING_SOON', id);
    assert.ok(item.tags.includes('f0'), id);
    assert.ok(['SHOP','QUEST'].includes(item.acquisition[0].source), id);
  }
  assert.equal(getItemDefinition('furniture.dorm_trophy_shelf').acquisition[0].source, 'QUEST');
});

test('pilot fixtures keep their C0 §1.6 contract', () => {
  const expected = {
    'head.inha_cap': ['WEARABLE', 'HEAD', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'head.inkyung_duck': ['WEARABLE', 'HEAD', 'UNCOMMON', 'COMING_SOON', 'EXPLORATION'],
    'top.inha_basic': ['WEARABLE', 'TOP', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'back.freshman_bag': ['WEARABLE', 'BACK', 'COMMON', 'ACTIVE', 'DEFAULT'],
    'badge.main_gate': ['BADGE', 'BADGE', 'UNCOMMON', 'ACTIVE', 'QUEST'],
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

test('earned starter rewards exposed in inventory/wardrobe are ACTIVE', () => {
  assert.equal(getItemDefinition('badge.main_gate').status, 'ACTIVE');
  assert.equal(getItemDefinition('head.induck_cap').status, 'ACTIVE');
});

test('legacy items stay cosmetic UNIQUE while Life M1 materials are gameplay STACKABLE', () => {
  const materials = ITEM_CATALOG.filter(d => d.category === 'MATERIAL');
  const legacy = ITEM_CATALOG.filter(d => d.category !== 'MATERIAL');

  assert.deepEqual(materials.map(d => d.itemId), [...LIFE_M1_MATERIAL_IDS], 'the three M1 material fixtures are committed');
  for (const d of legacy) {
    assert.equal(d.cosmeticOnly, true, d.itemId);
    assert.equal(d.tradePolicy, 'ACCOUNT_BOUND', d.itemId);
    assert.equal(d.ownershipPolicy, 'UNIQUE', d.itemId);
    assert.equal(d.stackable, false, d.itemId);
    assert.equal(d.maxStack, null, d.itemId);
    assert.ok(!('price' in d) && !('cost' in d), `${d.itemId} carries no price`);
    assert.ok(Object.isFrozen(d), `${d.itemId} is immutable`);
  }
  for (const d of materials) {
    assert.equal(d.cosmeticOnly, false, d.itemId);
    assert.equal(d.tradePolicy, 'ACCOUNT_BOUND', d.itemId);
    assert.equal(d.ownershipPolicy, 'STACKABLE', d.itemId);
    assert.equal(d.stackable, true, d.itemId);
    assert.equal(d.maxStack, 99, d.itemId);
    assert.equal(d.acquisition[0].source, 'ACTIVITY', d.itemId);
    assert.ok(Object.isFrozen(d), `${d.itemId} is immutable`);
  }

  const event = ITEM_CATALOG.filter(d => d.tags.includes('mcm_2026'));
  assert.equal(event.length, 5);
  assert.ok(event.every(d => d.eventId === 'event.mcm_2026' && d.acquisition[0].source === 'EVENT'));
  const furniture = ITEM_CATALOG.filter(d => d.category === 'FURNITURE');
  assert.ok(furniture.every(d => d.subtype && d.equipSlot === null), 'furniture carries a placement subtype, no slot');
  assert.deepEqual(Object.keys(catalogAuthorityRow(getItemDefinition('material.campus_leaf'))).sort(),
    ['category', 'item_id', 'max_stack', 'ownership_policy', 'status'], 'material mirror stays grant-authority only');
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
  assert.deepEqual(validateCatalog([stackable]), [], 'a legacy category can still be structurally STACKABLE');
  const material = getItemDefinition('material.campus_leaf');
  assert.ok(validateCatalog([{ ...material, cosmeticOnly: true }]).some(e => /MATERIAL must set cosmeticOnly/.test(e)));
  assert.ok(validateCatalog([{ ...material, ownershipPolicy: 'UNIQUE', stackable: false, maxStack: null }])
    .some(e => /MATERIAL must use STACKABLE/.test(e)));
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
