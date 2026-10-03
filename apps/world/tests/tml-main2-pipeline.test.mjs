import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalQuestStore } from '../npc-factory/quest-store.mjs';
import { MAIN2_QUEST_EVENTS, MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import {
  createTmlProgressionReadAdapter,
  createTmlWalletReadAdapter
} from '../tml/runtime/economic-read-adapters.mjs';
import {
  executeTmlRewardAwarePipeline,
  TML_P8_PIPELINE_STATUS
} from '../tml/runtime/reward-aware-pipeline.mjs';
import { TML_P7_DISPOSITION } from '../tml/runtime/reward-settlement.mjs';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);
const rewardSpec = JSON.parse(
  readFileSync(new URL('../tml/fixtures/main2-navigation-reward-v1.json', import.meta.url), 'utf8')
);

const USER_ID = 'tml-p8-user';
const NOW = '2026-10-03T11:40:00+09:00';
const TRANSITION_IDS = moduleFixture.transitions.map((transition) => transition.id);
const ORDINARY_IDS = TRANSITION_IDS.slice(0, -1);
const REWARD_TRANSITION_ID = TRANSITION_IDS.at(-1);
const EXPECTED_EVENTS = MAIN2_QUEST_EVENTS.filter((event) => event !== 'status');

const rewardReceipt = Object.freeze({
  rewardId: 'reward.quest.navigation_intro',
  rewardVersion: 1,
  rewardTransactionId: 'tx-p8',
  status: 'SUCCESS',
  replayed: false,
  completedAt: NOW,
  entries: [
    {
      grantType: 'CURRENCY',
      targetId: 'currency.induck_coin',
      requested: 180,
      granted: 180,
      status: 'GRANTED',
      reason: null
    },
    {
      grantType: 'EXP',
      targetId: 'exp.campus',
      requested: 100,
      granted: 100,
      status: 'GRANTED',
      reason: null
    }
  ]
});

function progressionRaw(totalExp) {
  const level = totalExp < 100 ? 1 : totalExp < 300 ? 2 : 3;
  const start = level === 1 ? 0 : level === 2 ? 100 : 300;
  const next = level === 1 ? 100 : level === 2 ? 300 : 600;
  return {
    totalExp,
    level,
    currentLevelStartExp: start,
    nextLevelExp: next,
    progressExp: totalExp - start,
    progressRequired: next - start,
    maxDefinedLevel: 10,
    isMaxLevel: false
  };
}

async function unlockMain2(store) {
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) {
    await store(USER_ID, event);
  }
  assert.deepEqual(
    await store(USER_ID, 'status', MAIN2_QUEST_ID),
    { quest_id: MAIN2_QUEST_ID, stage: 0, available: true }
  );
}

function createHarness({
  coinDelta = 180,
  expDelta = 100,
  receipt = rewardReceipt,
  rewardVersion = null,
  blockEvent = null,
  walletReadFails = false,
  progressionReadFails = false
} = {}) {
  const baseStore = createLocalQuestStore();
  let coins = 0;
  let exp = 100;
  const mutationEvents = [];
  const economicReads = [];

  const questStore = async (userId, event, questId) => {
    if (questId !== MAIN2_QUEST_ID || event === 'status') {
      return baseStore(userId, event, questId);
    }

    mutationEvents.push(event);
    if (event === blockEvent) {
      return baseStore(userId, 'status', questId);
    }

    const before = await baseStore(userId, 'status', questId);
    const result = await baseStore(userId, event, questId);

    if (before.stage === 8 && event === 'visit_back_gate' && result.stage === 9) {
      coins += coinDelta;
      exp += expDelta;
      const finalReceipt = receipt
        ? { ...receipt, ...(rewardVersion === null ? {} : { rewardVersion }) }
        : null;
      return { ...result, ...(finalReceipt ? { reward: finalReceipt } : {}) };
    }

    return result;
  };

  const questReadAdapter = createTmlQuestReadAdapter({ questStore, now: () => NOW });
  const questAdvanceAdapter = createTmlQuestAdvanceAdapter({ questStore, now: () => NOW });
  const walletReadAdapter = createTmlWalletReadAdapter({
    readWallet: async () => {
      economicReads.push({ source: 'wallet', mutationCount: mutationEvents.length });
      if (walletReadFails) throw Object.assign(new Error('wallet down'), { code: 'WALLET_DOWN' });
      return { currencies: [{ id: 'currency.induck_coin', balance: coins }] };
    },
    now: () => NOW
  });
  const progressionReadAdapter = createTmlProgressionReadAdapter({
    readProgression: async () => {
      economicReads.push({ source: 'progression', mutationCount: mutationEvents.length });
      if (progressionReadFails) throw Object.assign(new Error('progression down'), { code: 'PROGRESSION_DOWN' });
      return progressionRaw(exp);
    },
    now: () => NOW
  });

  return {
    baseStore,
    questStore,
    questReadAdapter,
    questAdvanceAdapter,
    walletReadAdapter,
    progressionReadAdapter,
    mutationEvents,
    economicReads,
    get coins() { return coins; },
    get exp() { return exp; }
  };
}

