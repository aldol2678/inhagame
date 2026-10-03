import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertTmlConformance,
  validateTmlModule,
  validateTmlProfile,
} from '../tml/runtime/conformance.mjs';

const profileSource = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const fixtureSource = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

const clone = (value) => structuredClone(value);
const codes = (result) => result.errors.map((error) => error.code);

test('P2 validator accepts the current INHA WORLD Main 2 module/profile contract', () => {
  const result = validateTmlModule(clone(fixtureSource), clone(profileSource));
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.doesNotThrow(() => assertTmlConformance(clone(fixtureSource), clone(profileSource)));
});

test('P2 validator rejects module/profile identity drift', () => {
  const module = clone(fixtureSource);
  module.profile = 'inha.world@9.9';

  const result = validateTmlModule(module, clone(profileSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('PROFILE_ID_MISMATCH'));
});

test('P2 validator rejects undeclared predicate, event, and capability vocabulary', () => {
  const module = clone(fixtureSource);
  module.transitions[0].precondition.args[0].predicate = 'quest.secret_stage';
  module.transitions[0].trigger.event = 'world.secret.event';
  module.transitions[0].actions[0].capability = 'world.secret.mutate';

  const result = validateTmlModule(module, clone(profileSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('UNDECLARED_PREDICATE'));
  assert.ok(codes(result).includes('UNDECLARED_EVENT'));
  assert.ok(codes(result).includes('UNDECLARED_CAPABILITY'));
});

test('P2 validator rejects action argument shape and type drift', () => {
  const module = clone(fixtureSource);
  const action = module.transitions[0].actions[0];
  delete action.args.event;
  action.args.quest = { type: 'string', value: 'quest.campus_navigation_intro_v1' };
  action.args.extra = { type: 'boolean', value: true };

  const result = validateTmlModule(module, clone(profileSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('ARGUMENT_SET_MISMATCH'));
  assert.ok(codes(result).includes('ARGUMENT_TYPE_MISMATCH'));
});

test('P2 validator requires a mutating action postcondition to verify its declared predicate', () => {
  const module = clone(fixtureSource);
  module.transitions[0].postcondition.predicate = 'quest.available';
  module.transitions[0].postcondition.value = { type: 'boolean', value: true };

  const result = validateTmlModule(module, clone(profileSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('POSTCONDITION_VERIFICATION_PREDICATE_MISSING'));
});

test('P2 profile validation rejects missing mutating verification metadata', () => {
  const profile = clone(profileSource);
  delete profile.capabilities.find((capability) => capability.id === 'world.quest.advance').verification;

  const result = validateTmlProfile(profile);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('MUTATING_CAPABILITY_VERIFICATION_MISSING'));
});

test('P2 profile validation rejects authority drift', () => {
  const profile = clone(profileSource);
  profile.authority.find((rule) => rule.predicate === 'quest.stage').authority = 'world.client';

  const result = validateTmlProfile(profile);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('AUTHORITY_MISMATCH'));
});

test('P2 validator reports duplicate transition and action ids', () => {
  const module = clone(fixtureSource);
  module.transitions[1].id = module.transitions[0].id;
  module.transitions[1].actions[0].id = module.transitions[0].actions[0].id;

  const result = validateTmlModule(module, clone(profileSource));
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('DUPLICATE_TRANSITION_ID'));
  assert.ok(codes(result).includes('DUPLICATE_ACTION_ID'));
});

test('assertTmlConformance throws diagnostics without hiding the failure code', () => {
  const module = clone(fixtureSource);
  module.transitions[0].trigger.event = 'world.not_declared';

  assert.throws(
    () => assertTmlConformance(module, clone(profileSource)),
    (error) => {
      assert.equal(error.name, 'TmlConformanceError');
      assert.ok(Array.isArray(error.diagnostics));
      assert.ok(error.diagnostics.some((item) => item.code === 'UNDECLARED_EVENT'));
      return true;
    },
  );
});
