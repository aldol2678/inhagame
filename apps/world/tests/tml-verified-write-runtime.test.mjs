import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalQuestStore } from '../npc-factory/quest-store.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import {
  createTmlVerifiedWriteCapabilityRegistry
} from '../tml/runtime/capability-registry.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import {
  executeTmlVerifiedWriteTransition,
  TML_P5_DISPOSITION
} from '../tml/runtime/verified-write-runtime.mjs';
import {
  evaluateTmlExpression,
  TML_VERIFICATION_STATUS
} from '../tml/runtime/verification.mjs';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

const TRANSITION_ID = 'transition.inha-world.campus_navigation_intro_v1.4_to_5';
const ACTION_ID = 'call.inha-world.campus_navigation_intro_v1.resume_auto_building5';
const QUEST_REF = `quest.${MAIN2_QUEST_ID}`;
const USER_ID = 'tml-p5-user';
const NOW = '2026-10-03T10:50:00+09:00';

const transition = moduleFixture.transitions.find((item) => item.id === TRANSITION_ID);
const action = transition.actions.find((item) => item.id === ACTION_ID);

async function prepareLocalStoreAtStage4() {
  const store = createLocalQuestStore();
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) {
    await store(USER_ID, event);
  }
  for (const event of ['start', 'set_building5_destination', 'start_auto_building5', 'pause_auto_building5']) {
    await store(USER_ID, event, MAIN2_QUEST_ID);
  }
  const status = await store(USER_ID, 'status', MAIN2_QUEST_ID);
  assert.equal(status.stage, 4);
  assert.equal(status.available, true);
  return store;
}

function adapters(questStore) {
  return {
    readAdapter: createTmlQuestReadAdapter({ questStore, now: () => NOW }),
    advanceAdapter: createTmlQuestAdvanceAdapter({ questStore, now: () => NOW })
  };
}

function executionOptions({ readAdapter, advanceAdapter }) {
  return {
    module: moduleFixture,
    profile,
    transitionId: TRANSITION_ID,
    actionId: ACTION_ID,
    context: { userId: USER_ID },
    readAdapter,
    advanceAdapter,
    traceId: 'trace.p5.4_to_5',
    now: () => NOW,
    createExecutionKey: () => 'exec.p5.4_to_5.1'
  };
}

function serverReadResult(stage, { available = true, sequence = 1, observedAt = NOW } = {}) {
  const stageFact = {
    kind: 'fact',
    id: `fact.server.stage.${stage}.${sequence}`,
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: stage },
    source: 'server.quest',
    observed_at: observedAt,
    confidence: 1,
    extensions: { observation_sequence: sequence }
  };
  const availableFact = {
    kind: 'fact',
    id: `fact.server.available.${sequence}`,
    subject: QUEST_REF,
    predicate: 'quest.available',
    value: { type: 'boolean', value: available },
    source: 'server.quest',
    observed_at: observedAt,
    confidence: 1,
    extensions: { observation_sequence: sequence }
  };
  return {
    observations: [
      {
        kind: 'observation',
        id: `obs.server.stage.${sequence}`,
        source: 'server.quest',
        observed_at: observedAt,
        query: { subject: QUEST_REF, predicate: 'quest.stage' },
        facts: [stageFact.id],
        extensions: { observation_sequence: sequence }
      },
      {
        kind: 'observation',
        id: `obs.server.available.${sequence}`,
        source: 'server.quest',
        observed_at: observedAt,
        query: { subject: QUEST_REF, predicate: 'quest.available' },
        facts: [availableFact.id],
        extensions: { observation_sequence: sequence }
      }
    ],
    facts: [stageFact, availableFact]
  };
}

