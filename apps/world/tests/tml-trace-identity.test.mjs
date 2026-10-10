import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTmlRecordReferences,
  createTmlRecordId,
  createTmlTraceRecorder,
  snapshotTmlRecords
} from '../tml/runtime/trace.mjs';

const NOW = '2026-10-03T10:30:00+09:00';
const END = '2026-10-03T10:30:01+09:00';

function fact(id = 'fact.stage') {
  return {
    kind: 'fact', id, subject: 'quest.example', predicate: 'quest.stage',
    value: { type: 'object', value: { stage: { type: 'number', value: 4 } } },
    source: 'server.quest', observed_at: NOW,
    extensions: { observation_sequence: 1 }
  };
}

function observation(id = 'observation.stage', factId = 'fact.stage') {
  return {
    kind: 'observation', id, source: 'server.quest', observed_at: NOW,
    query: { subject: 'quest.example', predicate: 'quest.stage' }, facts: [factId]
  };
}

function evidence() {
  return {
    kind: 'evidence', id: 'evidence.stage',
    claim: { op: 'eq', subject: 'quest.example', predicate: 'quest.stage', value: fact().value },
    observations: ['observation.stage'], facts: ['fact.stage']
  };
}

function verification() {
  return {
    kind: 'verification', id: 'verification.stage', transition: 'transition.example',
    evidence: ['evidence.stage'], status: 'SATISFIED', checked_at: NOW
  };
}

function recorder() {
  return createTmlTraceRecorder({ id: 'trace.example', module: 'module.example', profile: 'profile.example', startedAt: NOW });
}

function noPreconditionVerification() {
  return {
    ...verification(), evidence: [],
    extensions: {
      evaluation: {
        basis: 'NO_PRECONDITION', evaluator: 'tml.expression.v0.1',
        inputs: { transition: { id: 'transition.example' }, profile: { id: 'profile.example' }, phase: 'precondition' },
        result: { status: 'SATISFIED', factIds: [], reason: 'NO_CONDITION' }
      }
    }
  };
}

test('D06 record identity retains punctuation, tuple boundaries, types, and lexical timestamps', () => {
  for (const [left, right] of [
    [['action', 'key:a'], ['action', 'key/a']],
    [['a/b'], ['a-b']],
    [['a.b', 'c'], ['a', 'b.c']],
    [[1], ['1']],
    [[NOW], ['2026-10-03T10:30:00-09:00']]
  ]) {
    assert.notEqual(createTmlRecordId('record', left), createTmlRecordId('record', right));
  }
  const tuple = ['action', { b: 2, a: 1 }];
  assert.equal(createTmlRecordId('record', tuple), createTmlRecordId('record', ['action', { a: 1, b: 2 }]));
  assert.notEqual(createTmlRecordId('fact', ['same']), createTmlRecordId('observation', ['same']));
  assert.notEqual(createTmlRecordId('record', [1, 2]), createTmlRecordId('record', [2, 1]));
  assert.throws(() => createTmlRecordId('', []), /identity/);
  assert.throws(() => createTmlRecordId('record:other', []), /colon-free/);
  assert.throws(() => createTmlRecordId('record', 'key'), /identity/);
});

test('record and batch admission rejects hidden properties before ownership can omit them', () => {
  const hiddenFact = fact();
  Object.defineProperty(hiddenFact.value, 'extra', { value: true });
  assert.throws(() => snapshotTmlRecords([hiddenFact]), /hidden properties/);
  const trace = recorder();
  assert.throws(() => trace.append(hiddenFact), /hidden properties/);
  assert.throws(() => trace.appendReadResult({ observations: [observation()], facts: [hiddenFact] }), /hidden properties/);
  const hiddenEvidence = evidence();
  Object.defineProperty(hiddenEvidence.claim, 'extra', { value: true });
  assert.throws(() => trace.appendVerificationResult({ evidence: hiddenEvidence, verification: verification() }), /hidden properties/);
  assert.equal(trace.snapshot().records.length, 0);
});

