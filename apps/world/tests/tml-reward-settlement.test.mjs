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
  createTmlRewardReceiptRead,
  executeTmlVerifiedRewardTransition,
  prepareTmlRewardTransition,
  TML_P7_DISPOSITION
} from '../tml/runtime/reward-settlement.mjs';
import { evaluateTmlExpression, TML_VERIFICATION_STATUS } from '../tml/runtime/verification.mjs';

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
  assert.equal(h.mutationCalls, 1, 'P7 executes exactly one final transition; stage-8 setup uses the base fixture directly');
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

test('P7 preparation is synchronous and captures reward data and the execution key without reading', () => {
  const h = makeHarness();
  const suppliedSpec = structuredClone(rewardSpec);
  const suppliedContext = { userId: USER_ID, planId: 'prepared-plan', planIndex: 8 };
  let reads = 0;
  let keys = 0;
  const prepared = prepareTmlRewardTransition({
    ...executionOptions(h),
    rewardSpec: suppliedSpec,
    context: suppliedContext,
    walletReadAdapter: { read() { reads += 1; } },
    progressionReadAdapter: { read() { reads += 1; } },
    createExecutionKey: () => { keys += 1; return 'exec.reward.prepared'; }
  });

  assert.equal(reads, 0);
  assert.equal(h.mutationCalls, 0);
  assert.equal(keys, 1);
  assert.equal(prepared.write.executionKey, 'exec.reward.prepared');
  assert.deepEqual(prepared.write.context, suppliedContext);
  assert.notEqual(prepared.write.context, suppliedContext);
  assert.notEqual(prepared.rewardSpec, suppliedSpec);
  assert.equal(Object.isFrozen(prepared.rewardSpec.grants[0]), true);
  suppliedSpec.grants[0].amount = 1;
  suppliedContext.userId = 'changed-user';
  assert.equal(prepared.rewardSpec.grants[0].amount, 180);
  assert.equal(prepared.write.context.userId, USER_ID);
});

test('D08 invalid expected reward versions reject before economic reads or dispatch', async () => {
  const missing = structuredClone(rewardSpec);
  delete missing.reward_version;
  const invalidSpecs = [
    missing,
    ...[undefined, null, 0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1].map((reward_version) => ({
      ...rewardSpec, reward_version
    }))
  ];
  for (const invalidSpec of invalidSpecs) {
    const h = makeHarness();
    let reads = 0;
    await assert.rejects(() => executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      rewardSpec: invalidSpec,
      walletReadAdapter: { read() { reads += 1; } },
      progressionReadAdapter: { read() { reads += 1; } }
    }), (error) => error.code === 'INVALID_REWARD_SPEC');
    assert.equal(reads, 0);
    assert.equal(h.mutationCalls, 0);
  }
});

test('P7 statically rejects reward identity, source, target, duplicate, and amount drift', async () => {
  const variants = [
    { ...rewardSpec, id: '' },
    { ...rewardSpec, schema: 'other.reward' },
    { ...rewardSpec, version: '1.0' },
    { ...rewardSpec, reward_id: 'reward.other' },
    { ...rewardSpec, source_transition: moduleFixture.transitions[0].id },
    { ...rewardSpec, grants: [] },
    { ...rewardSpec, grants: [{ grant_type: 'CURRENCY', target_id: 'currency.other', amount: 180 }] },
    { ...rewardSpec, grants: [{ grant_type: 'EXP', target_id: 'exp.other', amount: 100 }] },
    { ...rewardSpec, grants: [{ grant_type: 'ITEM', target_id: 'item.other', amount: 1 }] },
    { ...rewardSpec, grants: [rewardSpec.grants[0], rewardSpec.grants[0]] },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((amount) => ({
      ...rewardSpec, grants: [{ ...rewardSpec.grants[0], amount }]
    }))
  ];
  for (const invalidSpec of variants) {
    const h = makeHarness();
    let reads = 0;
    await assert.rejects(() => executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      rewardSpec: invalidSpec,
      walletReadAdapter: { read() { reads += 1; } },
      progressionReadAdapter: { read() { reads += 1; } }
    }), (error) => ['INVALID_REWARD_SPEC', 'REWARD_SPEC_TRANSITION_MISMATCH'].includes(error.code));
    assert.equal(reads, 0);
    assert.equal(h.mutationCalls, 0);
  }

  const h = makeHarness();
  const relabeledModule = structuredClone(moduleFixture);
  const priorId = relabeledModule.transitions.at(-2).id;
  relabeledModule.transitions.at(-2).id = TRANSITION_ID;
  relabeledModule.transitions.at(-1).id = priorId;
  assert.throws(() => prepareTmlRewardTransition({
    ...executionOptions(h), module: relabeledModule, actionId: undefined
  }), (error) => error.code === 'REWARD_SPEC_TRANSITION_MISMATCH');
  assert.equal(h.mutationCalls, 0);
});