test('P5 happy path performs exactly one write and verifies Main 2 stage 4 -> 5', async () => {
  const baseStore = await prepareLocalStoreAtStage4();
  let mutationCalls = 0;
  const questStore = async (userId, event, questId) => {
    if (event !== 'status') mutationCalls += 1;
    return baseStore(userId, event, questId);
  };
  const pair = adapters(questStore);

  const result = await executeTmlVerifiedWriteTransition(executionOptions(pair));

  assert.equal(result.disposition, TML_P5_DISPOSITION.VERIFIED);
  assert.equal(result.precondition, TML_VERIFICATION_STATUS.SATISFIED);
  assert.equal(result.provider.ok, true);
  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.SATISFIED);
  assert.equal(result.executionKey, 'exec.p5.4_to_5.1');
  assert.equal(mutationCalls, 1);
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);

  const actionRecords = result.trace.records.filter((record) => record.kind === 'action');
  assert.equal(actionRecords.length, 1);
  assert.equal(actionRecords[0].status, 'SUCCEEDED');
  assert.equal(actionRecords[0].execution_key, 'exec.p5.4_to_5.1');

  assert.deepEqual(
    result.trace.records.map((record) => record.kind),
    [
      'observation', 'observation', 'fact', 'fact', 'evidence', 'verification',
      'action',
      'observation', 'observation', 'fact', 'fact', 'evidence', 'verification'
    ]
  );

  const postStage = result.trace.records
    .filter((record) => record.kind === 'fact' && record.predicate === 'quest.stage')
    .at(-1);
  assert.equal(postStage.value.value, 5);
});

test('P5 precondition UNSATISFIED holds before execution and never calls provider', async () => {
  let mutationCalls = 0;
  const questStore = async (_userId, event, questId) => {
    if (event !== 'status') mutationCalls += 1;
    return { quest_id: questId, stage: 3, available: true };
  };
  const pair = adapters(questStore);

  const result = await executeTmlVerifiedWriteTransition(executionOptions(pair));

  assert.equal(result.disposition, TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.precondition, TML_VERIFICATION_STATUS.UNSATISFIED);
  assert.equal(result.provider, null);
  assert.equal(mutationCalls, 0);
  assert.equal(result.trace.records.some((record) => record.kind === 'action'), false);
});

test('P5 precondition UNKNOWN holds before execution when authoritative read fails', async () => {
  let mutationCalls = 0;
  const readAdapter = { async read() { throw Object.assign(new Error('read down'), { code: 'READ_DOWN' }); } };
  const advanceAdapter = {
    async advance() {
      mutationCalls += 1;
      throw new Error('must not run');
    }
  };

  const result = await executeTmlVerifiedWriteTransition(executionOptions({ readAdapter, advanceAdapter }));

  assert.equal(result.disposition, TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.precondition, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.preReadError.code, 'READ_DOWN');
  assert.equal(result.dispatchStatus, 'NOT_ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(mutationCalls, 0);
});

test('P5 precondition CONFLICT holds before execution', async () => {
  let mutationCalls = 0;
  const base = serverReadResult(4);
  const conflicting = {
    ...base.facts[0],
    id: 'fact.server.stage.conflict',
    value: { type: 'number', value: 5 }
  };
  const readAdapter = {
    async read() {
      return {
        observations: [
          ...base.observations,
          {
            kind: 'observation',
            id: 'obs.server.stage.conflict',
            source: 'server.quest',
            observed_at: NOW,
            query: { subject: QUEST_REF, predicate: 'quest.stage' },
            facts: [conflicting.id],
            extensions: { observation_sequence: 1 }
          }
        ],
        facts: [...base.facts, conflicting]
      };
    }
  };
  const advanceAdapter = {
    async advance() {
      mutationCalls += 1;
      return { ok: true };
    }
  };

  const result = await executeTmlVerifiedWriteTransition(executionOptions({ readAdapter, advanceAdapter }));

  assert.equal(result.disposition, TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.precondition, TML_VERIFICATION_STATUS.CONFLICT);
  assert.equal(mutationCalls, 0);
});

test('P5 provider success without state change is VERIFICATION_FAILED', async () => {
  let state = 4;
  let mutationCalls = 0;
  const questStore = async (_userId, event, questId) => {
    if (event === 'status') return { quest_id: questId, stage: state, available: true };
    mutationCalls += 1;
    return { quest_id: questId, stage: state, available: true };
  };
  const pair = adapters(questStore);

  const result = await executeTmlVerifiedWriteTransition(executionOptions(pair));

  assert.equal(mutationCalls, 1);
  assert.equal(result.provider.ok, true);
  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.UNSATISFIED);
  assert.equal(result.disposition, TML_P5_DISPOSITION.VERIFICATION_FAILED);
});

