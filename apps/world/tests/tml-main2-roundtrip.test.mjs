import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalQuestStore } from '../npc-factory/quest-store.mjs';
import { MAIN2_QUEST_EVENTS, MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import {
  executeTmlVerifiedWritePlan,
  TML_P6_PLAN_STATUS
} from '../tml/runtime/verified-write-plan.mjs';
import { TML_P5_DISPOSITION } from '../tml/runtime/verified-write-runtime.mjs';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

const USER_ID = 'tml-p6-user';
const QUEST_REF = `quest.${MAIN2_QUEST_ID}`;
const NOW = '2026-10-03T11:10:00+09:00';
const TRANSITION_IDS = moduleFixture.transitions.map((transition) => transition.id);
const EXPECTED_EVENTS = MAIN2_QUEST_EVENTS.filter((event) => event !== 'status');

async function unlockMain2(store, userId = USER_ID) {
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) {
    await store(userId, event);
  }
  const status = await store(userId, 'status', MAIN2_QUEST_ID);
  assert.equal(status.available, true);
  assert.equal(status.stage, 0);
}

function createAdapters(questStore) {
  return {
    readAdapter: createTmlQuestReadAdapter({ questStore, now: () => NOW }),
    advanceAdapter: createTmlQuestAdvanceAdapter({ questStore, now: () => NOW })
  };
}

function planOptions(pair, extra = {}) {
  return {
    module: moduleFixture,
    profile,
    transitionIds: TRANSITION_IDS,
    context: { userId: USER_ID },
    readAdapter: pair.readAdapter,
    advanceAdapter: pair.advanceAdapter,
    planId: 'plan.main2.full-roundtrip',
    now: () => NOW,
    createExecutionKey: ({ index, action }) => `exec.main2.${index + 1}.${action.id}`,
    ...extra
  };
}

test('P6 runs the full Main 2 TML roundtrip from stage 0 through stage 9', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);

  const mutationEvents = [];
  const questStore = async (userId, event, questId) => {
    if (questId === MAIN2_QUEST_ID && event !== 'status') mutationEvents.push(event);
    return baseStore(userId, event, questId);
  };
  const pair = createAdapters(questStore);

  const result = await executeTmlVerifiedWritePlan(planOptions(pair));

  assert.equal(result.status, TML_P6_PLAN_STATUS.VERIFIED);
  assert.equal(result.completedSteps, 9);
  assert.equal(result.stoppedAt, null);
  assert.equal(result.steps.length, 9);
  assert.deepEqual(mutationEvents, EXPECTED_EVENTS);

  result.steps.forEach((step, index) => {
    assert.equal(step.index, index);
    assert.equal(step.transitionId, TRANSITION_IDS[index]);
    assert.equal(step.disposition, TML_P5_DISPOSITION.VERIFIED);
    assert.equal(step.result.precondition, 'SATISFIED');
    assert.equal(step.result.provider.ok, true);
    assert.equal(step.result.postcondition, 'SATISFIED');
    assert.equal(step.result.executionKey, `exec.main2.${index + 1}.${step.actionId}`);

    const actionRecords = step.result.trace.records.filter((record) => record.kind === 'action');
    assert.equal(actionRecords.length, 1);
    assert.equal(actionRecords[0].status, 'SUCCEEDED');

    const stageFacts = step.result.trace.records.filter(
      (record) => record.kind === 'fact' && record.predicate === 'quest.stage'
    );
    assert.equal(stageFacts[0].value.value, index);
    assert.equal(stageFacts.at(-1).value.value, index + 1);
  });

  const finalRead = await pair.readAdapter.read({ userId: USER_ID, questRef: QUEST_REF });
  const finalStage = finalRead.facts.find((fact) => fact.predicate === 'quest.stage');
  const finalAvailable = finalRead.facts.find((fact) => fact.predicate === 'quest.available');
  assert.equal(finalStage.value.value, 9);
  assert.equal(finalAvailable.value.value, true);
});

test('P6 full roundtrip invokes every Main 2 mutation exactly once and never auto-retries', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);

  const counts = new Map();
  const questStore = async (userId, event, questId) => {
    if (questId === MAIN2_QUEST_ID && event !== 'status') {
      counts.set(event, (counts.get(event) ?? 0) + 1);
    }
    return baseStore(userId, event, questId);
  };

  const result = await executeTmlVerifiedWritePlan(planOptions(createAdapters(questStore)));

  assert.equal(result.status, TML_P6_PLAN_STATUS.VERIFIED);
  assert.deepEqual(
    Object.fromEntries(EXPECTED_EVENTS.map((event) => [event, counts.get(event) ?? 0])),
    Object.fromEntries(EXPECTED_EVENTS.map((event) => [event, 1]))
  );
});