test('P7 requires callable economic reads and the declared read-only profile bindings', () => {
  const h = makeHarness();
  assert.throws(() => prepareTmlRewardTransition({ ...executionOptions(h), walletReadAdapter: { read: true } }));
  assert.throws(() => prepareTmlRewardTransition({ ...executionOptions(h), progressionReadAdapter: {} }));
  for (const capability of ['world.wallet.read', 'world.progression.read']) {
    for (const mutate of [
      (p) => { p.capabilities = p.capabilities.filter((item) => item.id !== capability); },
      (p) => { p.capabilities.find((item) => item.id === capability).mutates = true; },
      (p) => { p.capabilities.find((item) => item.id === capability).provider_binding = 'unsupported.binding'; }
    ]) {
      const invalidProfile = structuredClone(profile);
      mutate(invalidProfile);
      assert.throws(() => prepareTmlRewardTransition({ ...executionOptions(h), profile: invalidProfile }),
        (error) => error.code === 'REWARD_READ_BINDING_INVALID');
    }
  }
  const invalidAuthority = structuredClone(profile);
  invalidAuthority.authority.find((rule) => rule.predicate === 'reward.version').authority = 'world.client';
  assert.throws(() => prepareTmlRewardTransition({ ...executionOptions(h), profile: invalidAuthority }),
    (error) => error.code === 'REWARD_AUTHORITY_INVALID');
  assert.equal(h.mutationCalls, 0);
});

test('P7 successful malformed economic baselines HOLD before reward dispatch', async () => {
  for (const key of ['walletReadAdapter', 'progressionReadAdapter']) {
    const h = makeHarness();
    await setupStage8(h.baseStore);
    const result = await executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      [key]: { async read() { return { facts: [], observations: null }; } }
    });
    assert.equal(result.disposition, TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION);
    assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
    assert.equal(result.transition, null);
    assert.equal(result.dispatchStatus, 'NOT_ATTEMPTED');
    assert.equal(result.automaticMutationRetryAllowed, false);
    assert.equal(h.mutationCalls, 0);
    const error = key === 'walletReadAdapter' ? result.preWalletError : result.preProgressionError;
    assert.equal(error.code, 'INVALID_READ_RESULT');
  }
});

test('P7 initial and child pre-dispatch clock failures preserve known non-dispatch', async () => {
  for (const firstFailure of [1, 2]) {
    const h = makeHarness();
    await setupStage8(h.baseStore);
    let clocks = 0;
    const result = await executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      now: () => {
        if (++clocks >= firstFailure) throw Object.assign(new Error('clock failed'), { code: 'CLOCK_BEFORE_REWARD' });
        return NOW;
      }
    });
    assert.equal(result.disposition, TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION);
    assert.equal(result.dispatchStatus, 'NOT_ATTEMPTED');
    assert.equal(result.attempt.dispatchStatus, 'NOT_ATTEMPTED');
    assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
    assert.equal(result.traceComplete, false);
    assert.equal(result.automaticMutationRetryAllowed, false);
    assert.equal(h.mutationCalls, 0);
  }
});

test('D08 missing observed reward version stays UNKNOWN after one dispatch without a malformed number fact', async () => {
  const receipt = structuredClone(rewardReceipt);
  delete receipt.rewardVersion;
  const h = makeHarness({ receipt });
  await setupStage8(h.baseStore);
  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));
  assert.equal(h.mutationCalls, 1);
  assert.equal(result.transition.disposition, 'VERIFIED');
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.receiptPresent, false);
  assert.equal(result.receiptError.code, 'INVALID_REWARD_VERSION');
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(result.trace.records.some((record) => record.kind === 'fact' && record.predicate === 'reward.version'), false);
  assert.equal(createTmlRewardReceiptRead({ reward: receipt, observedAt: NOW }).facts.length, 0);
});