test('P5 timeout after committed state verifies by readback and does not retry', async () => {
  let state = 4;
  let mutationCalls = 0;
  const questStore = async (_userId, event, questId) => {
    if (event === 'status') return { quest_id: questId, stage: state, available: true };
    mutationCalls += 1;
    state = 5;
    throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' });
  };
  const pair = adapters(questStore);

  const result = await executeTmlVerifiedWriteTransition(executionOptions(pair));

  assert.equal(mutationCalls, 1);
  assert.equal(result.provider.ok, false);
  assert.equal(result.provider.error.code, 'ETIMEDOUT');
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.attempt.providerReturned, false);
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.SATISFIED);
  assert.equal(result.disposition, TML_P5_DISPOSITION.VERIFIED);
  assert.equal(result.trace.records.filter((record) => record.kind === 'action').length, 1);
  assert.equal(result.trace.records.find((record) => record.kind === 'action').status, 'FAILED');
});

test('P5 timeout without observed state change remains EXECUTION_OUTCOME_UNKNOWN and never retries', async () => {
  let mutationCalls = 0;
  const questStore = async (_userId, event, questId) => {
    if (event === 'status') return { quest_id: questId, stage: 4, available: true };
    mutationCalls += 1;
    throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' });
  };
  const pair = adapters(questStore);

  const result = await executeTmlVerifiedWriteTransition(executionOptions(pair));

  assert.equal(mutationCalls, 1);
  assert.equal(result.provider.ok, false);
  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.UNSATISFIED);
  assert.equal(result.disposition, TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN);
});

test('P5 provider success with post-read failure is EXECUTED_UNVERIFIED', async () => {
  let reads = 0;
  let mutationCalls = 0;
  const readAdapter = {
    async read() {
      reads += 1;
      if (reads === 1) return serverReadResult(4);
      throw Object.assign(new Error('readback unavailable'), { code: 'READBACK_DOWN' });
    }
  };
  const advanceAdapter = {
    async advance({ executionKey }) {
      mutationCalls += 1;
      return {
        ok: true,
        executionKey,
        requestedAt: NOW,
        completedAt: NOW,
        output: { quest_id: MAIN2_QUEST_ID, stage: 5, available: true }
      };
    }
  };

  const result = await executeTmlVerifiedWriteTransition(executionOptions({ readAdapter, advanceAdapter }));

  assert.equal(mutationCalls, 1);
  assert.equal(result.provider.ok, true);
  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.postReadError.code, 'READBACK_DOWN');
  assert.equal(result.disposition, TML_P5_DISPOSITION.EXECUTED_UNVERIFIED);
});

test('P5 client-only post fact cannot produce VERIFIED', async () => {
  let reads = 0;
  const readAdapter = {
    async read() {
      reads += 1;
      if (reads === 1) return serverReadResult(4);
      const clientFact = {
        kind: 'fact',
        id: 'fact.client.stage5',
        subject: QUEST_REF,
        predicate: 'quest.stage',
        value: { type: 'number', value: 5 },
        source: 'world.client',
        observed_at: NOW,
        confidence: 1,
        extensions: { observation_sequence: 2 }
      };
      return {
        observations: [{
          kind: 'observation',
          id: 'obs.client.stage5',
          source: 'world.client',
          observed_at: NOW,
          query: { subject: QUEST_REF, predicate: 'quest.stage' },
          facts: [clientFact.id],
          extensions: { observation_sequence: 2 }
        }],
        facts: [clientFact]
      };
    }
  };
  const advanceAdapter = {
    async advance({ executionKey }) {
      return {
        ok: true,
        executionKey,
        requestedAt: NOW,
        completedAt: NOW,
        output: { quest_id: MAIN2_QUEST_ID, stage: 5, available: true }
      };
    }
  };

  const result = await executeTmlVerifiedWriteTransition(executionOptions({ readAdapter, advanceAdapter }));

  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.disposition, TML_P5_DISPOSITION.EXECUTED_UNVERIFIED);
});