test('P6 stops before the first write when Main 2 is not yet available', async () => {
  const baseStore = createLocalQuestStore();
  let mutationCalls = 0;
  const questStore = async (userId, event, questId) => {
    if (questId === MAIN2_QUEST_ID && event !== 'status') mutationCalls += 1;
    return baseStore(userId, event, questId);
  };

  const result = await executeTmlVerifiedWritePlan(planOptions(createAdapters(questStore)));

  assert.equal(result.status, TML_P6_PLAN_STATUS.STOPPED);
  assert.equal(result.completedSteps, 0);
  assert.equal(result.stoppedAt, 0);
  assert.equal(result.stoppedTransitionId, TRANSITION_IDS[0]);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].disposition, TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(mutationCalls, 0);
});

test('P6 stops on the first non-VERIFIED middle step and does not execute later transitions', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);

  const mutationEvents = [];
  const blockedEvent = 'pause_auto_building5';
  const questStore = async (userId, event, questId) => {
    if (questId === MAIN2_QUEST_ID && event !== 'status') {
      mutationEvents.push(event);
      if (event === blockedEvent) {
        return baseStore(userId, 'status', questId);
      }
    }
    return baseStore(userId, event, questId);
  };

  const result = await executeTmlVerifiedWritePlan(planOptions(createAdapters(questStore)));

  assert.equal(result.status, TML_P6_PLAN_STATUS.STOPPED);
  assert.equal(result.completedSteps, 3);
  assert.equal(result.stoppedAt, 3);
  assert.equal(result.stoppedTransitionId, TRANSITION_IDS[3]);
  assert.equal(result.steps[3].disposition, TML_P5_DISPOSITION.VERIFICATION_FAILED);
  assert.deepEqual(mutationEvents, EXPECTED_EVENTS.slice(0, 4));
  assert.equal(mutationEvents.includes('resume_auto_building5'), false);
});

test('P6 plan validation rejects duplicate, reversed, and unknown transition ids before mutation', async () => {
  let mutationCalls = 0;
  const questStore = async (_userId, event, questId) => {
    if (event !== 'status') mutationCalls += 1;
    return { quest_id: questId, stage: 0, available: true };
  };
  const pair = createAdapters(questStore);

  await assert.rejects(
    () => executeTmlVerifiedWritePlan(planOptions(pair, {
      transitionIds: [TRANSITION_IDS[0], TRANSITION_IDS[0]]
    })),
    (error) => error.code === 'TRANSITION_PLAN_DUPLICATE_ID'
  );

  await assert.rejects(
    () => executeTmlVerifiedWritePlan(planOptions(pair, {
      transitionIds: [TRANSITION_IDS[1], TRANSITION_IDS[0]]
    })),
    (error) => error.code === 'TRANSITION_PLAN_ORDER_INVALID'
  );

  await assert.rejects(
    () => executeTmlVerifiedWritePlan(planOptions(pair, {
      transitionIds: ['transition.does-not-exist']
    })),
    (error) => error.code === 'TRANSITION_PLAN_UNKNOWN_ID'
  );

  assert.equal(mutationCalls, 0);
});

test('P6 can execute an explicit verified sub-plan without inferring omitted transitions', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);

  const mutationEvents = [];
  const questStore = async (userId, event, questId) => {
    if (questId === MAIN2_QUEST_ID && event !== 'status') mutationEvents.push(event);
    return baseStore(userId, event, questId);
  };
  const pair = createAdapters(questStore);

  const oneStep = await executeTmlVerifiedWritePlan(planOptions(pair, {
    transitionIds: [TRANSITION_IDS[0]],
    planId: 'plan.main2.explicit-one-step'
  }));

  assert.equal(oneStep.status, TML_P6_PLAN_STATUS.VERIFIED);
  assert.equal(oneStep.completedSteps, 1);
  assert.deepEqual(mutationEvents, ['start']);

  const status = await pair.readAdapter.read({ userId: USER_ID, questRef: QUEST_REF });
  assert.equal(status.facts.find((fact) => fact.predicate === 'quest.stage').value.value, 1);
});

test('PR1 D11a P6 rejects a later unsupported action before any read or mutation', async () => {
  const module = structuredClone(moduleFixture);
  module.transitions[1].actions = [];
  let reads = 0;
  let mutations = 0;
  const pair = createAdapters(async (_userId, event, questId) => {
    if (event === 'status') reads += 1;
    else mutations += 1;
    return { quest_id: questId, stage: 0, available: true };
  });

  await assert.rejects(
    () => executeTmlVerifiedWritePlan(planOptions(pair, {
      module,
      transitionIds: TRANSITION_IDS.slice(0, 2)
    })),
    (error) => error.code === 'TRANSITION_PLAN_ACTION_INVALID'
  );
  assert.equal(reads, 0);
  assert.equal(mutations, 0);
});

test('PR1 D11a P6 rejects a later invalid or throwing execution key before dispatch', async (t) => {
  for (const mode of ['empty', 'throws', 'duplicate']) {
    await t.test(mode, async () => {
      let reads = 0;
      let mutations = 0;
      const keys = [];
      const pair = createAdapters(async (_userId, event, questId) => {
        if (event === 'status') reads += 1;
        else mutations += 1;
        return { quest_id: questId, stage: 0, available: true };
      });
      await assert.rejects(() => executeTmlVerifiedWritePlan(planOptions(pair, {
        transitionIds: TRANSITION_IDS.slice(0, 2),
        createExecutionKey: ({ index }) => {
          keys.push(index);
          if (mode === 'duplicate') return 'exec.shared';
          if (index === 1) {
            if (mode === 'throws') throw new Error('key unavailable');
            return '';
          }
          return 'exec.first';
        }
      })));
      assert.deepEqual(keys, [0, 1]);
      assert.equal(reads, 0);
      assert.equal(mutations, 0);
    });
  }
});