test('P7 malformed post-economic data retains the completed quest attempt and admitted receipt', async () => {
  const h = makeHarness();
  await setupStage8(h.baseStore);
  let walletReads = 0;
  const result = await executeTmlVerifiedRewardTransition({
    ...executionOptions(h),
    walletReadAdapter: {
      async read(request) {
        walletReads += 1;
        return walletReads === 1 ? h.walletReadAdapter.read(request) : { facts: [], observations: false };
      }
    }
  });
  assert.equal(h.mutationCalls, 1);
  assert.equal(result.transition.disposition, 'VERIFIED');
  assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
  assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
  assert.equal(result.receiptPresent, true);
  assert.equal(result.postWalletError.code, 'INVALID_READ_RESULT');
  assert.equal(result.attempt, result.transition.attempt);
  assert.equal(result.automaticMutationRetryAllowed, false);
  assert.equal(result.trace.records.filter((record) => record.kind === 'action').length, 1);
  assert.equal(result.trace.records.some((record) => record.kind === 'fact' && record.predicate === 'reward.version'), true);
});

test('P7 late clock failures retain the attempt, receipt, and evidence with an incomplete trace', async () => {
  for (const failOnLateCall of [1, 2]) {
    const h = makeHarness();
    await setupStage8(h.baseStore);
    let progressionReads = 0;
    let settlementPhase = false;
    let lateCalls = 0;
    const result = await executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      now: () => {
        if (settlementPhase && ++lateCalls >= failOnLateCall) {
          throw Object.assign(new Error('late clock failed'), { code: 'CLOCK_AFTER_REWARD' });
        }
        return NOW;
      },
      progressionReadAdapter: {
        async read(request) {
          const read = await h.progressionReadAdapter.read(request);
          if (++progressionReads === 2) settlementPhase = true;
          return read;
        }
      }
    });
    assert.equal(h.mutationCalls, 1);
    assert.equal(result.transition.disposition, 'VERIFIED');
    assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
    assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
    assert.equal(result.receiptPresent, true);
    assert.equal(result.attempt, result.transition.attempt);
    assert.equal(result.diagnostic.code, 'CLOCK_AFTER_REWARD');
    assert.equal(result.traceComplete, false);
    assert.equal(result.automaticMutationRetryAllowed, false);
    assert.ok(result.evidence);
    assert.equal(result.trace.records.some((record) => record.id === result.evidence.id), true);
    assert.equal(result.trace.records.filter((record) => record.kind === 'action').length, 1);
    assert.equal(Boolean(result.settlementVerification), failOnLateCall === 2);
  }
});

test('P7 freezes reward expectations before awaited baseline reads and evaluates the external key factory once', async () => {
  const h = makeHarness();
  await setupStage8(h.baseStore);
  const suppliedSpec = structuredClone(rewardSpec);
  let keys = 0;
  const result = await executeTmlVerifiedRewardTransition({
    ...executionOptions(h),
    rewardSpec: suppliedSpec,
    createExecutionKey: () => { keys += 1; return 'exec.p7.frozen-input'; },
    walletReadAdapter: {
      async read(request) {
        suppliedSpec.reward_version = 2;
        suppliedSpec.grants[0].amount = 999;
        return h.walletReadAdapter.read(request);
      }
    }
  });
  assert.equal(keys, 1);
  assert.equal(h.mutationCalls, 1);
  assert.equal(result.disposition, TML_P7_DISPOSITION.VERIFIED);
  assert.equal(result.executionKey, 'exec.p7.frozen-input');
  assert.equal(result.evidence.extensions.expected_deltas.currencies['currency.induck_coin'], 180);
});

