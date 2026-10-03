import assert from 'node:assert/strict';
import test from 'node:test';

import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import {
  TML_MAIN2_SHADOW_REWARD,
  TML_MAIN2_SHADOW_TRANSITIONS
} from '../tml/runtime/main2-shadow-contract.mjs';
import {
  createTmlMain2Shadow,
  TML_MAIN2_SHADOW_STATUS
} from '../tml/runtime/main2-shadow.mjs';

const NOW = '2026-10-03T12:40:00+09:00';

const rewardReceipt = Object.freeze({
  rewardId: TML_MAIN2_SHADOW_REWARD.rewardId,
  rewardVersion: TML_MAIN2_SHADOW_REWARD.rewardVersion,
  rewardTransactionId: 'tx-p10',
  status: 'SUCCESS',
  replayed: false,
  completedAt: NOW,
  entries: TML_MAIN2_SHADOW_REWARD.grants.map((grant) => ({
    grantType: grant.grantType,
    targetId: grant.targetId,
    requested: grant.amount,
    granted: grant.amount,
    status: 'GRANTED',
    reason: null
  }))
});

function observeFullRun(shadow) {
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  for (let stage = 0; stage < TML_MAIN2_SHADOW_TRANSITIONS.length; stage += 1) {
    const transition = TML_MAIN2_SHADOW_TRANSITIONS[stage];
    shadow.observeQuestResult({
      event: transition.event,
      previousStage: stage,
      previousAvailable: true,
      result: {
        quest_id: MAIN2_QUEST_ID,
        stage: stage + 1,
        available: true,
        ...(stage === 8 ? { reward: rewardReceipt } : {})
      },
      economicBefore: { walletBalance: 0, totalExp: 100 }
    });
  }

  shadow.observeEconomicState({ walletBalance: 180, totalExp: 100 });
  shadow.observeEconomicState({ walletBalance: 180, totalExp: 200 });
}

test('P10 aggregates full Main 2 parity by transition, reward receipt and settlement', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  observeFullRun(shadow);

  const parity = shadow.status().parity;

  assert.deepEqual(
    {
      observed: parity.transition.observed,
      matches: parity.transition.matches,
      mismatches: parity.transition.mismatches,
      parityRatio: parity.transition.parityRatio
    },
    { observed: 9, matches: 9, mismatches: 0, parityRatio: 1 }
  );

  for (const transition of TML_MAIN2_SHADOW_TRANSITIONS) {
    assert.deepEqual(parity.transition.byTransition[transition.transitionId], {
      observed: 1,
      matches: 1,
      mismatches: 0,
      parityRatio: 1
    });
  }

  assert.deepEqual(parity.rewardReceipt, {
    observed: 1,
    matches: 1,
    mismatches: 0,
    parityRatio: 1
  });

  assert.deepEqual(parity.rewardSettlement, {
    observed: 1,
    matches: 1,
    mismatches: 0,
    pending: 0,
    unknown: 0,
    parityRatio: 1,
    coverageRatio: 1
  });

  assert.deepEqual(parity.combined, {
    resolved: 11,
    matches: 11,
    mismatches: 0,
    parityRatio: 1,
    unresolved: 0
  });
  assert.equal(parity.reasons.TML_TRANSITION_MATCH, 9);
  assert.equal(parity.reasons.REWARD_RECEIPT_MATCH, 1);
  assert.equal(parity.reasons.TML_SETTLEMENT_MATCH, 1);
  assert.deepEqual(parity.recentMismatches, []);
});

test('P10 status refresh observations are tracked but excluded from parity denominator', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });

  for (const stage of [0, 4, 9]) {
    shadow.observeQuestResult({
      event: 'status',
      previousStage: stage,
      previousAvailable: true,
      result: {
        quest_id: MAIN2_QUEST_ID,
        stage,
        available: true
      }
    });
  }

  const parity = shadow.status().parity;
  assert.equal(parity.statusObservations, 3);
  assert.equal(parity.transition.observed, 0);
  assert.equal(parity.combined.resolved, 0);
  assert.equal(parity.combined.parityRatio, null);
});

