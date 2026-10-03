import { isQuestRewardResult } from '../../npc-factory/quest-reward-shape.mjs';
import {
  TML_MAIN2_SHADOW_MODE,
  TML_MAIN2_SHADOW_REWARD,
  isTmlMain2ShadowResult,
  tmlMain2ShadowTransition
} from './main2-shadow-contract.mjs';
import { evaluateTmlMain2ShadowReadiness } from './shadow-readiness.mjs';
import { buildTmlMain2HumanPromotionReview } from './human-promotion-gate.mjs';

export const TML_MAIN2_SHADOW_STATUS = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
  IDLE: 'IDLE'
});

const RECENT_MISMATCH_LIMIT = 20;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function rewardMatches(reward) {
  if (!isQuestRewardResult(reward)) return false;
  if (reward.rewardId !== TML_MAIN2_SHADOW_REWARD.rewardId) return false;
  if (reward.rewardVersion !== TML_MAIN2_SHADOW_REWARD.rewardVersion) return false;
  if (reward.status !== 'SUCCESS' || reward.replayed === true) return false;
  for (const expected of TML_MAIN2_SHADOW_REWARD.grants) {
    const entry = reward.entries.find((item) =>
      item.grantType === expected.grantType &&
      item.targetId === expected.targetId
    );
    if (!entry || entry.status !== 'GRANTED' || entry.granted !== expected.amount) return false;
  }
  return true;
}

function normalizeEconomicSnapshot(snapshot) {
  return Object.freeze({
    walletBalance: Number.isSafeInteger(snapshot?.walletBalance) && snapshot.walletBalance >= 0
      ? snapshot.walletBalance
      : null,
    totalExp: Number.isSafeInteger(snapshot?.totalExp) && snapshot.totalExp >= 0
      ? snapshot.totalExp
      : null
  });
}

function ratio(matches, resolved) {
  return resolved > 0 ? matches / resolved : null;
}

function coverage(resolved, pending, unknown) {
  const total = resolved + pending + unknown;
  return total > 0 ? resolved / total : null;
}

function mismatchSample(report) {
  return Object.freeze({
    kind: report.kind ?? null,
    reason: report.reason ?? report.rewardReason ?? null,
    transitionId: report.transitionId ?? null,
    event: report.event ?? null,
    previousStage: Number.isInteger(report.previousStage) ? report.previousStage : null,
    expectedStage: Number.isInteger(report.expectedStage) ? report.expectedStage : null,
    actualStage: Number.isInteger(report.actualStage) ? report.actualStage : null,
    rewardReason: report.rewardReason ?? null,
    walletDelta: Number.isFinite(report.walletDelta) ? report.walletDelta : null,
    expDelta: Number.isFinite(report.expDelta) ? report.expDelta : null
  });
}

