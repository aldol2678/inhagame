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
