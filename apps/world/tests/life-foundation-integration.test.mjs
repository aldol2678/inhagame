import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACQUISITION_SOURCES,
  ITEM_CATALOG,
  LIFE_M1_MATERIAL_IDS
} from '../src/collection/item-catalog.js';
import {
  ACTIVITY_AUTHORITY_TIER,
  ACTIVITY_DEFINITION_STATUS,
  ACTIVITY_REGISTRY
} from '../src/activity/activity-contract.js';
import {
  COLLECTION_ENTRY_REGISTRY,
  COLLECTION_ENTRY_STATUS,
  COLLECTION_PERSISTENCE_MODE
} from '../src/collection/collection-discovery-contract.js';
import {
  LIFE_SKILL_REGISTRY,
  LIFE_SKILL_STATUS
} from '../src/life-skills/life-skill-registry.js';

const slices = Object.freeze([
  {
    domain: 'fishing',
    activityId: 'activity.fishing.inkyung',
    materialId: 'material.fish_carp',
    collectionEntryId: 'collection.fish.carp',
    skillId: 'life.fishing'
  },
  {
    domain: 'gathering',
    activityId: 'activity.gathering.campus',
    materialId: 'material.campus_leaf',
    collectionEntryId: 'collection.plant.campus_leaf',
    skillId: 'life.gathering'
  },
  {
    domain: 'archaeology',
    activityId: 'activity.archaeology.campus_history',
    materialId: 'material.artifact_fragment_01',
    collectionEntryId: 'collection.artifact.campus_fragment_01',
    skillId: 'life.archaeology'
  }
]);

test('P1-A semantic identities align across Material, Activity, Discovery and Life Skill foundations', () => {
  // Membership, not order: catalog order is its own committed contract (item-catalog.test.mjs).
  assert.deepEqual([...LIFE_M1_MATERIAL_IDS].sort(), slices.map(slice => slice.materialId).sort());

  for (const slice of slices) {
    const activity = ACTIVITY_REGISTRY.get(slice.activityId);
    const material = ITEM_CATALOG.find(item => item.itemId === slice.materialId);
    const discovery = COLLECTION_ENTRY_REGISTRY.get(slice.collectionEntryId);
    const skill = LIFE_SKILL_REGISTRY.get(slice.skillId);

    assert.ok(activity, `${slice.domain}: Activity exists`);
    assert.ok(material, `${slice.domain}: Material exists`);
    assert.ok(discovery, `${slice.domain}: Collection Entry exists`);
    assert.ok(skill, `${slice.domain}: Life Skill exists`);

    assert.equal(activity.authorityTier, ACTIVITY_AUTHORITY_TIER.SERVER_VALIDATED);
    assert.equal(material.category, 'MATERIAL');
    assert.equal(material.ownershipPolicy, 'STACKABLE');
    assert.equal(material.acquisition[0].source, 'ACTIVITY');
    assert.equal(material.acquisition[0].ref, slice.activityId);
    assert.equal(discovery.persistenceMode, COLLECTION_PERSISTENCE_MODE.SERVER_PERSISTED);
    assert.equal(skill.curveId, 'life.common.v1');
  }
});

test('P0 foundations do not accidentally activate P1-A gameplay before adapters and balance land', () => {
  for (const slice of slices) {
    assert.equal(ACTIVITY_REGISTRY.get(slice.activityId).status, ACTIVITY_DEFINITION_STATUS.COMING_SOON);
    assert.equal(COLLECTION_ENTRY_REGISTRY.get(slice.collectionEntryId).status, COLLECTION_ENTRY_STATUS.COMING_SOON);
    assert.equal(LIFE_SKILL_REGISTRY.get(slice.skillId).status, LIFE_SKILL_STATUS.COMING_SOON);
  }
});

test('M1 source vocabulary contains every server settlement source required by later foundations', () => {
  for (const source of ['ACTIVITY', 'CRAFTING', 'EQUIPMENT', 'RESEARCH']) {
    assert.ok(ACQUISITION_SOURCES.includes(source), source);
  }
});

test('Biryong remains owner-derived and is not folded into the P1-A persistent discovery trio', () => {
  const biryong = COLLECTION_ENTRY_REGISTRY.get('collection.place.biryong_tower');
  assert.equal(biryong.persistenceMode, COLLECTION_PERSISTENCE_MODE.DERIVED_FROM_OWNER);
  assert.equal(biryong.ownerDomain, 'BIRYONG');
  assert.equal(biryong.ownerRef, 'BR01');
  assert.equal(slices.some(slice => slice.collectionEntryId === biryong.entryId), false);
});

test('P1-B Woodcutting and Mining are registered but remain outside the P1-A integration slice', () => {
  for (const skillId of ['life.woodcutting', 'life.mining']) {
    const skill = LIFE_SKILL_REGISTRY.get(skillId);
    assert.ok(skill);
    assert.equal(skill.status, LIFE_SKILL_STATUS.COMING_SOON);
    assert.equal(slices.some(slice => slice.skillId === skillId), false);
  }
});