function pipelineOptions(h, extra = {}) {
  return {
    module: moduleFixture,
    profile,
    transitionIds: ORDINARY_IDS,
    rewardTransitionId: REWARD_TRANSITION_ID,
    rewardSpec,
    context: { userId: USER_ID },
    questReadAdapter: h.questReadAdapter,
    questAdvanceAdapter: h.questAdvanceAdapter,
    walletReadAdapter: h.walletReadAdapter,
    progressionReadAdapter: h.progressionReadAdapter,
    planId: 'pipeline.main2.complete',
    now: () => NOW,
    createExecutionKey: ({ index, action, phase }) =>
      `exec.p8.${phase}.${index + 1}.${action.id}`,
    ...extra
  };
}

test('P8 runs Main 2 as P5 stages 0->8 plus P7 reward settlement 8->9', async () => {
  const h = createHarness();
  await unlockMain2(h.baseStore);

  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.VERIFIED);
  assert.equal(result.completedSteps, 9);
  assert.equal(result.ordinary.status, 'VERIFIED');
  assert.equal(result.ordinary.completedSteps, 8);
  assert.equal(result.reward.disposition, TML_P7_DISPOSITION.VERIFIED);
  assert.equal(result.reward.verification, 'SATISFIED');
  assert.deepEqual(h.mutationEvents, EXPECTED_EVENTS);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);

  result.ordinary.steps.forEach((step, index) => {
    assert.equal(step.transitionId, ORDINARY_IDS[index]);
    assert.equal(step.disposition, 'VERIFIED');
    assert.match(step.result.executionKey, new RegExp(`^exec\\.p8\\.ordinary\\.${index + 1}\\.`));
  });

  assert.equal(result.reward.transition.transitionId, REWARD_TRANSITION_ID);
  assert.match(result.reward.transition.executionKey, /^exec\.p8\.reward\.9\./);
  assert.equal(result.reward.receiptPresent, true);
  assert.equal(result.reward.evidence.extensions.reward_spec_id, rewardSpec.id);

  const finalStatus = await h.questStore(USER_ID, 'status', MAIN2_QUEST_ID);
  assert.deepEqual(finalStatus, { quest_id: MAIN2_QUEST_ID, stage: 9, available: true });
});

test('P8 stops before P7 when an ordinary P5 transition is not VERIFIED', async () => {
  const h = createHarness({ blockEvent: 'pause_auto_building5' });
  await unlockMain2(h.baseStore);

  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.STOPPED);
  assert.equal(result.completedSteps, 3);
  assert.equal(result.reward, null);
  assert.equal(result.stoppedTransitionId, ORDINARY_IDS[3]);
  assert.deepEqual(h.mutationEvents, EXPECTED_EVENTS.slice(0, 4));
  assert.equal(h.coins, 0);
  assert.equal(h.exp, 100);
});

test('PR1 D11c P8 keeps economic reads just-in-time and retains eight steps on wallet or progression outage', async (t) => {
  for (const source of ['wallet', 'progression']) {
    await t.test(source, async () => {
      const h = createHarness(source === 'wallet' ? { walletReadFails: true } : { progressionReadFails: true });
      await unlockMain2(h.baseStore);

      const result = await executeTmlRewardAwarePipeline(pipelineOptions(h));

      assert.equal(result.status, TML_P8_PIPELINE_STATUS.STOPPED);
      assert.equal(result.completedSteps, 8);
      assert.equal(result.ordinary.completedSteps, 8);
      assert.equal(result.ordinary.steps.length, 8);
      assert.equal(result.stoppedTransitionId, REWARD_TRANSITION_ID);
      assert.equal(result.reward.disposition, TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION);
      assert.equal(result.reward.dispatchStatus, 'NOT_ATTEMPTED');
      assert.equal(result.dispatchStatus, 'ATTEMPTED');
      assert.equal(result.automaticMutationRetryAllowed, false);
      assert.deepEqual(h.mutationEvents, EXPECTED_EVENTS.slice(0, 8));
      assert.ok(h.economicReads.length > 0);
      assert.ok(h.economicReads.every((read) => read.mutationCount === 8));
      assert.equal(h.coins, 0);
      assert.equal(h.exp, 100);
    });
  }
});