test('PR2 settlement metadata preserves frozen evaluation inputs that reproduce its verdict', async () => {
  const h = makeHarness();
  await setupStage8(h.baseStore);
  const suppliedProfile = structuredClone(profile);
  const result = await executeTmlVerifiedRewardTransition({ ...executionOptions(h), profile: suppliedProfile });
  const captured = result.evidence.extensions.evaluation;

  assert.equal(result.disposition, TML_P7_DISPOSITION.VERIFIED);
  assert.equal(result.evidence.extensions.reward_spec_id, rewardSpec.id);
  assert.equal(result.evidence.extensions.reward_receipt_present, true);
  assert.ok(captured);
  assert.equal(captured.basis, 'CLAIM');
  assert.equal(captured.evaluator, 'tml.expression.v0.1');
  assert.deepEqual(captured.inputs.claim, result.evidence.claim);
  assert.equal(captured.result.status, TML_VERIFICATION_STATUS.SATISFIED);
  assert.deepEqual(
    evaluateTmlExpression(captured.inputs.claim, captured.inputs.facts, captured.inputs.profile),
    captured.result
  );
  assert.ok(Object.isFrozen(captured.inputs.claim.args[0].value));
  assert.ok(Object.isFrozen(captured.inputs.profile.authority[0]));
  assert.ok(Object.isFrozen(captured.inputs.facts[0].value));
  assert.ok(Object.isFrozen(captured.inputs.observations[0].facts));
  assert.equal(Object.isFrozen(suppliedProfile.authority[0]), false);
  suppliedProfile.authority[0].authority = 'client.changed';
  suppliedProfile.authority.length = 0;
  assert.deepEqual(
    evaluateTmlExpression(captured.inputs.claim, captured.inputs.facts, captured.inputs.profile),
    captured.result
  );
  assert.equal(h.mutationCalls, 1);
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('PR2 retained reward receipts, provider outputs, and trace facts own caller entries', async () => {
  const callerReceipt = structuredClone(rewardReceipt);
  const h = makeHarness({ receipt: callerReceipt });
  await setupStage8(h.baseStore);
  const result = await executeTmlVerifiedRewardTransition(executionOptions(h));
  const recordedProvider = structuredClone(result.transition.provider);
  const recordedReceipt = structuredClone(result.receipt);
  const recordedEvidence = structuredClone(result.evidence);
  const recordedTrace = structuredClone(result.trace);

  assert.equal(result.disposition, TML_P7_DISPOSITION.VERIFIED);
  assert.equal(Object.isFrozen(callerReceipt.entries[0]), false);
  callerReceipt.entries[0].granted = 999;
  callerReceipt.entries[1].targetId = 'exp.changed';
  callerReceipt.entries.push({ grantType: 'EXP', targetId: 'exp.later', granted: 1, status: 'GRANTED' });
  callerReceipt.rewardTransactionId = 'tx.changed';

  assert.deepEqual(result.transition.provider, recordedProvider);
  assert.deepEqual(result.receipt, recordedReceipt);
  assert.deepEqual(result.evidence, recordedEvidence);
  assert.deepEqual(result.trace, recordedTrace);
  assert.ok(Object.isFrozen(result.transition.provider.output.reward.entries[0]));
  assert.ok(Object.isFrozen(result.receipt.facts[0].extensions));
  assert.equal(h.mutationCalls, 1);
  assert.equal(result.dispatchStatus, 'ATTEMPTED');
  assert.equal(result.automaticMutationRetryAllowed, false);
});

test('PR2 reward trace admission failures retain the completed attempt and admitted receipt', async (t) => {
  for (const defect of ['conflicting fact ID', 'dangling observation reference']) await t.test(defect, async () => {
    const h = makeHarness();
    await setupStage8(h.baseStore);
    let walletReads = 0;
    let dispatches = 0;
    let preWallet;
    const result = await executeTmlVerifiedRewardTransition({
      ...executionOptions(h),
      questAdvanceAdapter: {
        async advance(request) {
          dispatches += 1;
          return h.questAdvanceAdapter.advance(request);
        }
      },
      walletReadAdapter: {
        async read(request) {
          const read = structuredClone(await h.walletReadAdapter.read(request));
          if (++walletReads === 1) {
            preWallet = read;
          } else if (defect === 'conflicting fact ID') {
            read.facts[0].id = preWallet.facts[0].id;
            read.observations[0].facts = [read.facts[0].id];
          } else {
            read.observations[0].facts.push('fact.pr2.reward.missing');
          }
          return read;
        }
      }
    });

    assert.equal(dispatches, 1);
    assert.equal(h.mutationCalls, 1);
    assert.equal(result.dispatchStatus, 'ATTEMPTED');
    assert.equal(result.attempt.dispatchStatus, 'ATTEMPTED');
    assert.equal(result.attempt.requestedExecutionKey, result.executionKey);
    assert.equal(result.transition.disposition, 'VERIFIED');
    assert.equal(result.transition.provider.output.reward.rewardVersion, 1);
    assert.equal(result.disposition, TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED);
    assert.equal(result.verification, TML_VERIFICATION_STATUS.UNKNOWN);
    assert.equal(result.receiptPresent, true);
    assert.equal(result.traceComplete, false);
    assert.ok(result.diagnostic.code);
    assert.equal(result.reads.preWallet.facts[0].value.value, 0);
    assert.equal(result.reads.postWallet.facts[0].value.value, 180);
    assert.equal(result.trace.records.filter((record) => record.kind === 'action').length, 1);
    assert.equal(result.trace.records.some((record) => record.kind === 'fact' && record.predicate === 'reward.version'), true);
    assert.equal(result.automaticMutationRetryAllowed, false);
  });
});