test('P5 same latest authoritative snapshot conflict remains EXECUTED_UNVERIFIED', async () => {
  let reads = 0;
  const readAdapter = {
    async read() {
      reads += 1;
      if (reads === 1) return serverReadResult(4);
      const post = serverReadResult(5, { sequence: 2 });
      const conflict = {
        ...post.facts[0],
        id: 'fact.server.stage6.same-snapshot',
        value: { type: 'number', value: 6 }
      };
      return {
        observations: [
          ...post.observations,
          {
            kind: 'observation',
            id: 'obs.server.stage6.same-snapshot',
            source: 'server.quest',
            observed_at: NOW,
            query: { subject: QUEST_REF, predicate: 'quest.stage' },
            facts: [conflict.id],
            extensions: { observation_sequence: 2 }
          }
        ],
        facts: [...post.facts, conflict]
      };
    }
  };
  const advanceAdapter = {
    async advance({ executionKey }) {
      return {
        ok: true,
        executionKey,
        requestedAt: NOW,
        completedAt: NOW,
        output: { quest_id: MAIN2_QUEST_ID, stage: 5, available: true }
      };
    }
  };

  const result = await executeTmlVerifiedWriteTransition(executionOptions({ readAdapter, advanceAdapter }));

  assert.equal(result.postcondition, TML_VERIFICATION_STATUS.CONFLICT);
  assert.equal(result.disposition, TML_P5_DISPOSITION.EXECUTED_UNVERIFIED);
});

test('P5 same-millisecond P3 reads remain distinct and latest sequence wins', async () => {
  let stage = 4;
  const adapter = createTmlQuestReadAdapter({
    questStore: async (_userId, _event, questId) => ({ quest_id: questId, stage, available: true }),
    now: () => NOW
  });

  const first = await adapter.read({ userId: USER_ID, questRef: QUEST_REF });
  stage = 5;
  const second = await adapter.read({ userId: USER_ID, questRef: QUEST_REF });

  assert.equal(first.observedAt, second.observedAt);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.notEqual(first.facts[0].id, second.facts[0].id);

  const claim = {
    op: 'eq',
    subject: QUEST_REF,
    predicate: 'quest.stage',
    value: { type: 'number', value: 5 }
  };
  const evaluation = evaluateTmlExpression(claim, [...first.facts, ...second.facts], profile);
  assert.equal(evaluation.status, TML_VERIFICATION_STATUS.SATISFIED);
  assert.deepEqual(evaluation.factIds, [second.facts[0].id]);
});

test('P5 verified-write capability registry binds read + advance and rejects action-arg drift', async () => {
  const baseStore = await prepareLocalStoreAtStage4();
  const pair = adapters(baseStore);
  const registry = createTmlVerifiedWriteCapabilityRegistry({
    module: moduleFixture,
    profile,
    questReadAdapter: pair.readAdapter,
    questAdvanceAdapter: pair.advanceAdapter,
    now: () => NOW,
    createExecutionKey: () => 'exec.registry.1'
  });

  assert.equal(registry.mode, 'VERIFIED_WRITE_P5');
  assert.equal(registry.has('world.quest.read'), true);
  assert.equal(registry.has('world.quest.advance'), true);

  await assert.rejects(
    () => registry.invoke(
      'world.quest.advance',
      { ...action.args, event: { type: 'string', value: 'visit_back_gate' } },
      { userId: USER_ID, transitionId: TRANSITION_ID, actionId: ACTION_ID }
    ),
    (error) => error.code === 'ACTION_ARGUMENT_MISMATCH'
  );

  const result = await registry.invoke(
    'world.quest.advance',
    action.args,
    {
      userId: USER_ID,
      transitionId: TRANSITION_ID,
      actionId: ACTION_ID,
      traceId: 'trace.registry'
    }
  );
  assert.equal(result.disposition, TML_P5_DISPOSITION.VERIFIED);
});