test('D06 exact semantic duplicate records deduplicate and conflicting IDs reject across kinds', () => {
  const original = fact();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  const records = snapshotTmlRecords([original, reordered]);
  assert.equal(records.length, 1);
  assert.notEqual(records[0], original);
  const different = fact();
  different.value.value.stage.value = 5;
  assert.throws(() => snapshotTmlRecords([original, different]), { code: 'TML_DUPLICATE_RECORD_ID' });
  assert.throws(() => snapshotTmlRecords([original, observation(original.id)]), { code: 'TML_DUPLICATE_RECORD_ID' });
});

test('D06 read batches accept observations before facts and duplicate imports remain unambiguous', () => {
  const trace = recorder();
  const read = { observations: [observation()], facts: [fact()] };
  trace.appendReadResult(read);
  trace.appendReadResult(read);
  trace.appendVerificationResult({ evidence: evidence(), verification: verification() });
  const closed = trace.close(END);
  assert.deepEqual(closed.records.map((record) => record.kind), ['observation', 'fact', 'evidence', 'verification']);
  assert.equal(new Set(closed.records.map((record) => record.id)).size, closed.records.length);
  assert.doesNotThrow(() => assertTmlRecordReferences(closed.records));
});

test('D06 failed read/batch/verification insertion is atomic', () => {
  const trace = recorder();
  trace.append(fact());
  const baseline = trace.snapshot();
  const conflicting = fact();
  conflicting.value.value.stage.value = 5;
  assert.throws(() => trace.appendBatch([fact('fact.new'), conflicting]), { code: 'TML_DUPLICATE_RECORD_ID' });
  assert.deepEqual(trace.snapshot(), baseline);
  assert.throws(() => trace.appendReadResult({
    observations: [observation('observation.new', 'fact.new')], facts: [fact('fact.new'), conflicting]
  }), { code: 'TML_DUPLICATE_RECORD_ID' });
  assert.deepEqual(trace.snapshot(), baseline);
  assert.throws(() => trace.appendReadResult({ observations: [observation('observation.missing', 'fact.missing')], facts: [] }),
    { code: 'TML_RECORD_REFERENCE_MISSING' });
  assert.deepEqual(trace.snapshot(), baseline);
  assert.throws(() => trace.appendVerificationResult({ evidence: evidence(), verification: { ...verification(), id: 'fact.stage' } }),
    { code: 'TML_DUPLICATE_RECORD_ID' });
  assert.deepEqual(trace.snapshot(), baseline);
});

test('D06 final closure rejects dangling references while retaining an incomplete recoverable snapshot', () => {
  const trace = recorder();
  trace.append(observation());
  assert.throws(() => trace.close(END), { code: 'TML_RECORD_REFERENCE_MISSING' });
  const partial = trace.snapshot();
  assert.equal(partial.records.length, 1);
  assert.equal(Object.hasOwn(partial, 'ended_at'), false);
  trace.append(fact());
  assert.equal(trace.close(END).ended_at, END);
  assert.throws(() => trace.append(fact('fact.late')), /already closed/);
});

test('D06 closure checks every internal edge and rejects wrong target kinds or malformed reference arrays', () => {
  const full = [observation(), fact(), evidence(), verification()];
  const mutations = [
    (records) => { records[0].facts = ['missing']; },
    (records) => { records[2].facts = ['missing']; },
    (records) => { records[2].observations = ['missing']; },
    (records) => { records[3].evidence = ['missing']; }
  ];
  for (const mutate of mutations) {
    const records = structuredClone(full);
    mutate(records);
    assert.throws(() => assertTmlRecordReferences(records), { code: 'TML_RECORD_REFERENCE_MISSING' });
  }
  for (const [index, field, bad] of [
    [0, 'facts', 'fact.stage'], [2, 'facts', [5]], [2, 'observations', null], [3, 'evidence', {}]
  ]) {
    const records = structuredClone(full);
    records[index][field] = bad;
    assert.throws(() => assertTmlRecordReferences(records), { code: 'TML_RECORD_REFERENCE_INVALID' });
  }
  const wrongKind = structuredClone(full);
  wrongKind[2].facts = ['observation.stage'];
  assert.throws(() => assertTmlRecordReferences(wrongKind), { code: 'TML_RECORD_REFERENCE_KIND' });
});