test('P8 marks the pipeline REWARD_UNVERIFIED when stage 9 succeeds but settlement is wrong', async () => {
  const h = createHarness({ coinDelta: 100 });
  await unlockMain2(h.baseStore);

  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.REWARD_UNVERIFIED);
  assert.equal(result.completedSteps, 8);
  assert.equal(result.reward.transition.disposition, 'VERIFIED');
  assert.equal(result.reward.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(result.reward.verification, 'UNSATISFIED');
  assert.equal(result.stoppedTransitionId, REWARD_TRANSITION_ID);
  assert.equal(h.coins, 100);
  assert.equal(h.exp, 200);
  assert.deepEqual(
    await h.questStore(USER_ID, 'status', MAIN2_QUEST_ID),
    { quest_id: MAIN2_QUEST_ID, stage: 9, available: true }
  );
});

test('P8 verifies reward.version and rejects a version-drifted receipt', async () => {
  const h = createHarness({ rewardVersion: 2 });
  await unlockMain2(h.baseStore);

  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.REWARD_UNVERIFIED);
  assert.equal(result.reward.verification, 'UNSATISFIED');

  const versionFact = result.reward.trace.records.find(
    (record) => record.kind === 'fact' &&
      record.subject === rewardSpec.reward_id &&
      record.predicate === 'reward.version'
  );
  assert.equal(versionFact.value.value, 2);
});

test('P8 refuses a reward spec wired to a different source transition before any mutation', async () => {
  const h = createHarness();
  await unlockMain2(h.baseStore);

  await assert.rejects(
    () => executeTmlRewardAwarePipeline(pipelineOptions(h, {
      rewardSpec: { ...rewardSpec, source_transition: ORDINARY_IDS.at(-1) }
    })),
    (error) => error.code === 'REWARD_SPEC_TRANSITION_MISMATCH'
  );

  assert.equal(h.mutationEvents.length, 0);
});

test('P8 refuses ordinary transitions that include or follow the reward transition', async () => {
  const h = createHarness();
  await unlockMain2(h.baseStore);

  await assert.rejects(
    () => executeTmlRewardAwarePipeline(pipelineOptions(h, {
      transitionIds: [...ORDINARY_IDS, REWARD_TRANSITION_ID]
    })),
    (error) => error.code === 'REWARD_TRANSITION_DUPLICATED'
  );

  await assert.rejects(
    () => executeTmlRewardAwarePipeline(pipelineOptions(h, {
      transitionIds: [ORDINARY_IDS[0], REWARD_TRANSITION_ID, ORDINARY_IDS[1]]
    })),
    (error) => ['REWARD_TRANSITION_DUPLICATED', 'PIPELINE_TRANSITION_ORDER_INVALID'].includes(error.code)
  );

  assert.equal(h.mutationEvents.length, 0);
});

test('PR1 D11a P8 rejects malformed reward configuration before ordinary mutations', async (t) => {
  const cases = [
    ['empty grants', (spec) => { spec.grants = []; }],
    ['missing version', (spec) => { delete spec.reward_version; }],
    ['null version', (spec) => { spec.reward_version = null; }],
    ['fractional version', (spec) => { spec.reward_version = 1.5; }],
    ['unsupported EXP target', (spec) => { spec.grants[1].target_id = 'exp.unsupported'; }],
    ['duplicate grant', (spec) => { spec.grants.push({ ...spec.grants[0] }); }]
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const h = createHarness();
      await unlockMain2(h.baseStore);
      const spec = structuredClone(rewardSpec);
      change(spec);

      await assert.rejects(() => executeTmlRewardAwarePipeline(pipelineOptions(h, { rewardSpec: spec })));

      assert.deepEqual(h.mutationEvents, []);
      assert.deepEqual(h.economicReads, []);
      assert.equal(h.coins, 0);
      assert.equal(h.exp, 100);
      assert.equal((await h.baseStore(USER_ID, 'status', MAIN2_QUEST_ID)).stage, 0);
    });
  }
});

test('PR1 D11a P8 rejects an invalid final action and non-callable economic adapters before ordinary work', async (t) => {
  for (const mode of ['reward action', 'wallet adapter', 'progression adapter']) {
    await t.test(mode, async () => {
      const h = createHarness();
      await unlockMain2(h.baseStore);
      const extra = {};
      if (mode === 'reward action') {
        extra.module = structuredClone(moduleFixture);
        extra.module.transitions.at(-1).actions = [];
      } else if (mode === 'wallet adapter') extra.walletReadAdapter = { read: true };
      else extra.progressionReadAdapter = { read: {} };

      await assert.rejects(() => executeTmlRewardAwarePipeline(pipelineOptions(h, extra)));
      assert.deepEqual(h.mutationEvents, []);
      assert.deepEqual(h.economicReads, []);
    });
  }
});