function attemptHarness({ postRead, providerChange, runtimeNow = () => NOW, adapterNow } = {}) {
  const counts = { reads: 0, dispatches: 0, mutations: 0 };
  let stage = 4;
  const readAdapter = {
    async read() {
      counts.reads += 1;
      if (counts.reads > 1 && postRead) return postRead();
      return serverReadResult(stage, { sequence: counts.reads });
    }
  };
  const baseAdapter = adapterNow ? createTmlQuestAdvanceAdapter({
    now: adapterNow,
    questStore: async (_userId, _event, questId) => {
      counts.mutations += 1;
      stage = 5;
      return { quest_id: questId, stage, available: true };
    }
  }) : null;
  const advanceAdapter = {
    async advance(request) {
      counts.dispatches += 1;
      if (baseAdapter) return baseAdapter.advance(request);
      counts.mutations += 1;
      stage = 5;
      const response = {
        ok: true, executionKey: request.executionKey,
        requestedAt: NOW, completedAt: NOW,
        output: { quest_id: MAIN2_QUEST_ID, stage, available: true }
      };
      return providerChange ? providerChange(response) : response;
    }
  };
  return {
    counts,
    run: () => executeTmlVerifiedWriteTransition({ ...executionOptions({ readAdapter, advanceAdapter }), now: runtimeNow })
  };
}