test('PR1 P6 prepares each external key once and preserves configuration and captured adapter methods', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);
  const mutationEvents = [];
  const pair = createAdapters(async (userId, event, questId) => {
    assert.equal(userId, USER_ID);
    if (event !== 'status') mutationEvents.push(event);
    return baseStore(userId, event, questId);
  });
  const readAdapter = { ...pair.readAdapter };
  const advanceAdapter = { ...pair.advanceAdapter };
  const module = structuredClone(moduleFixture);
  const context = { userId: USER_ID };
  const transitionIds = TRANSITION_IDS.slice(0, 2);
  const keyCalls = [];

  const result = await executeTmlVerifiedWritePlan(planOptions({ readAdapter, advanceAdapter }, {
    module,
    context,
    transitionIds,
    createExecutionKey: ({ index, action }) => {
      keyCalls.push(index);
      assert.equal(mutationEvents.length, 0, 'all keys are prepared before the first mutation');
      if (index === 0) {
        module.transitions[1].actions[0].args.event.value = 'status';
        context.userId = 'changed-user';
        transitionIds.pop();
        readAdapter.read = () => { throw new Error('changed read method must not run'); };
        advanceAdapter.advance = () => { throw new Error('changed advance method must not run'); };
      }
      return `exec.prepared.${index}.${action.id}`;
    }
  }));

  assert.equal(result.status, TML_P6_PLAN_STATUS.VERIFIED);
  assert.equal(result.completedSteps, 2);
  assert.deepEqual(keyCalls, [0, 1]);
  assert.deepEqual(mutationEvents, EXPECTED_EVENTS.slice(0, 2));
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.ok(result.steps.every((step) => step.dispatchStatus === 'ATTEMPTED'));
  assert.ok(result.steps.every((step) => step.automaticMutationRetryAllowed === false));
});

test('PR1 P6 retains the verified prefix when a later dynamic pre-read fails', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);
  const mutationEvents = [];
  let reads = 0;
  const pair = createAdapters(async (userId, event, questId) => {
    if (event === 'status') {
      reads += 1;
      if (reads === 3) throw Object.assign(new Error('later read unavailable'), { code: 'LATER_READ_DOWN' });
    } else mutationEvents.push(event);
    return baseStore(userId, event, questId);
  });

  const result = await executeTmlVerifiedWritePlan(planOptions(pair, {
    transitionIds: TRANSITION_IDS.slice(0, 3)
  }));

  assert.equal(result.status, TML_P6_PLAN_STATUS.STOPPED);
  assert.equal(result.completedSteps, 1);
  assert.equal(result.stoppedAt, 1);
  assert.equal(result.stoppedTransitionId, TRANSITION_IDS[1]);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].disposition, TML_P5_DISPOSITION.VERIFIED);
  assert.equal(result.steps[0].dispatchStatus, 'ATTEMPTED');
  assert.equal(result.steps[1].disposition, TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.steps[1].dispatchStatus, 'NOT_ATTEMPTED');
  assert.equal(result.steps[1].result.preReadError.code, 'LATER_READ_DOWN');
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.deepEqual(mutationEvents, [EXPECTED_EVENTS[0]]);
  assert.equal(reads, 3);
});

test('PR1 P6 retains an acknowledged later attempt and the completed prefix when its clock fails', async () => {
  const baseStore = createLocalQuestStore();
  await unlockMain2(baseStore);
  const mutationEvents = [];
  const pair = createAdapters(async (userId, event, questId) => {
    if (event !== 'status') mutationEvents.push(event);
    return baseStore(userId, event, questId);
  });

  const result = await executeTmlVerifiedWritePlan(planOptions(pair, {
    transitionIds: TRANSITION_IDS.slice(0, 3),
    now: () => {
      if (mutationEvents.length === 2) throw new Error('clock failed after second write');
      return NOW;
    }
  }));

  assert.equal(result.status, TML_P6_PLAN_STATUS.STOPPED);
  assert.equal(result.completedSteps, 1);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].disposition, TML_P5_DISPOSITION.VERIFIED);
  assert.equal(result.steps[1].dispatchStatus, 'ATTEMPTED');
  assert.equal(result.steps[1].result.provider.ok, true);
  assert.notEqual(result.steps[1].disposition, TML_P5_DISPOSITION.VERIFIED);
  assert.equal(result.stoppedTransitionId, TRANSITION_IDS[1]);
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.deepEqual(mutationEvents, EXPECTED_EVENTS.slice(0, 2));
  assert.equal((await baseStore(USER_ID, 'status', MAIN2_QUEST_ID)).stage, 2);
});
