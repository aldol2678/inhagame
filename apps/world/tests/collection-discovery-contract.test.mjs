import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_ENTRY_REGISTRY,
  COLLECTION_PERSISTENCE_MODE,
  DEFAULT_COLLECTION_ENTRY_DEFINITIONS,
  collectionDiscoveryPresentationState,
  collectionEntryAuthorityRow,
  createCollectionEntryDefinition,
  createCollectionEntryRegistry
} from '../src/collection/collection-discovery-contract.js';

test('P0 registry contains 3 server-persisted pilots + 1 owner-derived Biryong entry', () => {
  assert.equal(COLLECTION_ENTRY_REGISTRY.size, 4);
  assert.deepEqual(COLLECTION_ENTRY_REGISTRY.list().map(entry => entry.entryId), [
    'collection.fish.carp',
    'collection.plant.campus_leaf',
    'collection.artifact.campus_fragment_01',
    'collection.place.biryong_tower'
  ]);

  const persisted = COLLECTION_ENTRY_REGISTRY.list()
    .filter(entry => entry.persistenceMode === COLLECTION_PERSISTENCE_MODE.SERVER_PERSISTED);
  assert.deepEqual(persisted.map(entry => entry.status), ['COMING_SOON', 'COMING_SOON', 'COMING_SOON']);
  assert.deepEqual(persisted.map(entry => entry.category), ['FISH', 'PLANT', 'ARTIFACT']);

  const biryong = COLLECTION_ENTRY_REGISTRY.get('collection.place.biryong_tower');
  assert.equal(biryong.persistenceMode, COLLECTION_PERSISTENCE_MODE.DERIVED_FROM_OWNER);
  assert.equal(biryong.ownerDomain, 'BIRYONG');
  assert.equal(biryong.ownerRef, 'BR01');
  assert.equal(biryong.status, 'ACTIVE');
});

test('registry rejects duplicate ids and persistence-owner boundary violations', () => {
  const fish = DEFAULT_COLLECTION_ENTRY_DEFINITIONS.FISH_CARP;
  assert.throws(() => createCollectionEntryRegistry({ definitions: [fish, fish] }), /Duplicate entryId/);
  assert.throws(() => createCollectionEntryDefinition({ ...fish, entryId: 'fish.carp' }), /Invalid entryId/);
  assert.throws(() => createCollectionEntryDefinition({
    ...fish,
    entryId: 'collection.fish.bad_owner',
    ownerDomain: 'INVENTORY',
    ownerRef: 'material.fish_carp'
  }), /SERVER_PERSISTED cannot declare ownerDomain/);
  assert.throws(() => createCollectionEntryDefinition({
    ...fish,
    entryId: 'collection.place.bad_derived',
    persistenceMode: 'DERIVED_FROM_OWNER',
    discoveryRuleRef: null,
    ownerDomain: null,
    ownerRef: null
  }), /requires ownerDomain\/ownerRef/);
  assert.throws(() => createCollectionEntryDefinition({
    ...DEFAULT_COLLECTION_ENTRY_DEFINITIONS.PLACE_BIRYONG_TOWER,
    entryId: 'collection.place.bad_rule',
    discoveryRuleRef: 'discovery.illegal_duplicate_v1'
  }), /cannot declare discoveryRuleRef/);
});

test('DB authority mirror exposes only write-validation fields', () => {
  const row = collectionEntryAuthorityRow(COLLECTION_ENTRY_REGISTRY.get('collection.fish.carp'));
  assert.deepEqual(row, {
    entry_id: 'collection.fish.carp',
    category: 'FISH',
    persistence_mode: 'SERVER_PERSISTED',
    owner_domain: null,
    owner_ref: null,
    status: 'COMING_SOON',
    definition_version: 1
  });
  assert.equal('title' in row, false);
  assert.equal('rarity' in row, false);
  assert.equal('visibility_policy' in row, false);
  assert.equal('discovery_rule_ref' in row, false);
});

test('presentation state separates unknown, discovered and owner-derived facts', () => {
  const fish = COLLECTION_ENTRY_REGISTRY.get('collection.fish.carp');
  assert.deepEqual(collectionDiscoveryPresentationState(fish), {
    entryId: 'collection.fish.carp',
    persistenceMode: 'SERVER_PERSISTED',
    discoveryState: 'UNKNOWN',
    discovered: false,
    firstDiscoveredAt: null,
    discoveryCount: 0
  });
  assert.deepEqual(collectionDiscoveryPresentationState(fish, {
    firstDiscoveredAt: '2026-10-01T00:00:00.000Z',
    discoveryCount: 3
  }), {
    entryId: 'collection.fish.carp',
    persistenceMode: 'SERVER_PERSISTED',
    discoveryState: 'DISCOVERED',
    discovered: true,
    firstDiscoveredAt: '2026-10-01T00:00:00.000Z',
    discoveryCount: 3
  });

  const biryong = COLLECTION_ENTRY_REGISTRY.get('collection.place.biryong_tower');
  assert.deepEqual(collectionDiscoveryPresentationState(biryong), {
    entryId: 'collection.place.biryong_tower',
    persistenceMode: 'DERIVED_FROM_OWNER',
    discoveryState: 'OWNER_DERIVED',
    discovered: null,
    firstDiscoveredAt: null,
    discoveryCount: null
  });
});
