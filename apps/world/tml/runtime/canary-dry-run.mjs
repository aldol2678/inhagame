import { TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT } from './promotion-proposal-pack.mjs';

export const TML_CANARY_DRY_RUN_OUTCOME = Object.freeze({
  HOLD: 'HOLD',
  ADVANCE_PROPOSED: 'ADVANCE_PROPOSED',
  ROLLBACK_PROPOSED: 'ROLLBACK_PROPOSED'
});

export const TML_MAIN2_CANARY_DRY_RUN_CONTRACT = 'main2-canary-dry-run@p15';

const DEFAULT_MIN_RESOLVED_WRITES = 20;

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlCanaryDryRunError';
  error.code = code;
  throw error;
}

function isoTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_DRY_RUN_TIME', 'generatedAt must be an ISO-compatible timestamp');
  }
  return value;
}

function nonNegativeInteger(value, code, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(code, `${label} must be a non-negative safe integer`);
  }
  return value;
}

function ratio(value, code, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(code, `${label} must be between 0 and 1`);
  }
  return value;
}

function validateProposalPack(pack) {
  if (!pack || typeof pack !== 'object') {
    fail('PROPOSAL_PACK_REQUIRED', 'P15 requires a P14 promotion proposal pack');
  }
  if (pack.schema !== 'tml.promotion-proposal-pack' ||
      pack.version !== '0.1' ||
      pack.contract !== TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT) {
    fail('INVALID_PROPOSAL_PACK', 'P15 requires the current Main 2 P14 proposal contract');
  }
  if (pack.status !== 'PROPOSAL_READY' ||
      pack.advisoryOnly !== true ||
      pack.executable !== false ||
      pack.automaticExecutionAllowed !== false ||
      pack.authorityChangeAllowed !== false ||
      pack.runtimeEffect !== 'NONE' ||
      pack.persistenceEffect !== 'NONE') {
    fail('PROPOSAL_EFFECT_BOUNDARY_INVALID', 'P14 proposal must remain non-executable and advisory-only');
  }
  if (pack.authority?.current !== 'legacy-main2' ||
      pack.authority?.currentRemainsAuthoritative !== true) {
    fail('PROPOSAL_AUTHORITY_BOUNDARY_INVALID', 'legacy Main 2 must remain authoritative');
  }
  if (!Array.isArray(pack.canaryPlan?.phases) || pack.canaryPlan.phases.length === 0) {
    fail('CANARY_PHASES_REQUIRED', 'P14 proposal must contain canary phases');
  }
  if (pack.canaryPlan.fullRolloutIncluded !== false) {
    fail('FULL_ROLLOUT_NOT_ALLOWED', 'P15 dry-run cannot accept a P14 pack that includes full rollout');
  }
  return pack;
}

function normalizeScenario(scenario = {}) {
  const normalized = {
    virtualPopulation: nonNegativeInteger(
      scenario.virtualPopulation ?? 1000,
      'INVALID_VIRTUAL_POPULATION',
      'virtualPopulation'
    ),
    resolvedWrites: nonNegativeInteger(
      scenario.resolvedWrites ?? 0,
      'INVALID_RESOLVED_WRITES',
      'resolvedWrites'
    ),
    transitionMismatches: nonNegativeInteger(
      scenario.transitionMismatches ?? 0,
      'INVALID_TRANSITION_MISMATCHES',
      'transitionMismatches'
    ),
    rewardReceiptMismatches: nonNegativeInteger(
      scenario.rewardReceiptMismatches ?? 0,
      'INVALID_REWARD_RECEIPT_MISMATCHES',
      'rewardReceiptMismatches'
    ),
    rewardSettlementMismatches: nonNegativeInteger(
      scenario.rewardSettlementMismatches ?? 0,
      'INVALID_REWARD_SETTLEMENT_MISMATCHES',
      'rewardSettlementMismatches'
    ),
    verificationUnknown: nonNegativeInteger(
      scenario.verificationUnknown ?? 0,
      'INVALID_VERIFICATION_UNKNOWN',
      'verificationUnknown'
    ),
    verificationConflict: nonNegativeInteger(
      scenario.verificationConflict ?? 0,
      'INVALID_VERIFICATION_CONFLICT',
      'verificationConflict'
    ),
    settlementCoverageRatio: ratio(
      scenario.settlementCoverageRatio ?? 0,
      'INVALID_SETTLEMENT_COVERAGE',
      'settlementCoverageRatio'
    ),
    humanStopRequested: scenario.humanStopRequested === true
  };
  return Object.freeze(normalized);
}

function findPhase(pack, phaseId) {
  const phase = pack.canaryPlan.phases.find((item) => item.id === phaseId);
  if (!phase) fail('CANARY_PHASE_NOT_FOUND', `unknown canary phase: ${String(phaseId)}`);
  return phase;
}

function phaseIndex(pack, phaseId) {
  return pack.canaryPlan.phases.findIndex((item) => item.id === phaseId);
}