test('trace closure treats module/profile/action/domain identities as external references', () => {
  const trace = recorder();
  trace.appendBatch([
    observation(), fact(), evidence(), verification(),
    {
      kind: 'action', id: 'action.execution', call: 'module.action', capability: 'world.quest.advance',
      execution_key: 'requested-key', requested_at: NOW, status: 'REQUESTED'
    }
  ]);
  assert.equal(trace.close(END).records.length, 5);
});

test('D13 trace and record snapshots own nested facts, observations, caller arrays, and returned append values', () => {
  const trace = recorder();
  const inputFact = fact();
  const inputObservation = observation();
  const read = { observations: [inputObservation], facts: [inputFact] };
  trace.appendReadResult(read);
  const appended = trace.append(inputFact);
  assert.notEqual(appended, inputFact);
  assert.equal(Object.isFrozen(inputFact), false);
  assert.equal(Object.isFrozen(inputFact.value.value), false);
  inputFact.value.value.stage.value = 999;
  inputObservation.query.subject = 'quest.changed';
  inputObservation.facts.push('fact.changed');
  read.facts.push(fact('fact.added'));
  const closed = trace.close(END);
  read.observations.length = 0;
  read.facts.length = 0;
  assert.equal(closed.records.length, 2);
  assert.equal(closed.records[1].value.value.stage.value, 4);
  assert.equal(closed.records[0].query.subject, 'quest.example');
  assert.deepEqual(closed.records[0].facts, ['fact.stage']);
  assert.equal(appended.value.value.stage.value, 4);
  assert.equal(Object.isFrozen(closed.records), true);
  assert.equal(Object.isFrozen(closed.records[1].value.value.stage), true);
  assert.throws(() => { closed.records[1].value.value.stage.value = 123; }, TypeError);
});

test('NO_PRECONDITION is the explicit evidence-free satisfied verification basis', () => {
  const trace = recorder();
  const input = noPreconditionVerification();
  trace.appendVerificationResult({ evidence: null, verification: input });
  input.extensions.evaluation.inputs.transition.id = 'transition.changed';
  const closed = trace.close(END);
  assert.equal(closed.records.length, 1);
  assert.equal(closed.records[0].extensions.evaluation.inputs.transition.id, 'transition.example');
  assert.deepEqual(closed.records[0].evidence, []);
  assert.equal(closed.records.some((record) => record.kind === 'evidence'), false);
  assert.throws(() => recorder().appendVerificationResult({ evidence: null, verification: { ...verification(), evidence: [] } }),
    { code: 'TML_RECORD_REFERENCE_MISSING' });
});

test('NO_PRECONDITION cannot conceal a present condition, wrong transition, phase, or recorded result', () => {
  for (const mutate of [
    (record) => { record.extensions.evaluation.inputs.transition.precondition = { op: 'exists', subject: 'quest.example', predicate: 'quest.stage' }; },
    (record) => { record.extensions.evaluation.inputs.transition.id = 'transition.other'; },
    (record) => { record.extensions.evaluation.inputs.phase = 'postcondition'; },
    (record) => { record.extensions.evaluation.result.factIds = ['fabricated']; },
    (record) => { record.extensions.evaluation.result.status = 'UNKNOWN'; },
    (record) => { record.status = 'UNKNOWN'; }
  ]) {
    const record = noPreconditionVerification();
    mutate(record);
    assert.throws(() => recorder().appendVerificationResult({ evidence: null, verification: record }),
      { code: 'TML_NO_PRECONDITION_INVALID' });
  }
});
