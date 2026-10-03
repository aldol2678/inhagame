import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertTmlConformance,
  assertTmlReadResultStructure,
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

test('PR1 admission rejects malformed expressions before an implicit or partial condition can pass', () => {
  const atom = fixtureSource.transitions[0].postcondition;
  const cases = [
    null,
    { ...atom, op: 'always' },
    { ...atom, subject: '' },
    { ...atom, predicate: 7 },
    { ...atom, extra: true },
    { op: 'and', args: [] },
    { op: 'or', args: [atom], predicate: 'quest.stage' },
    { op: 'not' },
    { op: 'not', arg: atom, value: { type: 'boolean', value: true } },
    { op: 'exists', subject: atom.subject, predicate: atom.predicate, value: atom.value },
  ];
  for (const expression of cases) {
    const module = clone(fixtureSource);
    module.transitions[0].postcondition = expression;
    const result = validateTmlModule(module, clone(profileSource));
    assert.equal(result.ok, false, JSON.stringify(expression));
    assert.ok(codes(result).includes('SCHEMA_VALIDATION_ERROR'));
  }
  const missing = clone(fixtureSource);
  delete missing.transitions[0].postcondition;
  assert.equal(validateTmlModule(missing, profileSource).ok, false);
});

test('PR1 admission checks typed payloads recursively instead of accepting only a type tag', () => {
  const cases = [
    { type: 'number', value: '1' },
    { type: 'number' },
    { type: 'boolean', value: 1 },
    { type: 'string', value: false },
    { type: 'ref', value: '' },
    { type: 'ref', value: 4 },
    { type: 'null', value: null },
    { type: 'number', value: 1, trusted: true },
    { type: 'list', value: {} },
    { type: 'list', value: [{ type: 'object', value: { nested: { type: 'boolean', value: 'true' } } }] },
    { type: 'object', value: [] },
    { type: 'object', value: { nested: { type: 'list', value: [1] } } },
  ];
  for (const value of cases) {
    const module = clone(fixtureSource);
    module.transitions[0].postcondition.value = value;
    assert.equal(validateTmlModule(module, profileSource).ok, false, JSON.stringify(value));
  }
  const malformedArgument = clone(fixtureSource);
  malformedArgument.transitions[0].actions[0].args.event.value = 3;
  assert.equal(validateTmlModule(malformedArgument, profileSource).ok, false);
});

test('PR1 admission follows closed module, transition, action, event and profile structures', () => {
  const moduleCases = [
    (module) => { delete module.id; },
    (module) => { module.id = ''; },
    (module) => { module.extensions = []; },
    (module) => { module.extra = true; },
    (module) => { module.transitions[0].id = 1; },
    (module) => { module.transitions[0].subject = ''; },
    (module) => { module.transitions[0].actions = null; },
    (module) => { module.transitions[0].trigger.where = []; },
    (module) => { module.transitions[0].trigger.extra = true; },
    (module) => { delete module.transitions[0].actions[0].args; },
    (module) => { module.transitions[0].actions[0].id = ''; },
    (module) => { module.transitions[0].actions[0].capability = ''; },
    (module) => { module.transitions[0].actions[0].args = []; },
    (module) => { module.transitions[0].actions[0].extra = true; },
  ];
  for (const change of moduleCases) {
    const module = clone(fixtureSource);
    change(module);
    assert.equal(validateTmlModule(module, profileSource).ok, false, change.toString());
  }
  const profileCases = [
    (profile) => { delete profile.authority; },
    (profile) => { profile.id = ''; },
    (profile) => { profile.events.push(1); },
    (profile) => { profile.entity_types.push(''); },
    (profile) => { profile.predicates.push(profile.predicates[0]); },
    (profile) => { profile.capabilities = {}; },
    (profile) => { profile.capabilities[0].mutates = 'true'; },
    (profile) => { delete profile.capabilities[0].mutates; },
    (profile) => { profile.capabilities[0].provider_binding = ''; },
    (profile) => { profile.capabilities[0].parameters.quest = { type: 'list' }; },
    (profile) => { profile.capabilities[0].parameters.event = { type: 'string', value: 'start' }; },
    (profile) => { profile.capabilities[0].parameters.quest = { type: 'object', properties: { nested: { type: 'list', items: null } } }; },
    (profile) => { profile.capabilities[0].verification = { predicate: 'quest.stage' }; },
    (profile) => { profile.authority[0].authority = ''; },
    (profile) => { profile.authority[0].fallback = ['']; },
    (profile) => { profile.authority[0].extra = true; },
    (profile) => { profile.extra = true; },
  ];
  for (const change of profileCases) {
    const profile = clone(profileSource);
    change(profile);
    assert.equal(validateTmlProfile(profile).ok, false, change.toString());
  }
});