test('PR1 D11a P8 rejects a late invalid or reused execution key before the first mutation', async (t) => {
  for (const mode of ['later ordinary', 'reward', 'cross-phase duplicate']) {
    await t.test(mode, async () => {
      const h = createHarness();
      await unlockMain2(h.baseStore);
      const keys = [];
      await assert.rejects(() => executeTmlRewardAwarePipeline(pipelineOptions(h, {
        createExecutionKey: ({ index, phase }) => {
          keys.push({ phase, index });
          if (mode === 'later ordinary' && index === 7) return '';
          if (mode === 'reward' && phase === 'reward') throw new Error('reward key unavailable');
          if (mode === 'cross-phase duplicate' && (index === 0 || phase === 'reward')) return 'exec.shared';
          return `exec.${phase}.${index}`;
        }
      })));

      assert.equal(keys.length, mode === 'later ordinary' ? 8 : 9);
      assert.deepEqual(h.mutationEvents, []);
      assert.deepEqual(h.economicReads, []);
    });
  }
});

test('PR1 P8 snapshots the complete pipeline and captures every adapter before external key factories', async () => {
  const h = createHarness();
  await unlockMain2(h.baseStore);
  const module = structuredClone(moduleFixture);
  const spec = structuredClone(rewardSpec);
  const context = { userId: USER_ID };
  const transitionIds = [...ORDINARY_IDS];
  const questReadAdapter = { ...h.questReadAdapter };
  const questAdvanceAdapter = { ...h.questAdvanceAdapter };
  const walletReadAdapter = { ...h.walletReadAdapter };
  const progressionReadAdapter = { ...h.progressionReadAdapter };
  const keys = [];

  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h, {
    module,
    rewardSpec: spec,
    context,
    transitionIds,
    questReadAdapter,
    questAdvanceAdapter,
    walletReadAdapter,
    progressionReadAdapter,
    createExecutionKey: ({ phase, index }) => {
      keys.push({ phase, index });
      assert.deepEqual(h.mutationEvents, []);
      assert.deepEqual(h.economicReads, []);
      if (phase === 'ordinary' && index === 0) {
        module.transitions.at(-1).actions[0].args.event.value = 'status';
        spec.reward_version = 99;
        context.userId = 'changed-user';
        transitionIds.pop();
        questReadAdapter.read = () => { throw new Error('changed quest read must not run'); };
        questAdvanceAdapter.advance = () => { throw new Error('changed quest write must not run'); };
        walletReadAdapter.read = () => { throw new Error('changed wallet read must not run'); };
        progressionReadAdapter.read = () => { throw new Error('changed progression read must not run'); };
      }
      return `exec.prepared.${phase}.${index}`;
    }
  }));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.VERIFIED);
  assert.equal(result.completedSteps, 9);
  assert.deepEqual(keys, [
    ...ORDINARY_IDS.map((_, index) => ({ phase: 'ordinary', index })),
    { phase: 'reward', index: 8 }
  ]);
  assert.deepEqual(h.mutationEvents, EXPECTED_EVENTS);
  assert.deepEqual(h.economicReads.map((read) => read.mutationCount), [8, 8, 9, 9]);
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);
});

test('PR1 P8 retains ordinary completion and the reward attempt when a post-settlement read is malformed', async () => {
  const h = createHarness();
  await unlockMain2(h.baseStore);
  let walletReads = 0;
  const result = await executeTmlRewardAwarePipeline(pipelineOptions(h, {
    walletReadAdapter: {
      async read(args) {
        walletReads += 1;
        return walletReads === 2 ? {} : h.walletReadAdapter.read(args);
      }
    }
  }));

  assert.equal(result.status, TML_P8_PIPELINE_STATUS.REWARD_UNVERIFIED);
  assert.equal(result.completedSteps, 8);
  assert.equal(result.ordinary.completedSteps, 8);
  assert.equal(result.ordinary.steps.length, 8);
  assert.equal(result.reward.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.reward.transition.provider.ok, true);
  assert.equal(result.reward.transition.postcondition, 'SATISFIED');
  assert.equal(result.reward.verification, 'UNKNOWN');
  assert.equal(result.stoppedTransitionId, REWARD_TRANSITION_ID);
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(walletReads, 2);
  assert.deepEqual(h.mutationEvents, EXPECTED_EVENTS);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);
});
