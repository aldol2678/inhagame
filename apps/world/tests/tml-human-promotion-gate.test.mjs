import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import {
  buildTmlMain2HumanPromotionReview,
  TML_HUMAN_PROMOTION_GATE_STATUS,
  TML_MAIN2_PROMOTION_GATE_CONTRACT
} from '../tml/runtime/human-promotion-gate.mjs';
import {
  TML_MAIN2_SHADOW_REWARD,
  TML_MAIN2_SHADOW_TRANSITIONS
} from '../tml/runtime/main2-shadow-contract.mjs';
import { createTmlMain2Shadow } from '../tml/runtime/main2-shadow.mjs';

const NOW = '2026-10-03T13:10:00+09:00';
const TRANSITION_IDS = TML_MAIN2_SHADOW_TRANSITIONS.map((item) => item.transitionId);

function byTransition({ observed = 10, mismatches = 0 } = {}) {
  return Object.fromEntries(TRANSITION_IDS.map((transitionId) => [
    transitionId,
    {
      observed,
      matches: observed - mismatches,
      mismatches,
      parityRatio: observed > 0 ? (observed - mismatches) / observed : null
    }
  ]));
}

function readyShadowStatus(overrides = {}) {
  const thresholds = {
    minResolvedSamples: 100,
    minTransitionSamples: 5,
    minRewardReceiptSamples: 5,
    minRewardSettlementSamples: 5,
    minSettlementCoverageRatio: 0.95,
    maxMismatches: 0
  };

  const parity = {
    transition: {
      observed: 90,
      matches: 90,
      mismatches: 0,
      parityRatio: 1,
      byTransition: byTransition()
    },
    rewardReceipt: {
      observed: 10,
      matches: 10,
      mismatches: 0,
      parityRatio: 1
    },
    rewardSettlement: {
      observed: 10,
      matches: 10,
      mismatches: 0,
      pending: 0,
      unknown: 0,
      parityRatio: 1,
      coverageRatio: 1
    },
    combined: {
      resolved: 110,
      matches: 110,
      mismatches: 0,
      parityRatio: 1,
      unresolved: 0
    },
    statusObservations: 8,
    scopeResets: 1,
    reasons: { TML_TRANSITION_MATCH: 90, REWARD_RECEIPT_MATCH: 10, TML_SETTLEMENT_MATCH: 10 },
    recentMismatches: []
  };

  return {
    mode: 'SHADOW_P9',
    enabled: true,
    observations: 98,
    matches: 98,
    mismatches: 0,
    pendingReward: false,
    economic: { walletBalance: 180, totalExp: 200 },
    latest: null,
    parity,
    readiness: {
      status: 'READY_CANDIDATE',
      advisoryOnly: true,
      authorityChangeAllowed: false,
      thresholds,
      transitionIds: TRANSITION_IDS,
      dataGaps: [],
      reviewReasons: [],
      evidence: {}
    },
    ...overrides
  };
}

test('P12 clean READY_CANDIDATE becomes HUMAN_REVIEW_REQUIRED, never auto-approved', () => {
  const review = buildTmlMain2HumanPromotionReview({
    shadowStatus: readyShadowStatus(),
    generatedAt: NOW
  });

  assert.equal(review.schema, 'tml.human-promotion-review');
  assert.equal(review.version, '0.1');
  assert.equal(review.contract, TML_MAIN2_PROMOTION_GATE_CONTRACT);
  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.HUMAN_REVIEW_REQUIRED);
  assert.equal(review.advisoryOnly, true);
  assert.equal(review.authorityChangeAllowed, false);
  assert.deepEqual(review.authority, {
    current: 'legacy-main2',
    candidate: 'tml-main2',
    currentRemainsAuthoritative: true
  });
  assert.equal(review.nextAction, 'HUMAN_REVIEW_ONLY');
  assert.ok(review.machineChecks.every((item) => item.passed));
  assert.deepEqual(review.failedMachineChecks, []);
  assert.ok(review.humanChecklist.length >= 5);
  assert.ok(review.humanChecklist.every((item) =>
    item.required === true && item.state === 'UNCONFIRMED'
  ));
});

test('P12 NOT_ENOUGH_DATA or REVIEW readiness stays BLOCKED', () => {
  for (const readinessStatus of ['NOT_ENOUGH_DATA', 'REVIEW']) {
    const status = readyShadowStatus();
    status.readiness = {
      ...status.readiness,
      status: readinessStatus,
      dataGaps: readinessStatus === 'NOT_ENOUGH_DATA'
        ? [{ code: 'RESOLVED_SAMPLES_BELOW_MINIMUM', actual: 10, required: 100, detail: null }]
        : [],
      reviewReasons: readinessStatus === 'REVIEW'
        ? [{ code: 'COMBINED_MISMATCHES_EXCEED_LIMIT', actual: 1, required: 0, detail: null }]
        : []
    };

    const review = buildTmlMain2HumanPromotionReview({
      shadowStatus: status,
      generatedAt: NOW
    });

    assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.BLOCKED);
    assert.equal(review.authorityChangeAllowed, false);
    assert.ok(review.failedMachineChecks.some((item) => item.id === 'readiness-candidate'));
  }
});

test('P12 pending settlement blocks human review even if readiness snapshot claims candidate', () => {
  const review = buildTmlMain2HumanPromotionReview({
    shadowStatus: readyShadowStatus({ pendingReward: true }),
    generatedAt: NOW
  });

  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.BLOCKED);
  assert.ok(review.failedMachineChecks.some((item) => item.id === 'no-pending-settlement'));
});