test('PR1 admission preserves schema-valid generic boolean, list and object semantics', () => {
  const profile = clone(profileSource);
  profile.capabilities.push({
    id: 'world.inspect',
    mutates: false,
    parameters: {
      items: { type: 'list', items: { type: 'number' } },
      settings: { type: 'object', properties: { enabled: { type: 'boolean' } } },
    },
  });
  const module = clone(fixtureSource);
  const transition = module.transitions[0];
  const originalPostcondition = transition.postcondition;
  transition.postcondition = {
    op: 'or',
    args: [originalPostcondition, { op: 'not', arg: { op: 'exists', subject: transition.subject, predicate: 'quest.available' } }],
  };
  transition.actions.push({
    id: 'call.inspect', capability: 'world.inspect',
    args: {
      items: { type: 'list', value: [{ type: 'number', value: 2 }] },
      settings: { type: 'object', value: { enabled: { type: 'boolean', value: true }, extra: { type: 'null' } } },
    },
  });
  transition.trigger.where.extra = { type: 'object', value: { list: { type: 'list', value: [{ type: 'string', value: '' }, { type: 'null' }] } } };
  module.extensions.example = { optional: null, ordered: [2, 1] };
  assert.deepEqual(validateTmlModule(module, profile), { ok: true, errors: [] });

  // Parameter properties do not invent required or closed-object semantics.
  transition.actions[1].args.settings.value = {};
  assert.equal(validateTmlModule(module, profile).ok, true);
  transition.actions[1].args.settings.value.enabled = { type: 'number', value: 1 };
  assert.ok(codes(validateTmlModule(module, profile)).includes('ARGUMENT_TYPE_MISMATCH'));
  transition.actions[1].args.settings.value = {};
  transition.actions[1].args.items.value = [{ type: 'string', value: '2' }];
  assert.ok(codes(validateTmlModule(module, profile)).includes('ARGUMENT_TYPE_MISMATCH'));

  const noActions = clone(fixtureSource);
  noActions.transitions[0].actions = [];
  assert.equal(validateTmlModule(noActions, profileSource).ok, true);
  noActions.transitions = [];
  assert.equal(validateTmlModule(noActions, profileSource).ok, true);
});

test('PR1 direct validation rejects non-JSON inputs without invoking accessors or crashing', () => {
  for (const bad of [NaN, Infinity, undefined, () => true, 1n, new Date(), new Map(), new Array(1)]) {
    const module = clone(fixtureSource);
    module.extensions.bad = bad;
    assert.doesNotThrow(() => validateTmlModule(module, profileSource));
    assert.ok(codes(validateTmlModule(module, profileSource)).includes('NON_JSON_VALUE'));
  }
  const cyclic = clone(fixtureSource);
  cyclic.extensions.self = cyclic;
  assert.equal(validateTmlModule(cyclic, profileSource).ok, false);

  let getterCalls = 0;
  const accessor = clone(fixtureSource);
  Object.defineProperty(accessor.transitions[0].actions[0].args.event, 'value', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('must not execute'); },
  });
  assert.equal(validateTmlModule(accessor, profileSource).ok, false);
  assert.equal(getterCalls, 0);
  assert.equal(validateTmlModule(Object.create(fixtureSource), profileSource).ok, false);
});

test('PR1 time values require RFC 3339 date-times with valid calendar dates and offsets', () => {
  const valid = [
    '2026-10-03T13:54:19+09:00', '2024-02-29T00:00:00.125Z',
    '2026-10-03t04:54:19z', '1990-12-31T23:59:60Z', '1991-01-01T08:59:60+09:00',
  ];
  const invalid = [
    '2026-10-03', '2026-10-03T04:54:19', '2026-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z', '2026-10-03T24:00:00Z', '2026-10-03T04:54:19+24:00',
    '2026-10-03T04:54:19+09:60', '2026-10-03T04:54:60Z', '2026-10-03T04:54:19Z\n',
  ];
  for (const value of [...valid, ...invalid]) {
    const module = clone(fixtureSource);
    module.transitions[0].trigger.where.time = { type: 'time', value };
    assert.equal(validateTmlModule(module, profileSource).ok, valid.includes(value), value);
  }
});

function readRecords() {
  return {
    capability: 'world.quest.read',
    facts: [{
      kind: 'fact', id: 'fact.stage', subject: 'quest.example', predicate: 'quest.stage',
      value: { type: 'number', value: 4 }, source: 'server.quest', observed_at: '2026-10-03T04:54:19Z',
    }],
    observations: [{
      kind: 'observation', id: 'observation.stage', source: 'server.quest', observed_at: '2026-10-03T04:54:19Z',
      query: { subject: 'quest.example', predicate: 'quest.stage' }, facts: ['fact.stage'],
    }],
  };
}

test('PR1 read-result structural assertion validates published Fact/Observation shapes only', () => {
  const valid = readRecords();
  assert.equal(assertTmlReadResultStructure(valid), valid);
  assert.doesNotThrow(() => assertTmlReadResultStructure({ facts: [], observations: [] }));
  const malformed = [
    (result) => { result.facts = null; },
    (result) => { result.facts[0].kind = 'evidence'; },
    (result) => { result.facts[0].source = ''; },
    (result) => { result.facts[0].value.value = '4'; },
    (result) => { result.facts[0].confidence = 1.1; },
    (result) => { result.facts[0].observed_at = '2026-10-03'; },
    (result) => { result.facts[0].trusted = true; },
    (result) => { result.observations[0].query.subject = ''; },
    (result) => { result.observations[0].facts = [1]; },
    (result) => { delete result.observations[0].facts; },
    (result) => { result.observations[0].extensions = { nonJson: undefined }; },
  ];
  for (const change of malformed) {
    const result = readRecords();
    change(result);
    assert.throws(() => assertTmlReadResultStructure(result), (error) =>
      error.name === 'TmlConformanceError' && error.code === 'INVALID_READ_RESULT' && error.diagnostics.length > 0);
  }
  let getterCalls = 0;
  const getterResult = { observations: [] };
  Object.defineProperty(getterResult, 'facts', { get() { getterCalls += 1; return []; } });
  assert.throws(() => assertTmlReadResultStructure(getterResult), (error) => error.code === 'INVALID_READ_RESULT');
  assert.equal(getterCalls, 0);

  // Structural validation deliberately does not authenticate sources or links.
  valid.observations[0].facts = ['fact.different'];
  assert.doesNotThrow(() => assertTmlReadResultStructure(valid));
});
