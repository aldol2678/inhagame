import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalQuestStore } from '../npc-factory/quest-store.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import { createTmlQuestAdvanceAdapter } from '../tml/runtime/quest-advance-adapter.mjs';
import { createTmlQuestReadAdapter } from '../tml/runtime/quest-read-adapter.mjs';
import {
  createTmlProgressionReadAdapter,
  createTmlWalletReadAdapter
} from '../tml/runtime/economic-read-adapters.mjs';
import {
  executeTmlVerifiedRewardTransition,
  TML_P7_DISPOSITION
} from '../tml/runtime/reward-settlement.mjs';
import { TML_VERIFICATION_STATUS } from '../tml/runtime/verification.mjs';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const moduleFixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);
const rewardSpec = JSON.parse(
  readFileSync(new URL('../tml/fixtures/main2-navigation-reward-v1.json', import.meta.url), 'utf8')
);

const TRANSITION_ID = 'transition.inha-world.campus_navigation_intro_v1.8_to_9';
const ACTION_ID = 'call.inha-world.campus_navigation_intro_v1.visit_back_gate';
const USER_ID = 'tml-p7-user';
const NOW = '2026-10-03T11:28:00+09:00';

const rewardReceipt = Object.freeze({
  rewardId: 'reward.quest.navigation_intro',
  rewardVersion: 1,
  rewardTransactionId: 'tx-nav-p7',
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

async function setupStage8(store) {
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) {
    await store(USER_ID, event);
  }
  for (const event of [
    'start',
    'set_building5_destination',
    'start_auto_building5',
    'pause_auto_building5',
    'resume_auto_building5',
    'visit_building5',
    'set_back_gate_destination',
    'start_auto_back_gate'
  ]) {
    await store(USER_ID, event, MAIN2_QUEST_ID);
  }
  const status = await store(USER_ID, 'status', MAIN2_QUEST_ID);
  assert.deepEqual(status, { quest_id: MAIN2_QUEST_ID, stage: 8, available: true });
}

function makeHarness({
  receipt = rewardReceipt,
  coinDelta = 180,
  expDelta = 100,
  throwAfterCommit = false,
  walletReadFails = false,
  progressionReadFails = false
} = {}) {
  const baseStore = createLocalQuestStore();
  let coins = 0;
  let exp = 100;
  let mutationCalls = 0;

  const questStore = async (userId, event, questId) => {
    if (questId !== MAIN2_QUEST_ID || event === 'status') {
      return baseStore(userId, event, questId);
    }

    mutationCalls += 1;
    const before = await baseStore(userId, 'status', questId);
    const result = await baseStore(userId, event, questId);

    if (before.stage === 8 && event === 'visit_back_gate' && result.stage === 9) {
      coins += coinDelta;
      exp += expDelta;
      if (throwAfterCommit) {
        throw Object.assign(new Error('socket timeout after commit'), { code: 'ETIMEDOUT' });
      }
      return { ...result, ...(receipt ? { reward: receipt } : {}) };
    }

    return result;
  };

  const questReadAdapter = createTmlQuestReadAdapter({ questStore, now: () => NOW });
  const questAdvanceAdapter = createTmlQuestAdvanceAdapter({ questStore, now: () => NOW });
  const walletReadAdapter = createTmlWalletReadAdapter({
    readWallet: async () => {
      if (walletReadFails) throw Object.assign(new Error('wallet down'), { code: 'WALLET_DOWN' });
      return { currencies: [{ id: 'currency.induck_coin', balance: coins }] };
    },
    now: () => NOW
  });
  const progressionReadAdapter = createTmlProgressionReadAdapter({
    readProgression: async () => {
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
    get coins() { return coins; },
    get exp() { return exp; },
    get mutationCalls() { return mutationCalls; }
  };
}

function executionOptions(h) {
  return {
    module: moduleFixture,
    profile,
    transitionId: TRANSITION_ID,
    actionId: ACTION_ID,
    context: { userId: USER_ID },
    questReadAdapter: h.questReadAdapter,
    questAdvanceAdapter: h.questAdvanceAdapter,
    walletReadAdapter: h.walletReadAdapter,
    progressionReadAdapter: h.progressionReadAdapter,
    rewardSpec,
    now: () => NOW,
    createExecutionKey: () => 'exec.p7.8_to_9.1',
    traceId: 'trace.p7.reward-settlement'
  };
}

test('P7 verifies Main 2 reward receipt + wallet + EXP as one settlement', async () => {
  const h = makeHarness();
  await setupStage8(h.baseStore);

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.disposition, TML_P7_DISPOSITION.VERIFIED);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.SATISFIED);
  assert.equal(result.transition.disposition, 'VERIFIED');
  assert.equal(result.transition.provider.ok, true);
  assert.deepEqual(result.transition.provider.output.reward, rewardReceipt);
  assert.equal(result.receiptPresent, true);
  assert.equal(h.mutationCalls, 9, '8 setup transitions + exactly one final transition');
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);

  const facts = result.trace.records.filter((record) => record.kind === 'fact');
  const receiptStatus = facts.find((fact) =>
    fact.subject === rewardSpec.reward_id && fact.predicate === 'reward.status');
  const receiptCoin = facts.find((fact) =>
    fact.subject.includes('.grant.currency.currency.induck_coin') && fact.predicate === 'reward.granted');
  const receiptExp = facts.find((fact) =>
    fact.subject.includes('.grant.exp.exp.campus') && fact.predicate === 'reward.granted');
  const walletFacts = facts.filter((fact) => fact.predicate === 'wallet.balance');
  const expFacts = facts.filter((fact) => fact.predicate === 'progression.total_exp');

  assert.equal(receiptStatus.value.value, 'SUCCESS');
  assert.equal(receiptCoin.value.value, 180);
  assert.equal(receiptExp.value.value, 100);
  assert.deepEqual(walletFacts.map((fact) => fact.value.value), [0, 180]);
  assert.deepEqual(expFacts.map((fact) => fact.value.value), [100, 200]);

  assert.equal(result.evidence.extensions.reward_spec_id, rewardSpec.id);
  assert.equal(result.evidence.extensions.reward_receipt_present, true);
  assert.deepEqual(result.evidence.extensions.expected_deltas, {
    currencies: { 'currency.induck_coin': 180 },
    exp: 100
  });
});

