import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GATHERING_SOURCE_REGISTRY,
  GATHERING_SOURCE_STATUS,
  createGatheringSourceDefinition,
  createGatheringSourceRegistry,
  gatheringSourceAuthorityRow
} from '../src/activity/gathering-source-registry.js';

test('Gathering P0 publishes one closed semantic leaf source', () => {
  assert.equal(GATHERING_SOURCE_REGISTRY.size, 1);
  const source = GATHERING_SOURCE_REGISTRY.get('gathering.campus.leaf_pile_01');
  assert.deepEqual(source, {
    sourceRef: 'gathering.campus.leaf_pile_01',
    displayName: '캠퍼스 낙엽 더미',
    activityId: 'activity.gathering.campus',
    itemId: 'material.campus_leaf',
    collectionEntryId: 'collection.plant.campus_leaf',
    skillId: 'life.gathering',
    quantity: 1,
    status: GATHERING_SOURCE_STATUS.COMING_SOON,
    definitionVersion: 1,
    tags: ['life', 'gathering', 'campus', 'leaf']
  });
  assert.ok(Object.isFrozen(source));
  assert.ok(Object.isFrozen(source.tags));
  assert.deepEqual(gatheringSourceAuthorityRow(source), {
    source_ref: 'gathering.campus.leaf_pile_01',
    activity_id: 'activity.gathering.campus',
    item_id: 'material.campus_leaf',
    collection_entry_id: 'collection.plant.campus_leaf',
    skill_id: 'life.gathering',
    quantity: 1,
    status: 'COMING_SOON',
    definition_version: 1
  });
});

test('Gathering source definitions reject authority drift and malformed sources', () => {
  const base = {
    sourceRef: 'gathering.campus.leaf_pile_02',
    displayName: '검증용 낙엽 더미',
    activityId: 'activity.gathering.campus',
    itemId: 'material.campus_leaf',
    collectionEntryId: 'collection.plant.campus_leaf',
    skillId: 'life.gathering',
    quantity: 1,
    status: 'COMING_SOON',
    definitionVersion: 1,
    tags: ['life', 'gathering']
  };
  assert.ok(createGatheringSourceDefinition(base));
  for (const overrides of [
    { sourceRef: 'remote' },
    { activityId: 'activity.fishing.inkyung' },
    { itemId: 'material.fish_carp' },
    { collectionEntryId: 'collection.fish.carp' },
    { skillId: 'life.fishing' },
    { quantity: 0 },
    { status: 'LIVE' },
    { definitionVersion: 0 }
  ]) assert.throws(() => createGatheringSourceDefinition({ ...base, ...overrides }));

  assert.throws(() => createGatheringSourceRegistry({ definitions: [base, base] }), /Duplicate/);
});