function createParityAccumulator() {
  const transition = {
    observed: 0,
    matches: 0,
    mismatches: 0,
    byTransition: Object.create(null)
  };
  const receipt = { observed: 0, matches: 0, mismatches: 0 };
  const settlement = { observed: 0, matches: 0, mismatches: 0, pending: 0, unknown: 0 };
  const reasons = Object.create(null);
  const recentMismatches = [];
  let statusObservations = 0;
  let scopeResets = 0;

  const reason = (name) => {
    const key = typeof name === 'string' && name ? name : 'UNSPECIFIED';
    reasons[key] = (reasons[key] ?? 0) + 1;
  };

  const rememberMismatch = (report) => {
    recentMismatches.push(mismatchSample(report));
    if (recentMismatches.length > RECENT_MISMATCH_LIMIT) recentMismatches.shift();
  };

  const transitionBucket = (transitionId) => {
    const key = transitionId ?? 'UNRESOLVED';
    if (!transition.byTransition[key]) {
      transition.byTransition[key] = { observed: 0, matches: 0, mismatches: 0 };
    }
    return transition.byTransition[key];
  };

  return Object.freeze({
    observeStatus(report) {
      statusObservations += 1;
      reason(report.reason);
    },

    observeTransition(report) {
      transition.observed += 1;
      const bucket = transitionBucket(report.transitionId);
      bucket.observed += 1;
      const state = report.transitionStatus ?? report.status;
      if (state === TML_MAIN2_SHADOW_STATUS.MATCH) {
        transition.matches += 1;
        bucket.matches += 1;
      } else if (state === TML_MAIN2_SHADOW_STATUS.MISMATCH) {
        transition.mismatches += 1;
        bucket.mismatches += 1;
        rememberMismatch({ ...report, reason: report.transitionReason ?? report.reason });
      }
      reason(report.transitionReason ?? report.reason);

      if (report.rewardStatus === TML_MAIN2_SHADOW_STATUS.PENDING ||
          report.rewardStatus === TML_MAIN2_SHADOW_STATUS.MATCH) {
        receipt.observed += 1;
        receipt.matches += 1;
        reason('REWARD_RECEIPT_MATCH');
      } else if (report.rewardStatus === TML_MAIN2_SHADOW_STATUS.MISMATCH) {
        receipt.observed += 1;
        receipt.mismatches += 1;
        reason(report.rewardReason ?? 'REWARD_RECEIPT_MISMATCH');
        rememberMismatch(report);
      }
    },

    observeSettlement(report) {
      settlement.observed += 1;
      if (report.rewardStatus === TML_MAIN2_SHADOW_STATUS.MATCH) {
        settlement.matches += 1;
      } else if (report.rewardStatus === TML_MAIN2_SHADOW_STATUS.MISMATCH) {
        settlement.mismatches += 1;
        rememberMismatch(report);
      } else if (report.rewardStatus === TML_MAIN2_SHADOW_STATUS.PENDING) {
        settlement.pending += 1;
      } else {
        settlement.unknown += 1;
      }
      reason(report.rewardReason);
    },

    scopeReset(reasonName) {
      scopeResets += 1;
      reason(`SCOPE_RESET_${reasonName ?? 'UNSPECIFIED'}`);
    },

    snapshot() {
      const transitionResolved = transition.matches + transition.mismatches;
      const receiptResolved = receipt.matches + receipt.mismatches;
      const settlementResolved = settlement.matches + settlement.mismatches;
      const combinedMatches = transition.matches + receipt.matches + settlement.matches;
      const combinedMismatches = transition.mismatches + receipt.mismatches + settlement.mismatches;
      const combinedResolved = combinedMatches + combinedMismatches;
      const pending = settlement.pending;
      const unknown = settlement.unknown;

      return Object.freeze({
        transition: Object.freeze({
          observed: transition.observed,
          matches: transition.matches,
          mismatches: transition.mismatches,
          parityRatio: ratio(transition.matches, transitionResolved),
          byTransition: Object.freeze(Object.fromEntries(
            Object.entries(transition.byTransition).map(([id, value]) => [
              id,
              Object.freeze({
                ...value,
                parityRatio: ratio(value.matches, value.matches + value.mismatches)
              })
            ])
          ))
        }),
        rewardReceipt: Object.freeze({
          ...receipt,
          parityRatio: ratio(receipt.matches, receiptResolved)
        }),
        rewardSettlement: Object.freeze({
          ...settlement,
          parityRatio: ratio(settlement.matches, settlementResolved),
          coverageRatio: coverage(settlementResolved, pending, unknown)
        }),
        combined: Object.freeze({
          resolved: combinedResolved,
          matches: combinedMatches,
          mismatches: combinedMismatches,
          parityRatio: ratio(combinedMatches, combinedResolved),
          unresolved: pending + unknown
        }),
        statusObservations,
        scopeResets,
        reasons: Object.freeze({ ...reasons }),
        recentMismatches: Object.freeze([...recentMismatches])
      });
    }
  });
}