test('P7 fails settlement when receipt says +180 but wallet readback only moved +100', async () => {
  const h = makeHarness({ coinDelta: 100 });
  await setupStage8(h.baseStore);

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.transition.disposition, 'VERIFIED', 'quest stage can still be verified');
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNSATISFIED);
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(h.coins, 100);
  assert.equal(h.exp, 200);
});

test('P7 fails settlement when receipt EXP disagrees with progression readback', async () => {
  const h = makeHarness({ expDelta: 40 });
  await setupStage8(h.baseStore);

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNSATISFIED);
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 140);
});

test('P7 missing reward receipt stays UNKNOWN even when wallet and EXP moved correctly', async () => {
  const h = makeHarness({ receipt: null });
  await setupStage8(h.baseStore);

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.transition.disposition, 'VERIFIED');
  assert.equal(result.receiptPresent, false);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);
});

test('P7 timeout after atomic commit keeps quest verified but reward receipt evidence UNKNOWN', async () => {
  const h = makeHarness({ throwAfterCommit: true });
  await setupStage8(h.baseStore);

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.transition.disposition, 'VERIFIED');
  assert.equal(result.transition.provider.ok, false);
  assert.equal(result.transition.provider.error.code, 'ETIMEDOUT');
  assert.equal(result.receiptPresent, false);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(h.coins, 180);
  assert.equal(h.exp, 200);
});

test('P7 blocks the final mutation if pre-reward wallet evidence is unavailable', async () => {
  const h = makeHarness({ walletReadFails: true });
  await setupStage8(h.baseStore);
  const beforeCalls = h.mutationCalls;

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.disposition, TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.transition, null);
  assert.equal(result.preWalletError.code, 'WALLET_DOWN');
  assert.equal(h.mutationCalls, beforeCalls);
  assert.equal(h.coins, 0);
  assert.equal(h.exp, 100);
});

test('P7 blocks the final mutation if pre-reward progression evidence is unavailable', async () => {
  const h = makeHarness({ progressionReadFails: true });
  await setupStage8(h.baseStore);
  const beforeCalls = h.mutationCalls;

  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

  assert.equal(result.disposition, TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.transition, null);
  assert.equal(result.preProgressionError.code, 'PROGRESSION_DOWN');
  assert.equal(h.mutationCalls, beforeCalls);
});

test('P7 rejects replayed or partial reward receipts as settlement evidence', async () => {
  for (const receipt of [
    { ...rewardReceipt, replayed: true },
    { ...rewardReceipt, status: 'PARTIAL_SUCCESS' }
  ]) {
    const h = makeHarness({ receipt });
    await setupStage8(h.baseStore);

    const result = await executeTmlVerifiedRewardTransition(executionOptions(h));

    assert.equal(result.verification, TML_VERIFICATION_STATUS.UNSATISFIED);
    assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  }
});

test('P7 reward fixture stays aligned with the public Main 2 reward contracts', () => {
  const appContract = readFileSync(new URL('./navigation-reward.test.mjs', import.meta.url), 'utf8');
  const dbContract = readFileSync(
    new URL('../../../supabase/tests/database/79_world_quest_navigation_reward_p1d.test.sql', import.meta.url),
    'utf8'
  );

  assert.equal(rewardSpec.reward_id, 'reward.quest.navigation_intro');
  assert.deepEqual(rewardSpec.grants, [
    { grant_type: 'CURRENCY', target_id: 'currency.induck_coin', amount: 180 },
    { grant_type: 'EXP', target_id: 'exp.campus', amount: 100 }
  ]);

  assert.match(appContract, /rewardId:\s*["']reward\.quest\.navigation_intro["']/);
  assert.match(appContract, /targetId:\s*["']currency\.induck_coin["'][\s\S]*granted:\s*180/);
  assert.match(appContract, /targetId:\s*["']exp\.campus["'][\s\S]*granted:\s*100/);
  assert.match(dbContract, /reward\.quest\.navigation_intro \(\+180 .*\+100 EXP\)/);
});