test('D11b malformed successful post-reads retain one attempted mutation and pre-read evidence', async (t) => {
  const cases = [
    ['missing arrays', () => ({})],
    ['wrong array type', () => ({ observations: {}, facts: [] })],
    ['invalid typed fact', () => {
      const read = serverReadResult(5, { sequence: 2 });
      read.facts[0].value.value = '5';
      return read;
    }],
    ['copy failure', () => {
      const read = serverReadResult(5, { sequence: 2 });
      read.loop = read;
      return read;
    }],
    ['normalization failure', () => { throw Object.assign(new Error('read normalization failed'), { code: 'NORMALIZATION_FAILED' }); }]
  ];
  for (const [name, postRead] of cases) await t.test(name, async () => {
    const harness = attemptHarness({ postRead });
    const result = await harness.run();
    assert.deepEqual(harness.counts, { reads: 2, dispatches: 1, mutations: 1 });
    assert.equal(result.dispatchStatus, 'ATTEMPTED');
    assert.equal(result.attempt.requestedExecutionKey, 'exec.p5.4_to_5.1');
    assert.equal(result.provider.output.stage, 5);
    assert.equal(result.precondition, 'SATISFIED');
    assert.equal(result.postcondition, 'UNKNOWN');
    assert.equal(result.disposition, 'EXECUTED_UNVERIFIED');
    assert.ok(result.postReadError.code);
    assert.equal(result.reads.precondition.facts[0].value.value, 4);
    assert.equal(result.reads.postcondition, null);
    assert.equal(result.trace.records.filter((record) => record.kind === 'action').length, 1);
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});

test('PR1 provider normalization failure retains raw response and does not mistake matching state for complete verification', async () => {
  let stage = 4;
  let mutations = 0;
  const questStore = async (_user, event, questId) => {
    if (event === 'status') return { quest_id: questId, stage, available: true };
    mutations += 1;
    stage = 5;
    return { quest_id: questId, stage: '5', available: true };
  };
  const result = await executeTmlVerifiedWriteTransition(executionOptions(adapters(questStore)));
  assert.equal(mutations, 1);
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.provider.ok, false);
  assert.equal(result.provider.response.stage, '5');
  assert.equal(result.postcondition, 'SATISFIED');
  assert.equal(result.disposition, 'EXECUTION_OUTCOME_UNKNOWN');
  assert.equal(result.diagnostic.code, 'QUEST_WRITE_INVALID_RESPONSE');
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('PR1 TML output conversion failure retains provider response and attempted work without a complete trace', async () => {
  const harness = attemptHarness({ providerChange: (response) => {
    response.output.unsupported = [undefined];
    return response;
  } });
  const result = await harness.run();
  assert.equal(harness.counts.dispatches, 1);
  assert.equal(harness.counts.mutations, 1);
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.provider.output.stage, 5);
  assert.deepEqual(result.provider.output.unsupported, [undefined]);
  assert.equal(result.postcondition, 'UNKNOWN');
  assert.equal(result.disposition, 'EXECUTED_UNVERIFIED');
  assert.equal(result.traceComplete, false);
  assert.equal(result.diagnostic.code, 'TypeError');
  assert.equal(result.reads.precondition.facts[0].value.value, 4);
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('PR1 post-dispatch clock and trace-finalization failures retain attempted work and admitted observations', async (t) => {
  for (const failAt of [4, 5]) await t.test(`clock call ${failAt}`, async () => {
    let ticks = 0;
    const harness = attemptHarness({ runtimeNow: () => {
      ticks += 1;
      if (ticks >= failAt) throw Object.assign(new Error('clock down'), { code: 'CLOCK_DOWN' });
      return NOW;
    } });
    const result = await harness.run();
    assert.deepEqual(harness.counts, { reads: 2, dispatches: 1, mutations: 1 });
    assert.equal(result.dispatchStatus, 'ATTEMPTED');
    assert.equal(result.provider.output.stage, 5);
    assert.equal(result.postcondition, failAt === 4 ? 'UNKNOWN' : 'SATISFIED');
    assert.equal(result.disposition, 'EXECUTED_UNVERIFIED');
    assert.equal(result.diagnostic.code, 'CLOCK_DOWN');
    assert.equal(result.traceComplete, false);
    assert.equal(Object.hasOwn(result.trace, 'ended_at'), false);
    assert.equal(result.reads.postcondition.facts[0].value.value, 5);
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});

test('PR1 built-in adapter retains precise dispatch knowledge across its own clock failures', async (t) => {
  for (const failAt of [1, 2]) await t.test(`adapter clock call ${failAt}`, async () => {
    let ticks = 0;
    const harness = attemptHarness({ adapterNow: () => {
      ticks += 1;
      if (ticks >= failAt) throw Object.assign(new Error('adapter clock down'), { code: 'ADAPTER_CLOCK_DOWN' });
      return NOW;
    } });
    const result = await harness.run();
    assert.equal(harness.counts.dispatches, 1);
    assert.equal(harness.counts.mutations, failAt === 1 ? 0 : 1);
    assert.equal(result.dispatchStatus, failAt === 1 ? 'NOT_ATTEMPTED' : 'ATTEMPTED');
    assert.equal(result.disposition, failAt === 1 ? 'HOLD_BEFORE_EXECUTION' : 'EXECUTION_OUTCOME_UNKNOWN');
    assert.equal(result.attempt.providerReturned, failAt !== 1);
    assert.equal(result.provider.completedAt, null);
    if (failAt === 2) assert.equal(result.provider.output.stage, 5);
    assert.equal(result.diagnostic.code, 'ADAPTER_CLOCK_DOWN');
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});

test('PR1 foreign execution keys remain diagnostic and cannot attribute a matching state to the requested execution', async () => {
  const harness = attemptHarness({ providerChange: (response) => ({ ...response, executionKey: 'foreign.execution' }) });
  const result = await harness.run();
  assert.deepEqual(harness.counts, { reads: 2, dispatches: 1, mutations: 1 });
  assert.equal(result.executionKey, 'exec.p5.4_to_5.1');
  assert.equal(result.attempt.requestedExecutionKey, result.executionKey);
  assert.equal(result.attempt.receivedExecutionKey, 'foreign.execution');
  assert.equal(result.provider.executionKey, 'foreign.execution');
  assert.equal(result.provider.identityMatched, false);
  assert.equal(result.postcondition, 'SATISFIED');
  assert.equal(result.disposition, 'EXECUTION_OUTCOME_UNKNOWN');
  const actionRecord = result.trace.records.find((record) => record.kind === 'action');
  assert.equal(actionRecord.execution_key, result.executionKey);
  assert.equal(actionRecord.status, 'REQUESTED');
  assert.equal(actionRecord.output, undefined);
  assert.equal(actionRecord.extensions.received_execution_key, 'foreign.execution');
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('PR1 malformed provider errors preserve attempts and produce valid diagnostic records without VERIFIED', async (t) => {
  for (const error of ['malformed-error', {}, { code: 'ERROR', message: 42 }]) await t.test(JSON.stringify(error), async () => {
    const harness = attemptHarness({ providerChange: (response) => ({ ...response, ok: false, error }) });
    const result = await harness.run();
    assert.deepEqual(harness.counts, { reads: 2, dispatches: 1, mutations: 1 });
    assert.equal(result.dispatchStatus, 'ATTEMPTED');
    assert.equal(result.provider.output.stage, 5);
    assert.deepEqual(result.provider.rawError, error);
    assert.equal(result.postcondition, 'SATISFIED');
    assert.equal(result.disposition, 'EXECUTION_OUTCOME_UNKNOWN');
    assert.equal(result.diagnostic.code, 'INVALID_PROVIDER_ERROR');
    assert.equal(typeof result.trace.records.find((record) => record.kind === 'action').error.code, 'string');
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});

test('PR1 contradictory or malformed NOT_ATTEMPTED envelopes remain UNKNOWN and still get readback', async (t) => {
  const variants = [
    { ok: true, providerReturned: true },
    { ok: false, providerReturned: true, error: { code: 'PROVIDER_ERROR' } },
    { ok: false, providerReturned: false, error: 'malformed-error' }
  ];
  for (const fields of variants) await t.test(JSON.stringify(fields), async () => {
    const harness = attemptHarness({ providerChange: (response) => ({ ...response, ...fields, dispatchStatus: 'NOT_ATTEMPTED' }) });
    const result = await harness.run();
    assert.deepEqual(harness.counts, { reads: 2, dispatches: 1, mutations: 1 });
    assert.equal(result.dispatchStatus, 'UNKNOWN');
    assert.equal(result.attempt.requestedExecutionKey, 'exec.p5.4_to_5.1');
    assert.equal(result.provider.output.stage, 5);
    assert.equal(result.postcondition, 'SATISFIED');
    assert.equal(result.disposition, 'EXECUTION_OUTCOME_UNKNOWN');
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});

test('PR1 parseable but non-schema timestamps cannot produce a complete verified trace', async () => {
  const before = attemptHarness({ runtimeNow: () => '2026-10-03' });
  const held = await before.run();
  assert.deepEqual(before.counts, { reads: 0, dispatches: 0, mutations: 0 });
  assert.equal(held.disposition, 'HOLD_BEFORE_EXECUTION');
  assert.equal(held.dispatchStatus, 'NOT_ATTEMPTED');
  assert.equal(held.traceComplete, false);

  const after = attemptHarness({ providerChange: (response) => ({ ...response, completedAt: '2026-10-03' }) });
  const attempted = await after.run();
  assert.deepEqual(after.counts, { reads: 2, dispatches: 1, mutations: 1 });
  assert.equal(attempted.postcondition, 'SATISFIED');
  assert.equal(attempted.disposition, 'EXECUTION_OUTCOME_UNKNOWN');
  assert.equal(attempted.provider.completedAt, null);
  assert.equal(attempted.automaticMutationRetryAllowed, false);
});
