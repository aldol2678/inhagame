import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATURE_ACTIVITY_BRIDGE_REGISTRY,
  CREATURE_DEFINITION_STATUS,
  CREATURE_EVOLUTION_RULE_REGISTRY,
  CREATURE_FORM_REGISTRY,
  CREATURE_SOURCE_DOMAIN,
  CREATURE_SPECIES_REGISTRY,
  createCreatureActivityBridgeRegistry,
  createCreatureFormRegistry,
  creatureSpeciesAuthorityRow,
  validateCreatureActivityIngress,
  validateCreaturePartyShape
} from '../src/creature/creature-core-contract.js';

test('Creature Core keeps four species identities with duck.base as the first active form', () => {
  assert.deepEqual(CREATURE_SPECIES_REGISTRY.list().map(item => item.speciesId), [
    'creature.species.duck',
    'creature.species.pageling',
    'creature.species.volti',
    'creature.species.porong'
  ]);
  assert.equal(CREATURE_SPECIES_REGISTRY.get('creature.species.duck').status, CREATURE_DEFINITION_STATUS.ACTIVE);
  assert.ok(['creature.species.pageling','creature.species.volti','creature.species.porong'].every(
    id => CREATURE_SPECIES_REGISTRY.get(id).status === CREATURE_DEFINITION_STATUS.COMING_SOON
  ));
  assert.equal(CREATURE_FORM_REGISTRY.size, 1);
  assert.deepEqual(CREATURE_FORM_REGISTRY.get('creature.form.duck.base'), {
    formId: 'creature.form.duck.base',
    speciesId: 'creature.species.duck',
    status: 'ACTIVE',
    definitionVersion: 1
  });
  assert.equal(CREATURE_ACTIVITY_BRIDGE_REGISTRY.size, 0);
  assert.equal(CREATURE_EVOLUTION_RULE_REGISTRY.size, 0);
  assert.deepEqual(creatureSpeciesAuthorityRow(CREATURE_SPECIES_REGISTRY.get('creature.species.duck')), {
    species_id: 'creature.species.duck',
    status: 'ACTIVE',
    definition_version: 1
  });
});

test('Creature party is Active 1 + Reserve 2 and cannot duplicate a creature', () => {
  assert.deepEqual(validateCreaturePartyShape({
    activeCreatureId: 'a',
    reserveCreatureIds: ['b', 'c']
  }), {
    activeCreatureId: 'a',
    reserveCreatureIds: ['b', 'c']
  });
  assert.throws(() => validateCreaturePartyShape({
    activeCreatureId: 'a',
    reserveCreatureIds: ['b', 'c', 'd']
  }), /at most two reserves/);
  assert.throws(() => validateCreaturePartyShape({
    activeCreatureId: 'a',
    reserveCreatureIds: ['a']
  }), /duplicates/);
  assert.throws(() => validateCreaturePartyShape({
    activeCreatureId: null,
    reserveCreatureIds: ['b']
  }), /require an active creature/);
});

test('external activity ingress carries verified source identity only', () => {
  const valid = validateCreatureActivityIngress({
    bridgeId: 'creature.bridge.activity.fishing',
    sourceRef: 'activity.fishing.inkyung',
    sourceResultRef: 'fishing_result:abc123',
    sourceEventKey: 'activity:fishing:abc123',
    partyRevision: 7,
    occurredAt: '2026-10-04T00:00:00.000Z'
  });
  assert.deepEqual(valid, {
    bridgeId: 'creature.bridge.activity.fishing',
    sourceRef: 'activity.fishing.inkyung',
    sourceResultRef: 'fishing_result:abc123',
    sourceEventKey: 'activity:fishing:abc123',
    partyRevision: 7,
    occurredAt: '2026-10-04T00:00:00.000Z'
  });

  for (const field of [
    'creatureId', 'xpAmount', 'memoryTag', 'bondLevel', 'traits',
    'nextFormId', 'evolutionRuleId', 'damage', 'rewardId', 'loot'
  ]) {
    assert.throws(() => validateCreatureActivityIngress({
      bridgeId: 'creature.bridge.activity.fishing',
      sourceRef: 'activity.fishing.inkyung',
      sourceResultRef: 'fishing_result:abc123',
      sourceEventKey: 'activity:fishing:abc123',
      partyRevision: 7,
      occurredAt: '2026-10-04T00:00:00.000Z',
      [field]: true
    }), /authority field is forbidden/);
  }
});

test('activity bridge registry enforces semantic source-domain ownership', () => {
  const base = {
    bridgeId: 'creature.bridge.combat.protection',
    sourceDomain: CREATURE_SOURCE_DOMAIN.COMBAT,
    semanticEventType: 'combat.protection',
    memoryTag: 'memory.combat.protection',
    xpAmount: 1,
    cooldownSeconds: 0,
    dailyCap: 10,
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    definitionVersion: 1
  };
  assert.equal(createCreatureActivityBridgeRegistry({ definitions: [base] }).size, 1);
  assert.throws(() => createCreatureActivityBridgeRegistry({ definitions: [{
    ...base,
    semanticEventType: 'activity.protection'
  }] }), /sourceDomain\/event mismatch/);
});

test('form registry cannot invent a form for an unknown species', () => {
  assert.throws(() => createCreatureFormRegistry({ definitions: [{
    formId: 'creature.form.ghost.base',
    speciesId: 'creature.species.ghost',
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    definitionVersion: 1
  }] }), /Unknown speciesId/);
});