import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTmlTraceRecorder } from '../tml/runtime/trace.mjs';
import {
  createTmlEvidence,
  createTmlVerification,
  evaluateTmlExpression,
  verifyTmlTransition
} from '../tml/runtime/verification.mjs';

const PROFILE = JSON.parse(readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8'));
const MODULE = JSON.parse(readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8'));
const NOW = '2026-10-03T10:30:00+09:00';
const SUBJECT = 'quest.campus_navigation_intro_v1';

function example(value = { type: 'number', value: 5 }) {
  const fact = {
    kind: 'fact', id: 'fact.stage', subject: SUBJECT, predicate: 'quest.stage',
    value: structuredClone(value), source: 'server.quest', observed_at: NOW,
    confidence: 1, extensions: { observation_sequence: 1 }
  };
  const observation = {
    kind: 'observation', id: 'observation.stage', source: 'server.quest', observed_at: NOW,
    query: { subject: SUBJECT, predicate: 'quest.stage' }, facts: [fact.id],
    extensions: { observation_sequence: 1 }
  };
  return {
    claim: { op: 'eq', subject: SUBJECT, predicate: 'quest.stage', value: structuredClone(value) },
    profile: structuredClone(PROFILE), facts: [fact], observations: [observation]
  };
}

function replay(evidence) {
  const { inputs } = evidence.extensions.evaluation;
  return evaluateTmlExpression(inputs.claim, inputs.facts, inputs.profile);
}

test('D13 evidence owns the claim, full read pool, profile, and evaluation result', () => {
  const source = example();
  const built = createTmlEvidence(source);
  const capture = built.evidence.extensions?.evaluation;
  assert.ok(capture, 'evidence must retain the inputs that produced its verdict');
  assert.equal(capture.basis, 'CLAIM');
  assert.equal(capture.evaluator, 'tml.expression.v0.1');
  assert.equal(built.evaluation.status, 'SATISFIED');
  const original = structuredClone(built);

  for (const value of [source.claim, source.claim.value, source.facts[0], source.observations[0], source.profile]) {
    assert.equal(Object.isFrozen(value), false, 'ownership must not freeze caller data');
  }
  source.claim.value.value = 6;
  source.facts[0].value.value = 7;
  source.facts[0].source = 'world.client';
  source.facts[0].observed_at = '2027-01-01T00:00:00Z';
  source.facts[0].extensions.observation_sequence = 999;
  source.observations[0].query.predicate = 'quest.available';
  source.observations[0].facts.push('fact.invented');
  source.observations[0].extensions.observation_sequence = 999;
  source.profile.authority.find((rule) => rule.predicate === 'quest.stage').authority = 'world.client';
  source.facts.push(example().facts[0]);
  source.observations.length = 0;

  assert.deepEqual(built, original);
  assert.deepEqual(replay(built.evidence), built.evaluation);
  assert.deepEqual(capture.result, built.evaluation);
  assert.throws(() => built.evaluation.factIds.push('fact.invented'), TypeError);
  assert.throws(() => capture.inputs.facts[0].value.value = 99, TypeError);
  assert.throws(() => built.evidence.claim.value.value = 99, TypeError);
});

test('D13 captured historical candidates reproduce the latest-snapshot evaluation', () => {
  const source = example();
  const historical = structuredClone(source.facts[0]);
  historical.id = 'fact.historical';
  historical.value.value = 4;
  historical.observed_at = '2026-10-03T10:29:59+09:00';
  source.facts.unshift(historical);
  const built = createTmlEvidence(source);

  assert.equal(built.evaluation.status, 'SATISFIED');
  assert.deepEqual(built.evaluation.factIds, ['fact.stage']);
  assert.equal(built.evidence.extensions.evaluation.inputs.facts.length, 2);
  historical.observed_at = '2027-01-01T00:00:00Z';
  source.facts[1].value.value = 4;
  assert.deepEqual(replay(built.evidence), built.evaluation);
});

test('D13 genuine conflict capture remains reproducible after caller mutation', () => {
  const source = example();
  const contradictory = structuredClone(source.facts[0]);
  contradictory.id = 'fact.contradictory';
  contradictory.value.value = 6;
  source.facts.push(contradictory);
  const built = createTmlEvidence(source);

  assert.equal(built.evaluation.status, 'CONFLICT');
  contradictory.value.value = 5;
  source.facts.length = 0;
  assert.deepEqual(replay(built.evidence), built.evaluation);
  assert.deepEqual(built.evaluation.factIds, ['fact.stage', 'fact.contradictory']);
});

test('D12 equivalent nested authoritative objects do not produce false conflict', () => {
  const value = { type: 'object', value: {
    count: { type: 'number', value: 5 },
    nested: { type: 'object', value: { label: { type: 'string', value: 'five' }, enabled: { type: 'boolean', value: true } } }
  } };
  const source = example(value);
  const equivalent = structuredClone(source.facts[0]);
  equivalent.id = 'fact.equivalent';
  equivalent.value = { value: {
    nested: { value: { enabled: { value: true, type: 'boolean' }, label: { value: 'five', type: 'string' } }, type: 'object' },
    count: { value: 5, type: 'number' }
  }, type: 'object' };
  source.facts.push(equivalent);

  const built = createTmlEvidence(source);
  assert.equal(built.evaluation.status, 'SATISFIED');
  assert.deepEqual(replay(built.evidence), built.evaluation);

  equivalent.value.value.count.value = 6;
  assert.equal(createTmlEvidence(source).evaluation.status, 'CONFLICT');
});

test('D12 number member order is irrelevant while list order remains significant', () => {
  const source = example();
  source.facts[0].value = { value: 5, type: 'number' };
  assert.equal(createTmlEvidence(source).evaluation.status, 'SATISFIED');

  const list = example({ type: 'list', value: [{ type: 'number', value: 5 }, { type: 'string', value: 'five' }] });
  list.facts[0].value.value.reverse();
  assert.equal(createTmlEvidence(list).evaluation.status, 'UNSATISFIED');
});

test('D12 malformed expected or observed typed values fail closed', () => {
  for (const target of ['claim', 'fact']) {
    const source = example();
    const record = target === 'claim' ? source.claim : source.facts[0];
    record.value = { type: 'number', value: '5' };
    assert.throws(() => createTmlEvidence(source), { code: 'INVALID_TML_VALUE' });
  }
});

test('D12 capture cannot omit hidden malformed fields before typed-value validation', () => {
  for (const target of ['claim', 'fact']) {
    const source = example();
    const record = target === 'claim' ? source.claim : source.facts[0];
    Object.defineProperty(record.value, 'hidden', { value: 'invalid typed member', enumerable: false });
    assert.throws(() => evaluateTmlExpression(source.claim, source.facts, source.profile), /hidden/);
    assert.throws(() => createTmlEvidence(source), /hidden/);
    assert.throws(() => verifyTmlTransition({
      ...source,
      transition: { id: 'transition.hidden', postcondition: source.claim },
      checkedAt: NOW
    }), /hidden/);
  }

  const built = createTmlEvidence(example());
  const malformedEvidence = structuredClone(built.evidence);
  Object.defineProperty(malformedEvidence, 'hidden', { value: 'invalid record member', enumerable: false });
  assert.throws(() => createTmlVerification({
    transitionId: 'transition.hidden', evidence: malformedEvidence, status: 'SATISFIED', checkedAt: NOW
  }), /hidden/);
});

test('D12 time equality remains lexical and relational comparison keeps existing time interpretation', () => {
  const source = example({ type: 'time', value: '2026-10-03T01:30:00Z' });
  source.facts[0].value.value = NOW;
  assert.equal(createTmlEvidence(source).evaluation.status, 'UNSATISFIED');
  source.claim.op = 'gte';
  assert.equal(createTmlEvidence(source).evaluation.status, 'SATISFIED');
});

test('D06 evidence rejects conflicting duplicate record identities and dangling observations', () => {
  const conflicting = example();
  const duplicate = structuredClone(conflicting.facts[0]);
  duplicate.value.value = 6;
  conflicting.facts.push(duplicate);
  assert.throws(() => createTmlEvidence(conflicting), /duplicate|conflict/i);

  const dangling = example();
  dangling.observations[0].facts.push('fact.missing');
  assert.throws(() => createTmlEvidence(dangling), /reference|resolve|missing|dangling/i);

  const wrongKind = example();
  wrongKind.observations[0].facts = [wrongKind.observations[0].id];
  assert.throws(() => createTmlEvidence(wrongKind), /reference|kind|fact/i);
});

test('D06 evidence deduplicates only identical supplied records', () => {
  const source = example();
  source.facts.push(structuredClone(source.facts[0]));
  source.observations.push(structuredClone(source.observations[0]));
  const built = createTmlEvidence(source);

  assert.equal(built.evaluation.status, 'SATISFIED');
  assert.equal(built.evidence.extensions.evaluation.inputs.facts.length, 1);
  assert.equal(built.evidence.extensions.evaluation.inputs.observations.length, 1);
  assert.deepEqual(replay(built.evidence), built.evaluation);
});

test('D06 default evidence identity distinguishes formerly aliased claims and independent record pools', () => {
  const one = example();
  const two = example();
  one.claim.subject = one.facts[0].subject = one.observations[0].query.subject = 'key:a';
  two.claim.subject = two.facts[0].subject = two.observations[0].query.subject = 'key/a';
  const first = createTmlEvidence(one);
  const second = createTmlEvidence(two);
  assert.notEqual(first.evidence.id, second.evidence.id);
  assert.equal(first.evidence.id, createTmlEvidence(structuredClone(one)).evidence.id);

  const differentClaim = structuredClone(one);
  differentClaim.claim.value.value = 6;
  assert.notEqual(first.evidence.id, createTmlEvidence(differentClaim).evidence.id);

  const otherPool = structuredClone(one);
  otherPool.facts[0].id = 'fact.other';
  otherPool.observations[0].facts = ['fact.other'];
  assert.notEqual(first.evidence.id, createTmlEvidence(otherPool).evidence.id);
});

test('D06 transition evidence and verification identities retain phase, time, and record context', () => {
  const source = example();
  const transition = { id: 'key:a', precondition: source.claim, postcondition: source.claim };
  const options = { ...source, transition, checkedAt: NOW, phase: 'precondition', recordContext: [MODULE.id, 'user', 'key:a'] };
  const first = verifyTmlTransition(options);
  const equivalent = verifyTmlTransition(structuredClone(options));
  assert.equal(first.evidence.id, equivalent.evidence.id);
  assert.equal(first.verification.id, equivalent.verification.id);

  const variants = [
    { ...options, transition: { ...transition, id: 'key/a' } },
    { ...options, phase: 'postcondition' },
    { ...options, checkedAt: '2026-10-03T10:30:01+09:00' },
    { ...options, recordContext: [MODULE.id, 'user', 'key/a'] }
  ];
  for (const variant of variants) {
    const result = verifyTmlTransition(variant);
    assert.notEqual(first.evidence.id, result.evidence.id);
    assert.notEqual(first.verification.id, result.verification.id);
  }
  assert.deepEqual(first.evidence.extensions.evaluation.inputs.recordContext, options.recordContext);

  const missingRead = { ...options, facts: [], observations: [] };
  const unknownOne = verifyTmlTransition(missingRead);
  const unknownTwo = verifyTmlTransition({ ...missingRead, recordContext: [MODULE.id, 'user', 'key/a'] });
  assert.equal(unknownOne.status, 'UNKNOWN');
  assert.equal(unknownTwo.status, 'UNKNOWN');
  assert.notEqual(unknownOne.evidence.id, unknownTwo.evidence.id);
  assert.notEqual(unknownOne.verification.id, unknownTwo.verification.id);
});

test('D13 omitted precondition is recorded explicitly without a fabricated fact claim', () => {
  const transition = structuredClone(MODULE.transitions[0]);
  delete transition.precondition;
  const profile = structuredClone(PROFILE);
  const result = verifyTmlTransition({ transition, profile, checkedAt: NOW, phase: 'precondition' });

  assert.equal(result.status, 'SATISFIED');
  assert.equal(result.reason, 'NO_CONDITION');
  assert.equal(result.evidence, null);
  assert.deepEqual(result.verification.evidence, []);
  const capture = result.verification.extensions.evaluation;
  assert.equal(capture.basis, 'NO_PRECONDITION');
  assert.equal(capture.inputs.phase, 'precondition');
  assert.equal(Object.hasOwn(capture.inputs.transition, 'precondition'), false);
  assert.deepEqual(capture.result, { status: 'SATISFIED', factIds: [], reason: 'NO_CONDITION' });
  assert.equal(JSON.stringify(result).includes('__implicit_true__'), false);

  transition.precondition = { op: 'exists', subject: SUBJECT, predicate: 'quest.stage' };
  profile.authority.length = 0;
  const replayed = verifyTmlTransition({ ...capture.inputs, checkedAt: NOW });
  assert.equal(replayed.status, 'SATISFIED');
  assert.equal(replayed.evidence, null);
  assert.equal(Object.isFrozen(transition), false);

  const recorder = createTmlTraceRecorder({ id: 'trace.no-precondition', module: MODULE.id, profile: PROFILE.id, startedAt: NOW });
  recorder.appendVerificationResult(result);
  const trace = recorder.close(NOW);
  assert.equal(trace.records.length, 1);
  assert.equal(trace.records[0].kind, 'verification');
  assert.deepEqual(trace.records[0], result.verification);
});

test('missing postcondition and malformed present precondition do not acquire implicit truth', () => {
  for (const options of [
    { transition: { id: 'transition.missing' }, phase: 'postcondition' },
    { transition: { id: 'transition.null', precondition: null }, phase: 'precondition' }
  ]) {
    assert.throws(() => verifyTmlTransition({ ...options, profile: PROFILE, checkedAt: NOW }), /condition/);
  }
});

test('verification rejects missing ordinary evidence and a verdict contrary to captured evaluation', () => {
  const built = createTmlEvidence(example());
  assert.throws(() => createTmlVerification({ transitionId: 'transition.test', evidence: null, status: 'SATISFIED', checkedAt: NOW }), /evidence/);
  assert.throws(() => createTmlVerification({ transitionId: 'transition.test', evidence: built.evidence, status: 'UNSATISFIED', checkedAt: NOW }), /status|evaluation|verdict/);
  for (const id of ['', 7, {}]) {
    assert.throws(() => createTmlVerification({ id, transitionId: 'transition.test', evidence: built.evidence, status: 'SATISFIED', checkedAt: NOW }), /id/);
  }
});

test('direct evaluator results own and freeze their selected fact references', () => {
  const source = example();
  const result = evaluateTmlExpression(source.claim, source.facts, source.profile);
  assert.equal(result.status, 'SATISFIED');
  assert.throws(() => result.factIds.push('fact.invented'), TypeError);
  source.facts[0].id = 'fact.changed';
  assert.deepEqual(result.factIds, ['fact.stage']);
});
