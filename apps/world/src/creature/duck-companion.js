// INHA WORLD Duck Companion P1.
// First real Creature vertical slice: verified observations -> bond eligibility -> owned duck.base.
// Observation production stays server-trusted; browser clients cannot mint observation provenance.

export const DUCK_COMPANION_RULE = Object.freeze({
  ruleId: 'creature.acquisition.duck.inkyung_bond',
  speciesId: 'creature.species.duck',
  formId: 'creature.form.duck.base',
  sourceRef: 'creature.acquisition.duck.inkyung',
  requiredObservationCount: 3,
  autoActivateIfPartyEmpty: true,
  status: 'ACTIVE',
  definitionVersion: 1
});

export const DUCK_COMPANION_STATE = Object.freeze({
  UNSEEN: 'UNSEEN',
  SIGHTED: 'SIGHTED',
  OBSERVED: 'OBSERVED',
  BOND_ELIGIBLE: 'BOND_ELIGIBLE',
  OWNED: 'OWNED'
});

export function duckCompanionState({
  observationCount = 0,
  owned = false
} = {}) {
  if (!Number.isSafeInteger(observationCount) || observationCount < 0) {
    throw new TypeError('Invalid duck observationCount');
  }
  if (owned) return DUCK_COMPANION_STATE.OWNED;
  if (observationCount <= 0) return DUCK_COMPANION_STATE.UNSEEN;
  if (observationCount === 1) return DUCK_COMPANION_STATE.SIGHTED;
  if (observationCount < DUCK_COMPANION_RULE.requiredObservationCount) {
    return DUCK_COMPANION_STATE.OBSERVED;
  }
  return DUCK_COMPANION_STATE.BOND_ELIGIBLE;
}

export function duckCompanionRuleAuthorityRow(rule = DUCK_COMPANION_RULE) {
  return Object.freeze({
    rule_id: rule.ruleId,
    species_id: rule.speciesId,
    form_id: rule.formId,
    source_ref: rule.sourceRef,
    required_observation_count: rule.requiredObservationCount,
    auto_activate_if_party_empty: rule.autoActivateIfPartyEmpty,
    status: rule.status,
    definition_version: rule.definitionVersion
  });
}