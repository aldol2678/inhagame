import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_AVAILABILITY,
  COMBAT_DEFINITION_STATUS,
  COMBAT_ENCOUNTER_STATE,
  COMBAT_REGISTRY,
  assertCombatStateTransition,
  createCombatDefinition,
  createCombatRegistry,
  createCombatSemanticEvent,
  isTerminalCombatState,
  resolveCombatBreak,
  resolveCombatDamage,
  validateCombatStartRequest
} from '../src/combat/combat-contract.js';

const KEY = '11111111-1111-4111-8111-111111111111';
const ENCOUNTER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

const candidate = (overrides = {}) => ({
  combatId: 'combat.training.breaker_v0',
  category: 'TRAINING',
  title: 'BREAKER v0',
  availability: COMBAT_AVAILABILITY.CONDITIONAL,
  availabilityRef: 'availability.combat.training_v1',
  resolverRef: 'resolver.combat.breaker_v0',
  outcomeSchemaVersion: 1,
  semanticEventTypes: ['combat.started', 'combat.succeeded', 'combat.failed'],
  status: COMBAT_DEFINITION_STATUS.COMING_SOON,
  tags: ['combat', 'training'],
  definitionVersion: 1,
  ...overrides
});

test('Combat P0 registry contains no live or candidate encounter identities', () => {
  assert.equal(COMBAT_REGISTRY.size, 0);
  assert.deepEqual(COMBAT_REGISTRY.list(), []);
});

test('Combat definition contract validates a server-owned encounter identity without activating it', () => {
  const definition = createCombatDefinition(candidate());
  assert.equal(definition.combatId, 'combat.training.breaker_v0');
  assert.equal(definition.status, COMBAT_DEFINITION_STATUS.COMING_SOON);
  assert.ok(Object.isFrozen(definition));
  assert.equal(createCombatRegistry({ definitions: [definition] }).size, 1);
  assert.throws(() => createCombatRegistry({ definitions: [definition, definition] }), /Duplicate combatId/);
});

test('client Combat start request cannot forge damage, state, rewards, EXP or loot', () => {
  const valid = validateCombatStartRequest({
    combatId: 'combat.training.breaker_v0',
    sourceRef: 'combat.training.pad_01',
    clientEncounterKey: KEY,
    evidence: { trigger: 'training_pad' }
  });
  assert.deepEqual(valid, {
    combatId: 'combat.training.breaker_v0',
    sourceRef: 'combat.training.pad_01',
    clientEncounterKey: KEY,
    evidence: { trigger: 'training_pad' }
  });

  for (const field of [
    'damage', 'hp', 'shield', 'breakValue', 'enemyState', 'resultRef', 'rewardId',
    'rewardAmount', 'playerExp', 'lifeXp', 'creatureXp', 'loot', 'inventory'
  ]) {
    assert.throws(() => validateCombatStartRequest({
      combatId: 'combat.training.breaker_v0',
      sourceRef: 'combat.training.pad_01',
      clientEncounterKey: KEY,
      [field]: 1
    }), /authority field is forbidden/);
  }
});

test('Combat encounter state machine allows one active phase and one terminal transition', () => {
  assert.equal(assertCombatStateTransition(COMBAT_ENCOUNTER_STATE.CREATED, COMBAT_ENCOUNTER_STATE.ACTIVE), true);
  for (const terminal of [
    COMBAT_ENCOUNTER_STATE.SUCCEEDED,
    COMBAT_ENCOUNTER_STATE.FAILED,
    COMBAT_ENCOUNTER_STATE.CANCELLED,
    COMBAT_ENCOUNTER_STATE.EXPIRED
  ]) {
    assert.equal(assertCombatStateTransition(COMBAT_ENCOUNTER_STATE.ACTIVE, terminal), true);
    assert.equal(isTerminalCombatState(terminal), true);
    assert.throws(() => assertCombatStateTransition(terminal, COMBAT_ENCOUNTER_STATE.ACTIVE), /Invalid combat transition/);
  }
});

test('damage resolution is deterministic: reduction -> shield -> HP -> death', () => {
  assert.deepEqual(resolveCombatDamage({
    hp: 50,
    maxHp: 100,
    shield: 12,
    incomingDamage: 30,
    resolvedReduction: 5
  }), {
    incomingDamage: 30,
    resolvedReduction: 5,
    damageAfterReduction: 25,
    shieldAbsorbed: 12,
    hpDamage: 13,
    hpBefore: 50,
    hpAfter: 37,
    shieldBefore: 12,
    shieldAfter: 0,
    died: false
  });

  assert.equal(resolveCombatDamage({
    hp: 10,
    maxHp: 100,
    shield: 0,
    incomingDamage: 99,
    resolvedReduction: 0
  }).died, true);
});

test('break resolution caps at threshold and exposes BROKEN state without defining balance values', () => {
  assert.deepEqual(resolveCombatBreak({
    breakValue: 70,
    breakMax: 100,
    incomingBreak: 40
  }), {
    breakBefore: 70,
    breakAfter: 100,
    breakMax: 100,
    incomingBreak: 40,
    broken: true
  });
});

test('Combat semantic event carries verified identity only and no settlement payload', () => {
  const event = createCombatSemanticEvent({
    type: 'combat.succeeded',
    combatId: 'combat.training.breaker_v0',
    encounterId: ENCOUNTER,
    sourceRef: 'combat.training.pad_01',
    resultRef: 'combat_result:abc123',
    occurredAt: '2026-10-04T00:00:00.000Z',
    actorUserId: USER
  });
  assert.equal(event.resultRef, 'combat_result:abc123');
  assert.equal('rewardId' in event, false);
  assert.equal('playerExp' in event, false);
  assert.equal('creatureXp' in event, false);
});