test('P12 recent mismatch history blocks review even if stale readiness says READY_CANDIDATE', () => {
  const status = readyShadowStatus();
  status.parity = {
    ...status.parity,
    recentMismatches: [{
      kind: 'transition',
      reason: 'TML_TRANSITION_MISMATCH',
      transitionId: TRANSITION_IDS[3],
      event: 'wrong',
      previousStage: 3,
      expectedStage: 4,
      actualStage: 3,
      rewardReason: null,
      walletDelta: null,
      expDelta: null
    }]
  };

  const review = buildTmlMain2HumanPromotionReview({
    shadowStatus: status,
    generatedAt: NOW
  });

  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.BLOCKED);
  assert.ok(review.failedMachineChecks.some((item) => item.id === 'no-recent-mismatch'));
  assert.equal(review.evidence.parity.recentMismatches.length, 1);
});

test('P12 settlement coverage check independently hardens inconsistent readiness snapshots', () => {
  const status = readyShadowStatus();
  status.parity = {
    ...status.parity,
    rewardSettlement: {
      ...status.parity.rewardSettlement,
      coverageRatio: 0.8
    }
  };

  const review = buildTmlMain2HumanPromotionReview({
    shadowStatus: status,
    generatedAt: NOW
  });

  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.BLOCKED);
  const failed = review.failedMachineChecks.find((item) =>
    item.id === 'settlement-coverage-meets-readiness'
  );
  assert.deepEqual(failed.detail, { actual: 0.8, required: 0.95 });
});

test('P12 review packet copies only selected evidence and carries no raw account/reward payload', () => {
  const status = readyShadowStatus({
    userId: 'should-never-be-copied',
    rawReward: { secret: true }
  });
  status.parity.userId = 'also-ignored';
  status.parity.rawReward = { hidden: true };

  const review = buildTmlMain2HumanPromotionReview({
    shadowStatus: status,
    generatedAt: NOW
  });

  const serialized = JSON.stringify(review);
  assert.doesNotMatch(serialized, /should-never-be-copied|also-ignored|"secret"|"hidden"/);
  assert.equal(review.contracts.rewardSpecId, TML_MAIN2_SHADOW_REWARD.specId);
  assert.deepEqual(review.contracts.transitionIds, TRANSITION_IDS);
  assert.throws(() => {
    review.humanChecklist[0].state = 'CONFIRMED';
  }, TypeError);
});

test('P12 shadow can produce a review packet but exposes no approve/promote/authority mutation API', () => {
  const shadow = createTmlMain2Shadow({
    enabled: true,
    readinessThresholds: {
      minResolvedSamples: 0,
      minTransitionSamples: 0,
      minRewardReceiptSamples: 0,
      minRewardSettlementSamples: 0,
      minSettlementCoverageRatio: 0,
      maxMismatches: 0
    }
  });

  const review = shadow.promotionReview({ generatedAt: NOW });

  assert.ok(review);
  assert.equal(review.authorityChangeAllowed, false);
  assert.equal('approve' in shadow, false);
  assert.equal('promote' in shadow, false);
  assert.equal('activate' in shadow, false);
  assert.equal('setAuthority' in shadow, false);
});

test('P12 full observed run produces a human-review packet with immutable evidence', () => {
  const shadow = createTmlMain2Shadow({
    enabled: true,
    readinessThresholds: {
      minResolvedSamples: 11,
      minTransitionSamples: 1,
      minRewardReceiptSamples: 1,
      minRewardSettlementSamples: 1,
      minSettlementCoverageRatio: 1,
      maxMismatches: 0
    }
  });

  const reward = {
    rewardId: TML_MAIN2_SHADOW_REWARD.rewardId,
    rewardVersion: TML_MAIN2_SHADOW_REWARD.rewardVersion,
    rewardTransactionId: 'tx-p12',
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
  };

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
        ...(stage === 8 ? { reward } : {})
      },
      economicBefore: { walletBalance: 0, totalExp: 100 }
    });
  }

  shadow.observeEconomicState({ walletBalance: 180, totalExp: 100 });
  shadow.observeEconomicState({ walletBalance: 180, totalExp: 200 });

  const review = shadow.promotionReview({ generatedAt: NOW });

  assert.equal(review.status, TML_HUMAN_PROMOTION_GATE_STATUS.HUMAN_REVIEW_REQUIRED);
  assert.equal(review.evidence.readiness.status, 'READY_CANDIDATE');
  assert.equal(review.evidence.parity.combined.parityRatio, 1);
  assert.equal(review.evidence.parity.rewardSettlement.coverageRatio, 1);
  assert.deepEqual(review.evidence.parity.recentMismatches, []);
});

test('P12 live runtime only exposes the packet for review and never consumes it to switch authority', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../tml/runtime/human-promotion-gate.mjs', import.meta.url), 'utf8');

  assert.match(runtime, /tml_main2_promotion_review: tmlMain2Shadow\.promotionReview\(\)/);
  assert.doesNotMatch(main, /tml_main2_promotion_review|HUMAN_REVIEW_REQUIRED|authorityChangeAllowed/);
  assert.doesNotMatch(runtime, /if\s*\([^)]*tml_main2_promotion_review|READY_CANDIDATE[\s\S]*?setQuestEnabled/);
  assert.doesNotMatch(gate, /fetch\s*\(|supabase|rpc\s*\(|localStorage|sessionStorage/i);
  assert.doesNotMatch(gate, /approve\s*\(|promote\s*\(|setAuthority\s*\(/);
});
