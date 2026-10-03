import { TML_HUMAN_ATTESTATION_DECISION, TML_MAIN2_ATTESTATION_CONTRACT } from './human-attestation.mjs';

export const TML_PROMOTION_PROPOSAL_STATUS = Object.freeze({
  PROPOSAL_READY: 'PROPOSAL_READY'
});

export const TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT = 'main2-promotion-proposal@p14';

const DEFAULT_CANARY_PHASES = Object.freeze([
  Object.freeze({
    id: 'canary-1-percent',
    audiencePercent: 1,
    authority: 'tml-main2-candidate',
    entryMode: 'HUMAN_APPROVAL_REQUIRED',
    exitMode: 'HUMAN_APPROVAL_REQUIRED'
  }),
  Object.freeze({
    id: 'canary-5-percent',
    audiencePercent: 5,
    authority: 'tml-main2-candidate',
    entryMode: 'HUMAN_APPROVAL_REQUIRED',
    exitMode: 'HUMAN_APPROVAL_REQUIRED'
  }),
  Object.freeze({
    id: 'canary-25-percent',
    audiencePercent: 25,
    authority: 'tml-main2-candidate',
    entryMode: 'HUMAN_APPROVAL_REQUIRED',
    exitMode: 'HUMAN_APPROVAL_REQUIRED'
  })
]);

const DEFAULT_ROLLBACK_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'transition-mismatch',
    trigger: 'ANY_TRANSITION_MISMATCH',
    threshold: 0,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  }),
  Object.freeze({
    id: 'reward-receipt-mismatch',
    trigger: 'ANY_REWARD_RECEIPT_MISMATCH',
    threshold: 0,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  }),
  Object.freeze({
    id: 'reward-settlement-mismatch',
    trigger: 'ANY_REWARD_SETTLEMENT_MISMATCH',
    threshold: 0,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  }),
  Object.freeze({
    id: 'settlement-coverage',
    trigger: 'SETTLEMENT_COVERAGE_BELOW',
    threshold: 1,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  }),
  Object.freeze({
    id: 'verification-unknown-conflict',
    trigger: 'ANY_VERIFICATION_UNKNOWN_OR_CONFLICT',
    threshold: 0,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  }),
  Object.freeze({
    id: 'human-stop',
    trigger: 'HUMAN_STOP_REQUESTED',
    threshold: null,
    action: 'PROPOSE_ROLLBACK_TO_LEGACY'
  })
]);

const DEFAULT_METRICS = Object.freeze([
  Object.freeze({
    id: 'transition-parity',
    source: 'tml-shadow-parity',
    dimensions: Object.freeze(['transitionId']),
    required: true
  }),
  Object.freeze({
    id: 'reward-receipt-parity',
    source: 'tml-shadow-parity',
    dimensions: Object.freeze([]),
    required: true
  }),
  Object.freeze({
    id: 'reward-settlement-parity',
    source: 'tml-shadow-parity',
    dimensions: Object.freeze([]),
    required: true
  }),
  Object.freeze({
    id: 'reward-settlement-coverage',
    source: 'tml-shadow-parity',
    dimensions: Object.freeze([]),
    required: true
  }),
  Object.freeze({
    id: 'verification-status',
    source: 'tml-verification',
    dimensions: Object.freeze(['status']),
    required: true
  }),
  Object.freeze({
    id: 'write-disposition',
    source: 'tml-verified-write-runtime',
    dimensions: Object.freeze(['disposition']),
    required: true
  }),
  Object.freeze({
    id: 'rollback-events',
    source: 'future-rollout-controller',
    dimensions: Object.freeze(['reason']),
    required: true
  })
]);

const PRE_SWITCH_CHECKLIST = Object.freeze([
  Object.freeze({
    id: 'review-attestation-fingerprint',
    title: 'P13 attestation fingerprint와 source review를 사람이 대조한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'verify-canary-isolation',
    title: 'Canary 대상과 legacy 대상이 명확히 분리되는지 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'verify-observability',
    title: '필수 parity / verification / disposition 지표 수집 계획을 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'verify-rollback-path',
    title: 'legacy-main2 복귀 절차와 rollback 조건을 검토한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'verify-no-automatic-advance',
    title: '각 Canary 단계가 별도 사람 승인 없이는 진행되지 않음을 확인한다',
    required: true,
    state: 'UNCONFIRMED'
  }),
  Object.freeze({
    id: 'approve-runtime-change-separately',
    title: '실제 권한 전환 코드는 별도 변경과 별도 승인으로 처리한다',
    required: true,
    state: 'UNCONFIRMED'
  })
]);

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlPromotionProposalError';
  error.code = code;
  throw error;
}

function isoTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_PROPOSAL_TIME', 'generatedAt must be an ISO-compatible timestamp');
  }
  return value;
}

function freezeCopy(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])
    ));
  }
  return value;
}

function validateAttestation(attestation) {
  if (!attestation || typeof attestation !== 'object') {
    fail('ATTESTATION_REQUIRED', 'P14 requires a P13 human attestation record');
  }
  if (attestation.schema !== 'tml.human-attestation' ||
      attestation.version !== '0.1' ||
      attestation.contract !== TML_MAIN2_ATTESTATION_CONTRACT) {
    fail('INVALID_ATTESTATION_CONTRACT', 'P14 requires the current Main 2 P13 attestation contract');
  }
  if (attestation.decision !== TML_HUMAN_ATTESTATION_DECISION.APPROVE_FOR_NEXT_STAGE) {
    fail('ATTESTATION_DECISION_NOT_APPROVED', 'P14 requires APPROVE_FOR_NEXT_STAGE');
  }
  if (attestation.nextAction !== 'DESIGN_NEXT_STAGE_PROPOSAL_ONLY') {
    fail('ATTESTATION_NEXT_ACTION_INVALID', 'attestation must permit design-only next-stage proposal');
  }
  if (attestation.advisoryOnly !== true ||
      attestation.runtimeEffect !== 'NONE' ||
      attestation.persistenceEffect !== 'NONE') {
    fail('ATTESTATION_EFFECT_BOUNDARY_INVALID', 'attestation must have no runtime or persistence effect');
  }
  if (attestation.authority?.current !== 'legacy-main2' ||
      attestation.authority?.currentRemainsAuthoritative !== true ||
      attestation.authority?.authorityChangeAllowed !== false) {
    fail('ATTESTATION_AUTHORITY_BOUNDARY_INVALID', 'legacy Main 2 must remain authoritative');
  }
  if (typeof attestation.evidence?.reviewFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(attestation.evidence.reviewFingerprint) ||
      typeof attestation.evidence?.attestationFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(attestation.evidence.attestationFingerprint)) {
    fail('ATTESTATION_FINGERPRINT_INVALID', 'attestation fingerprints must be SHA-256 hex');
  }
  return attestation;
}

export function buildTmlMain2PromotionProposalPack({
  attestation,
  generatedAt = new Date().toISOString()
} = {}) {
  validateAttestation(attestation);
  isoTime(generatedAt);

  return Object.freeze({
    schema: 'tml.promotion-proposal-pack',
    version: '0.1',
    contract: TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT,
    generatedAt,
    status: TML_PROMOTION_PROPOSAL_STATUS.PROPOSAL_READY,
    advisoryOnly: true,
    executable: false,
    automaticExecutionAllowed: false,
    authorityChangeAllowed: false,
    authority: Object.freeze({
      current: 'legacy-main2',
      proposedCandidate: 'tml-main2',
      currentRemainsAuthoritative: true
    }),
    sourceAttestation: Object.freeze({
      id: attestation.id,
      reviewedAt: attestation.reviewedAt,
      reviewerRef: attestation.reviewerRef,
      decision: attestation.decision,
      reviewFingerprint: attestation.evidence.reviewFingerprint,
      attestationFingerprint: attestation.evidence.attestationFingerprint
    }),
    canaryPlan: freezeCopy({
      mode: 'PROPOSAL_ONLY',
      phases: DEFAULT_CANARY_PHASES,
      progressionRule: 'HUMAN_APPROVAL_REQUIRED_FOR_EVERY_PHASE',
      fullRolloutIncluded: false
    }),
    rollbackPlan: freezeCopy({
      mode: 'PROPOSAL_ONLY',
      targetAuthority: 'legacy-main2',
      automaticRollbackAllowed: false,
      conditions: DEFAULT_ROLLBACK_CONDITIONS
    }),
    observabilityPlan: freezeCopy({
      mode: 'PROPOSAL_ONLY',
      metrics: DEFAULT_METRICS,
      requiredSettlementCoverageDuringCanary: 1,
      mismatchBudget: 0
    }),
    preSwitchChecklist: PRE_SWITCH_CHECKLIST,
    nextAction: 'HUMAN_REVIEW_PROPOSAL_ONLY',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE'
  });
}
