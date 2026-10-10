import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUCK_COMPANION_RULE,
  DUCK_COMPANION_STATE,
  duckCompanionRuleAuthorityRow,
  duckCompanionState
} from '../src/creature/duck-companion.js';

test('duck.base acquisition rule is the first active Creature bond rule', () => {
  assert.deepEqual(duckCompanionRuleAuthorityRow(), {
    rule_id: 'creature.acquisition.duck.inkyung_bond',
    species_id: 'creature.species.duck',
    form_id: 'creature.form.duck.base',
    source_ref: 'creature.acquisition.duck.inkyung',
    required_observation_count: 3,
    auto_activate_if_party_empty: true,
    status: 'ACTIVE',
    definition_version: 1
  });
});

test('duck companion discovery ladder is observation-driven and deterministic', () => {
  assert.equal(duckCompanionState({ observationCount: 0 }), DUCK_COMPANION_STATE.UNSEEN);
  assert.equal(duckCompanionState({ observationCount: 1 }), DUCK_COMPANION_STATE.SIGHTED);
  assert.equal(duckCompanionState({ observationCount: 2 }), DUCK_COMPANION_STATE.OBSERVED);
  assert.equal(duckCompanionState({ observationCount: 3 }), DUCK_COMPANION_STATE.BOND_ELIGIBLE);
  assert.equal(duckCompanionState({ observationCount: 50 }), DUCK_COMPANION_STATE.BOND_ELIGIBLE);
  assert.equal(duckCompanionState({ observationCount: 0, owned: true }), DUCK_COMPANION_STATE.OWNED);
  assert.throws(() => duckCompanionState({ observationCount: -1 }), /Invalid duck observationCount/);
});

test('duck companion rule never treats observation itself as ownership', () => {
  assert.equal(DUCK_COMPANION_RULE.requiredObservationCount, 3);
  assert.equal(DUCK_COMPANION_RULE.autoActivateIfPartyEmpty, true);
  assert.equal(DUCK_COMPANION_RULE.status, 'ACTIVE');
});