export function createTmlMain2Shadow({ enabled = true, readinessThresholds } = {}) {
  let observations = 0;
  let matches = 0;
  let mismatches = 0;
  let latest = null;
  let pendingReward = null;
  let economic = normalizeEconomicSnapshot(null);
  const parity = createParityAccumulator();

  function record(report) {
    observations += 1;
    latest = Object.freeze(report);
    if (report.status === TML_MAIN2_SHADOW_STATUS.MATCH) matches += 1;
    if (report.status === TML_MAIN2_SHADOW_STATUS.MISMATCH) mismatches += 1;
    return latest;
  }

  function resetScope(reason = 'ACCOUNT_BOUNDARY') {
    pendingReward = null;
    economic = normalizeEconomicSnapshot(null);
    latest = null;
    parity.scopeReset(reason);
  }

  function observeQuestResult({ event, previousStage, previousAvailable, result, economicBefore } = {}) {
    if (!enabled) return null;
    if (!isTmlMain2ShadowResult(result)) {
      const report = {
        kind: 'quest',
        status: TML_MAIN2_SHADOW_STATUS.MISMATCH,
        transitionStatus: TML_MAIN2_SHADOW_STATUS.MISMATCH,
        transitionReason: 'INVALID_SERVER_RESULT',
        reason: 'INVALID_SERVER_RESULT',
        event: event ?? null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result?.stage ?? null
      };
      parity.observeTransition(report);
      return record(report);
    }

    if (event === 'status') {
      const report = {
        kind: 'status',
        status: TML_MAIN2_SHADOW_STATUS.MATCH,
        reason: 'AUTHORITATIVE_STATUS_OBSERVED',
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        previousAvailable: previousAvailable === true,
        actualStage: result.stage,
        actualAvailable: result.available
      };
      parity.observeStatus(report);
      return record(report);
    }

    const expected = tmlMain2ShadowTransition(previousStage);
    const eventMatch = expected?.event === event;
    const stageMatch = expected?.to === result.stage;
    const availableMatch = previousStage !== 0 || previousAvailable === true || result.stage === 0;
    const questMatch = Boolean(expected && eventMatch && stageMatch && availableMatch);

    const report = {
      kind: 'transition',
      status: questMatch ? TML_MAIN2_SHADOW_STATUS.MATCH : TML_MAIN2_SHADOW_STATUS.MISMATCH,
      transitionStatus: questMatch ? TML_MAIN2_SHADOW_STATUS.MATCH : TML_MAIN2_SHADOW_STATUS.MISMATCH,
      transitionReason: questMatch ? 'TML_TRANSITION_MATCH' : 'TML_TRANSITION_MISMATCH',
      reason: questMatch ? 'TML_TRANSITION_MATCH' : 'TML_TRANSITION_MISMATCH',
      transitionId: expected?.transitionId ?? null,
      event: event ?? null,
      expectedEvent: expected?.event ?? null,
      previousStage,
      expectedStage: expected?.to ?? null,
      actualStage: result.stage,
      actualAvailable: result.available,
      rewardStatus: null
    };

    if (previousStage === 8 && event === 'visit_back_gate' && result.stage === 9) {
      const before = normalizeEconomicSnapshot(economicBefore ?? economic);
      const receiptMatch = rewardMatches(result.reward);
      report.rewardStatus = receiptMatch
        ? TML_MAIN2_SHADOW_STATUS.PENDING
        : TML_MAIN2_SHADOW_STATUS.MISMATCH;
      report.rewardReason = receiptMatch ? 'WAITING_ECONOMIC_READBACK' : 'REWARD_RECEIPT_MISMATCH';
      report.rewardSpecId = TML_MAIN2_SHADOW_REWARD.specId;
      pendingReward = receiptMatch
        ? {
            before,
            reward: clone(result.reward),
            transitionId: expected?.transitionId ?? null
          }
        : null;

      if (!receiptMatch) {
        report.status = TML_MAIN2_SHADOW_STATUS.MISMATCH;
        report.reason = 'TML_REWARD_RECEIPT_MISMATCH';
      }
    }

    parity.observeTransition(report);
    return record(report);
  }

  function observeEconomicState(snapshot) {
    if (!enabled) return null;
    economic = normalizeEconomicSnapshot(snapshot);
    if (!pendingReward) return null;

    const before = pendingReward.before;
    if (before.walletBalance === null || before.totalExp === null) {
      latest = Object.freeze({
        ...(latest ?? {}),
        rewardStatus: TML_MAIN2_SHADOW_STATUS.UNKNOWN,
        rewardReason: 'ECONOMIC_BASELINE_UNAVAILABLE'
      });
      parity.observeSettlement(latest);
      pendingReward = null;
      return latest;
    }

    if (economic.walletBalance === null || economic.totalExp === null) {
      latest = Object.freeze({
        ...(latest ?? {}),
        rewardStatus: TML_MAIN2_SHADOW_STATUS.PENDING,
        rewardReason: 'WAITING_ECONOMIC_READBACK'
      });
      return latest;
    }

    const coinGrant = TML_MAIN2_SHADOW_REWARD.grants.find((grant) => grant.grantType === 'CURRENCY');
    const expGrant = TML_MAIN2_SHADOW_REWARD.grants.find((grant) => grant.grantType === 'EXP');
    const walletDelta = economic.walletBalance - before.walletBalance;
    const expDelta = economic.totalExp - before.totalExp;
    const walletMatch = walletDelta === coinGrant?.amount;
    const expMatch = expDelta === expGrant?.amount;
    const settlementMatch = walletMatch && expMatch;
    const awaitingOtherReadback =
      (walletDelta === 0 && expDelta >= 0 && (expDelta === 0 || expMatch)) ||
      (expDelta === 0 && walletDelta >= 0 && (walletDelta === 0 || walletMatch));

    if (!settlementMatch && awaitingOtherReadback) {
      latest = Object.freeze({
        ...(latest ?? {}),
        rewardStatus: TML_MAIN2_SHADOW_STATUS.PENDING,
        rewardReason: 'WAITING_ECONOMIC_READBACK',
        walletBefore: before.walletBalance,
        walletAfter: economic.walletBalance,
        walletDelta,
        expBefore: before.totalExp,
        expAfter: economic.totalExp,
        expDelta
      });
      return latest;
    }

    latest = Object.freeze({
      ...(latest ?? {}),
      status: settlementMatch && latest?.status === TML_MAIN2_SHADOW_STATUS.MATCH
        ? TML_MAIN2_SHADOW_STATUS.MATCH
        : TML_MAIN2_SHADOW_STATUS.MISMATCH,
      rewardStatus: settlementMatch
        ? TML_MAIN2_SHADOW_STATUS.MATCH
        : TML_MAIN2_SHADOW_STATUS.MISMATCH,
      rewardReason: settlementMatch ? 'TML_SETTLEMENT_MATCH' : 'TML_SETTLEMENT_MISMATCH',
      walletBefore: before.walletBalance,
      walletAfter: economic.walletBalance,
      walletDelta,
      expBefore: before.totalExp,
      expAfter: economic.totalExp,
      expDelta
    });

    parity.observeSettlement(latest);
    if (!settlementMatch) mismatches += 1;
    pendingReward = null;
    return latest;
  }

  return Object.freeze({
    mode: TML_MAIN2_SHADOW_MODE,
    observeQuestResult,
    observeEconomicState,
    resetScope,
    promotionReview({ generatedAt } = {}) {
      return buildTmlMain2HumanPromotionReview({
        shadowStatus: this.status(),
        ...(generatedAt ? { generatedAt } : {})
      });
    },
    status() {
      const paritySnapshot = parity.snapshot();
      return Object.freeze({
        mode: TML_MAIN2_SHADOW_MODE,
        enabled: Boolean(enabled),
        observations,
        matches,
        mismatches,
        pendingReward: pendingReward !== null,
        economic,
        latest,
        parity: paritySnapshot,
        readiness: evaluateTmlMain2ShadowReadiness({
          parity: paritySnapshot,
          thresholds: readinessThresholds
        })
      });
    }
  });
}
