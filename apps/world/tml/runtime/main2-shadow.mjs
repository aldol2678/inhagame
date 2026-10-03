import { isQuestRewardResult } from '../../npc-factory/quest-reward-shape.mjs';
import {
  TML_MAIN2_SHADOW_MODE,
  TML_MAIN2_SHADOW_REWARD,
  isTmlMain2ShadowResult,
  tmlMain2ShadowTransition
} from './main2-shadow-contract.mjs';

export const TML_MAIN2_SHADOW_STATUS = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
  IDLE: 'IDLE'
});

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

export function createTmlMain2Shadow({ enabled = true } = {}) {
  let observations = 0;
  let matches = 0;
  let mismatches = 0;
  let latest = null;
  let pendingReward = null;
  let economic = normalizeEconomicSnapshot(null);

  function record(report) {
    observations += 1;
    latest = Object.freeze(report);
    if (report.status === TML_MAIN2_SHADOW_STATUS.MATCH) matches += 1;
    if (report.status === TML_MAIN2_SHADOW_STATUS.MISMATCH) mismatches += 1;
    return latest;
  }

  function observeQuestResult({ event, previousStage, previousAvailable, result, economicBefore } = {}) {
    if (!enabled) return null;
    if (!isTmlMain2ShadowResult(result)) {
      return record({
        kind: 'quest',
        status: TML_MAIN2_SHADOW_STATUS.MISMATCH,
        reason: 'INVALID_SERVER_RESULT',
        event: event ?? null,
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        actualStage: result?.stage ?? null
      });
    }

    if (event === 'status') {
      return record({
        kind: 'status',
        status: TML_MAIN2_SHADOW_STATUS.MATCH,
        reason: 'AUTHORITATIVE_STATUS_OBSERVED',
        previousStage: Number.isInteger(previousStage) ? previousStage : null,
        previousAvailable: previousAvailable === true,
        actualStage: result.stage,
        actualAvailable: result.available
      });
    }

    const expected = tmlMain2ShadowTransition(previousStage);
    const eventMatch = expected?.event === event;
    const stageMatch = expected?.to === result.stage;
    const availableMatch = previousStage !== 0 || previousAvailable === true || result.stage === 0;
    const questMatch = Boolean(expected && eventMatch && stageMatch && availableMatch);

    const report = {
      kind: 'transition',
      status: questMatch ? TML_MAIN2_SHADOW_STATUS.MATCH : TML_MAIN2_SHADOW_STATUS.MISMATCH,
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

    return record(report);
  }

  function observeEconomicState(snapshot) {
    if (!enabled) return null;
    economic = normalizeEconomicSnapshot(snapshot);
    if (!pendingReward) return null;

    const before = pendingReward.before;
    if (before.walletBalance === null || before.totalExp === null ||
        economic.walletBalance === null || economic.totalExp === null) {
      latest = Object.freeze({
        ...(latest ?? {}),
        rewardStatus: TML_MAIN2_SHADOW_STATUS.UNKNOWN,
        rewardReason: 'ECONOMIC_READBACK_UNAVAILABLE'
      });
      return latest;
    }

    const walletDelta = economic.walletBalance - before.walletBalance;
    const expDelta = economic.totalExp - before.totalExp;
    const walletMatch = walletDelta === 180;
    const expMatch = expDelta === 100;
    const settlementMatch = walletMatch && expMatch;

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

    if (!settlementMatch) mismatches += 1;
    pendingReward = null;
    return latest;
  }

  return Object.freeze({
    mode: TML_MAIN2_SHADOW_MODE,
    observeQuestResult,
    observeEconomicState,
    status() {
      return Object.freeze({
        mode: TML_MAIN2_SHADOW_MODE,
        enabled: Boolean(enabled),
        observations,
        matches,
        mismatches,
        pendingReward: pendingReward !== null,
        economic,
        latest
      });
    }
  });
}