test('P10 separates transition parity from reward receipt parity', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  const report = shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: { ...rewardReceipt, rewardVersion: rewardReceipt.rewardVersion + 1 }
    },
    economicBefore: { walletBalance: 0, totalExp: 100 }
  });

  assert.equal(report.status, TML_MAIN2_SHADOW_STATUS.MISMATCH);
  assert.equal(report.transitionStatus, TML_MAIN2_SHADOW_STATUS.MATCH);

  const parity = shadow.status().parity;
  const bucket = parity.transition.byTransition[TML_MAIN2_SHADOW_TRANSITIONS[8].transitionId];

  assert.deepEqual(bucket, { observed: 1, matches: 1, mismatches: 0, parityRatio: 1 });
  assert.deepEqual(parity.rewardReceipt, {
    observed: 1,
    matches: 0,
    mismatches: 1,
    parityRatio: 0
  });
  assert.deepEqual(parity.combined, {
    resolved: 2,
    matches: 1,
    mismatches: 1,
    parityRatio: 0.5,
    unresolved: 0
  });
  assert.equal(parity.reasons.REWARD_RECEIPT_MISMATCH, 1);
  assert.equal(parity.recentMismatches.length, 1);
  assert.equal(parity.recentMismatches[0].rewardReason, 'REWARD_RECEIPT_MISMATCH');
});

test('P10 records settlement mismatch independently from a matching transition and receipt', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: rewardReceipt
    },
    economicBefore: { walletBalance: 0, totalExp: 100 }
  });

  shadow.observeEconomicState({ walletBalance: 100, totalExp: 200 });

  const parity = shadow.status().parity;
  assert.equal(parity.transition.matches, 1);
  assert.equal(parity.rewardReceipt.matches, 1);
  assert.deepEqual(parity.rewardSettlement, {
    observed: 1,
    matches: 0,
    mismatches: 1,
    pending: 0,
    unknown: 0,
    parityRatio: 0,
    coverageRatio: 1
  });
  assert.deepEqual(parity.combined, {
    resolved: 3,
    matches: 2,
    mismatches: 1,
    parityRatio: 2 / 3,
    unresolved: 0
  });
  assert.equal(parity.reasons.TML_SETTLEMENT_MISMATCH, 1);
  assert.equal(parity.recentMismatches.at(-1).walletDelta, 100);
  assert.equal(parity.recentMismatches.at(-1).expDelta, 100);
});

test('P10 recent mismatch samples are bounded and carry no identity or raw reward payload', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });

  for (let i = 0; i < 27; i += 1) {
    shadow.observeQuestResult({
      event: 'wrong_event',
      previousStage: 4,
      previousAvailable: true,
      result: {
        quest_id: MAIN2_QUEST_ID,
        stage: 5,
        available: true
      }
    });
  }

  const samples = shadow.status().parity.recentMismatches;
  assert.equal(samples.length, 20);
  for (const sample of samples) {
    assert.deepEqual(
      Object.keys(sample).sort(),
      [
        'actualStage',
        'event',
        'expDelta',
        'expectedStage',
        'kind',
        'previousStage',
        'reason',
        'rewardReason',
        'transitionId',
        'walletDelta'
      ].sort()
    );
    assert.equal('userId' in sample, false);
    assert.equal('reward' in sample, false);
  }
});

test('P10 scope reset clears pending account state but preserves aggregate parity', () => {
  const shadow = createTmlMain2Shadow({ enabled: true });
  shadow.observeEconomicState({ walletBalance: 0, totalExp: 100 });

  shadow.observeQuestResult({
    event: 'visit_back_gate',
    previousStage: 8,
    previousAvailable: true,
    result: {
      quest_id: MAIN2_QUEST_ID,
      stage: 9,
      available: true,
      reward: rewardReceipt
    },
    economicBefore: { walletBalance: 0, totalExp: 100 }
  });

  assert.equal(shadow.status().pendingReward, true);
  const before = shadow.status().parity.combined;

  shadow.resetScope('SIGNED_IN_OR_SWITCHED');

  const status = shadow.status();
  assert.equal(status.pendingReward, false);
  assert.deepEqual(status.economic, { walletBalance: null, totalExp: null });
  assert.equal(status.latest, null);
  assert.deepEqual(status.parity.combined, before);
  assert.equal(status.parity.scopeResets, 1);
  assert.equal(status.parity.reasons.SCOPE_RESET_SIGNED_IN_OR_SWITCHED, 1);
});