function rollbackReasons(scenario) {
  const reasons = [];
  if (scenario.transitionMismatches > 0) reasons.push('ANY_TRANSITION_MISMATCH');
  if (scenario.rewardReceiptMismatches > 0) reasons.push('ANY_REWARD_RECEIPT_MISMATCH');
  if (scenario.rewardSettlementMismatches > 0) reasons.push('ANY_REWARD_SETTLEMENT_MISMATCH');
  if (scenario.settlementCoverageRatio < 1) reasons.push('SETTLEMENT_COVERAGE_BELOW');
  if (scenario.verificationUnknown > 0 || scenario.verificationConflict > 0) {
    reasons.push('ANY_VERIFICATION_UNKNOWN_OR_CONFLICT');
  }
  if (scenario.humanStopRequested) reasons.push('HUMAN_STOP_REQUESTED');
  return Object.freeze(reasons);
}

function cohortSize(virtualPopulation, audiencePercent) {
  if (virtualPopulation === 0) return 0;
  return Math.max(1, Math.ceil(virtualPopulation * (audiencePercent / 100)));
}

function nextPhase(pack, currentIndex) {
  return pack.canaryPlan.phases[currentIndex + 1] ?? null;
}

export function simulateTmlMain2CanaryDryRun({
  proposalPack,
  phaseId,
  humanGate = {},
  scenario = {},
  generatedAt = new Date().toISOString(),
  minResolvedWrites = DEFAULT_MIN_RESOLVED_WRITES
} = {}) {
  const pack = validateProposalPack(proposalPack);
  isoTime(generatedAt);
  nonNegativeInteger(minResolvedWrites, 'INVALID_MIN_RESOLVED_WRITES', 'minResolvedWrites');

  const phase = findPhase(pack, phaseId);
  const index = phaseIndex(pack, phaseId);
  const normalizedScenario = normalizeScenario(scenario);
  const virtualCohortSize = cohortSize(normalizedScenario.virtualPopulation, phase.audiencePercent);
  const entryApproved = humanGate.entryApproved === true;
  const exitApproved = humanGate.exitApproved === true;

  const base = {
    schema: 'tml.canary-dry-run',
    version: '0.1',
    contract: TML_MAIN2_CANARY_DRY_RUN_CONTRACT,
    generatedAt,
    advisoryOnly: true,
    executable: false,
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    routingEffect: 'NONE',
    authorityChangeAllowed: false,
    authority: Object.freeze({
      current: 'legacy-main2',
      simulatedCandidate: 'tml-main2',
      currentRemainsAuthoritative: true
    }),
    sourceProposal: Object.freeze({
      contract: pack.contract,
      generatedAt: pack.generatedAt,
      attestationFingerprint: pack.sourceAttestation?.attestationFingerprint ?? null
    }),
    phase: Object.freeze({
      id: phase.id,
      audiencePercent: phase.audiencePercent,
      index,
      totalPhases: pack.canaryPlan.phases.length,
      entryMode: phase.entryMode,
      exitMode: phase.exitMode,
      virtualPopulation: normalizedScenario.virtualPopulation,
      virtualCohortSize
    }),
    humanGate: Object.freeze({
      entryApproved,
      exitApproved
    }),
    scenario: normalizedScenario,
    minResolvedWrites
  };

  if (!entryApproved) {
    return Object.freeze({
      ...base,
      outcome: TML_CANARY_DRY_RUN_OUTCOME.HOLD,
      reasons: Object.freeze(['ENTRY_HUMAN_APPROVAL_REQUIRED']),
      nextPhaseId: null,
      proposedAction: 'HOLD_CANARY_ENTRY'
    });
  }

  const rollback = rollbackReasons(normalizedScenario);
  if (rollback.length > 0) {
    return Object.freeze({
      ...base,
      outcome: TML_CANARY_DRY_RUN_OUTCOME.ROLLBACK_PROPOSED,
      reasons: rollback,
      nextPhaseId: null,
      proposedAction: 'PROPOSE_ROLLBACK_TO_LEGACY'
    });
  }

  if (normalizedScenario.resolvedWrites < minResolvedWrites) {
    return Object.freeze({
      ...base,
      outcome: TML_CANARY_DRY_RUN_OUTCOME.HOLD,
      reasons: Object.freeze(['RESOLVED_WRITES_BELOW_DRY_RUN_MINIMUM']),
      nextPhaseId: null,
      proposedAction: 'COLLECT_MORE_DRY_RUN_EVIDENCE'
    });
  }

  if (!exitApproved) {
    return Object.freeze({
      ...base,
      outcome: TML_CANARY_DRY_RUN_OUTCOME.HOLD,
      reasons: Object.freeze(['EXIT_HUMAN_APPROVAL_REQUIRED']),
      nextPhaseId: null,
      proposedAction: 'HOLD_CANARY_EXIT'
    });
  }

  const next = nextPhase(pack, index);
  if (!next) {
    return Object.freeze({
      ...base,
      outcome: TML_CANARY_DRY_RUN_OUTCOME.HOLD,
      reasons: Object.freeze(['P14_FULL_ROLLOUT_NOT_INCLUDED']),
      nextPhaseId: null,
      proposedAction: 'RETURN_TO_HUMAN_REVIEW_FOR_FULL_ROLLOUT_DESIGN'
    });
  }

  return Object.freeze({
    ...base,
    outcome: TML_CANARY_DRY_RUN_OUTCOME.ADVANCE_PROPOSED,
    reasons: Object.freeze(['DRY_RUN_GATES_SATISFIED']),
    nextPhaseId: next.id,
    proposedAction: 'PROPOSE_NEXT_CANARY_PHASE'
  });
}
