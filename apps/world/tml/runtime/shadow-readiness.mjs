import { TML_MAIN2_SHADOW_TRANSITIONS } from './main2-shadow-contract.mjs';

export const TML_SHADOW_READINESS_STATUS = Object.freeze({
  NOT_ENOUGH_DATA: 'NOT_ENOUGH_DATA',
  REVIEW: 'REVIEW',
  READY_CANDIDATE: 'READY_CANDIDATE'
});

export const DEFAULT_TML_MAIN2_READINESS_THRESHOLDS = Object.freeze({
  minResolvedSamples: 100,
  minTransitionSamples: 5,
  minRewardReceiptSamples: 5,
  minRewardSettlementSamples: 5,
  minSettlementCoverageRatio: 0.95,
  maxMismatches: 0
});

function finiteRatio(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function ratioThreshold(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

function normalizeThresholds(input = {}) {
  return Object.freeze({
    minResolvedSamples: nonNegativeInteger(
      input.minResolvedSamples,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.minResolvedSamples
    ),
    minTransitionSamples: nonNegativeInteger(
      input.minTransitionSamples,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.minTransitionSamples
    ),
    minRewardReceiptSamples: nonNegativeInteger(
      input.minRewardReceiptSamples,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.minRewardReceiptSamples
    ),
    minRewardSettlementSamples: nonNegativeInteger(
      input.minRewardSettlementSamples,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.minRewardSettlementSamples
    ),
    minSettlementCoverageRatio: ratioThreshold(
      input.minSettlementCoverageRatio,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.minSettlementCoverageRatio
    ),
    maxMismatches: nonNegativeInteger(
      input.maxMismatches,
      DEFAULT_TML_MAIN2_READINESS_THRESHOLDS.maxMismatches
    )
  });
}

function issue(code, actual, required, detail = null) {
  return Object.freeze({ code, actual, required, detail });
}

function snapshotValue(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function evaluateTmlMain2ShadowReadiness({
  parity,
  thresholds,
  transitionIds = TML_MAIN2_SHADOW_TRANSITIONS.map((item) => item.transitionId)
} = {}) {
  const config = normalizeThresholds(thresholds);
  const dataGaps = [];
  const reviewReasons = [];

  const combinedResolved = snapshotValue(parity?.combined?.resolved);
  const combinedMatches = snapshotValue(parity?.combined?.matches);
  const combinedMismatches = snapshotValue(parity?.combined?.mismatches);
  const combinedUnresolved = snapshotValue(parity?.combined?.unresolved);

  const receiptObserved = snapshotValue(parity?.rewardReceipt?.observed);
  const receiptMismatches = snapshotValue(parity?.rewardReceipt?.mismatches);

  const settlementObserved = snapshotValue(parity?.rewardSettlement?.observed);
  const settlementMismatches = snapshotValue(parity?.rewardSettlement?.mismatches);
  const settlementPending = snapshotValue(parity?.rewardSettlement?.pending);
  const settlementUnknown = snapshotValue(parity?.rewardSettlement?.unknown);
  const settlementCoverage = finiteRatio(parity?.rewardSettlement?.coverageRatio);

  if (combinedResolved < config.minResolvedSamples) {
    dataGaps.push(issue(
      'RESOLVED_SAMPLES_BELOW_MINIMUM',
      combinedResolved,
      config.minResolvedSamples
    ));
  }

  const byTransition = parity?.transition?.byTransition ?? {};
  for (const transitionId of transitionIds) {
    const observed = snapshotValue(byTransition?.[transitionId]?.observed);
    if (observed < config.minTransitionSamples) {
      dataGaps.push(issue(
        'TRANSITION_SAMPLES_BELOW_MINIMUM',
        observed,
        config.minTransitionSamples,
        transitionId
      ));
    }
  }

  if (receiptObserved < config.minRewardReceiptSamples) {
    dataGaps.push(issue(
      'REWARD_RECEIPT_SAMPLES_BELOW_MINIMUM',
      receiptObserved,
      config.minRewardReceiptSamples
    ));
  }

  if (settlementObserved < config.minRewardSettlementSamples) {
    dataGaps.push(issue(
      'REWARD_SETTLEMENT_SAMPLES_BELOW_MINIMUM',
      settlementObserved,
      config.minRewardSettlementSamples
    ));
  }

  if (dataGaps.length === 0) {
    if (combinedMismatches > config.maxMismatches) {
      reviewReasons.push(issue(
        'COMBINED_MISMATCHES_EXCEED_LIMIT',
        combinedMismatches,
        config.maxMismatches
      ));
    }

    if (receiptMismatches > config.maxMismatches) {
      reviewReasons.push(issue(
        'REWARD_RECEIPT_MISMATCHES_EXCEED_LIMIT',
        receiptMismatches,
        config.maxMismatches
      ));
    }

    if (settlementMismatches > config.maxMismatches) {
      reviewReasons.push(issue(
        'REWARD_SETTLEMENT_MISMATCHES_EXCEED_LIMIT',
        settlementMismatches,
        config.maxMismatches
      ));
    }

    if (settlementCoverage === null || settlementCoverage < config.minSettlementCoverageRatio) {
      reviewReasons.push(issue(
        'SETTLEMENT_COVERAGE_BELOW_MINIMUM',
        settlementCoverage,
        config.minSettlementCoverageRatio
      ));
    }
  }

  const status = dataGaps.length > 0
    ? TML_SHADOW_READINESS_STATUS.NOT_ENOUGH_DATA
    : reviewReasons.length > 0
      ? TML_SHADOW_READINESS_STATUS.REVIEW
      : TML_SHADOW_READINESS_STATUS.READY_CANDIDATE;

  return Object.freeze({
    status,
    advisoryOnly: true,
    authorityChangeAllowed: false,
    thresholds: config,
    transitionIds: Object.freeze([...transitionIds]),
    dataGaps: Object.freeze(dataGaps),
    reviewReasons: Object.freeze(reviewReasons),
    evidence: Object.freeze({
      combinedResolved,
      combinedMatches,
      combinedMismatches,
      combinedUnresolved,
      receiptObserved,
      receiptMismatches,
      settlementObserved,
      settlementMismatches,
      settlementPending,
      settlementUnknown,
      settlementCoverageRatio: settlementCoverage,
      transitionCoverage: Object.freeze(Object.fromEntries(
        transitionIds.map((transitionId) => [
          transitionId,
          Object.freeze({
            observed: snapshotValue(byTransition?.[transitionId]?.observed),
            mismatches: snapshotValue(byTransition?.[transitionId]?.mismatches),
            parityRatio: finiteRatio(byTransition?.[transitionId]?.parityRatio)
          })
        ])
      ))
    })
  });
}
