import { TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT } from './promotion-proposal-pack.mjs';

export const TML_CANARY_EXECUTION_CONTRACT_STATUS = Object.freeze({
  CONTRACT_READY: 'CONTRACT_READY'
});

export const TML_MAIN2_CANARY_EXECUTION_CONTRACT = 'main2-canary-execution-contract@p16';

export const TML_CANARY_EXECUTION_APPROVAL_DECISION = 'APPROVE_CANARY_EXECUTION_CONTRACT';
export const TML_CANARY_EXECUTION_APPROVAL_SCOPE = 'CONTRACT_CREATION_ONLY';

const MAX_TEXT_REF_LENGTH = 256;
const MAX_VALIDITY_MS = 2 * 60 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlCanaryExecutionContractError';
  error.code = code;
  throw error;
}

function isoTime(value, code, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(code, `${label} must be an ISO-compatible timestamp`);
  }
  return value;
}

function textRef(value, code, label, max = MAX_TEXT_REF_LENGTH) {
  if (typeof value !== 'string') fail(code, `${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    fail(code, `${label} must be 1..${max} characters`);
  }
  return trimmed;
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

function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_CANONICAL_VALUE', 'non-finite numbers cannot be fingerprinted');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  fail('NON_CANONICAL_VALUE', `unsupported fingerprint value type: ${typeof value}`);
}

async function sha256Hex(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is required for execution-contract fingerprints');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validateProposalPack(pack) {
  if (!pack || typeof pack !== 'object') {
    fail('PROPOSAL_PACK_REQUIRED', 'P16 requires a P14 promotion proposal pack');
  }
  if (pack.schema !== 'tml.promotion-proposal-pack' ||
      pack.version !== '0.1' ||
      pack.contract !== TML_MAIN2_PROMOTION_PROPOSAL_CONTRACT) {
    fail('INVALID_PROPOSAL_PACK', 'P16 requires the current Main 2 P14 proposal contract');
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
  if (!Array.isArray(pack.canaryPlan?.phases) || pack.canaryPlan.phases.length !== 3) {
    fail('CANARY_PLAN_INVALID', 'P16 requires the three-phase P14 canary plan');
  }
  const expected = [1, 5, 25];
  for (let index = 0; index < expected.length; index += 1) {
    const phase = pack.canaryPlan.phases[index];
    if (phase?.audiencePercent !== expected[index] ||
        phase?.entryMode !== 'HUMAN_APPROVAL_REQUIRED' ||
        phase?.exitMode !== 'HUMAN_APPROVAL_REQUIRED') {
      fail('CANARY_PLAN_INVALID', 'P16 requires the human-gated 1/5/25 canary plan');
    }
  }
  if (pack.canaryPlan.fullRolloutIncluded !== false) {
    fail('FULL_ROLLOUT_NOT_ALLOWED', 'P16 cannot accept a proposal that includes full rollout');
  }
  if (pack.rollbackPlan?.targetAuthority !== 'legacy-main2' ||
      pack.rollbackPlan?.automaticRollbackAllowed !== false) {
    fail('ROLLBACK_PLAN_INVALID', 'P16 requires manual rollback proposal to legacy-main2');
  }
  if (pack.observabilityPlan?.mismatchBudget !== 0 ||
      pack.observabilityPlan?.requiredSettlementCoverageDuringCanary !== 1) {
    fail('OBSERVABILITY_PLAN_INVALID', 'P16 requires zero mismatch budget and 100% settlement coverage');
  }
  const attestationFingerprint = pack.sourceAttestation?.attestationFingerprint;
  const reviewFingerprint = pack.sourceAttestation?.reviewFingerprint;
  if (typeof attestationFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(attestationFingerprint) ||
      typeof reviewFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(reviewFingerprint)) {
    fail('SOURCE_FINGERPRINT_INVALID', 'P14 source attestation fingerprints must be SHA-256 hex');
  }
  return pack;
}

export async function fingerprintTmlMain2PromotionProposal(proposalPack) {
  const pack = validateProposalPack(proposalPack);
  return sha256Hex(canonicalize(pack));
}

function findPhase(pack, phaseId) {
  const index = pack.canaryPlan.phases.findIndex((phase) => phase.id === phaseId);
  if (index < 0) fail('CANARY_PHASE_NOT_FOUND', `unknown canary phase: ${String(phaseId)}`);
  return { phase: pack.canaryPlan.phases[index], index };
}

function validateApproval({
  approval,
  phaseId,
  proposalFingerprint,
  attestationFingerprint
}) {
  if (!approval || typeof approval !== 'object') {
    fail('HUMAN_APPROVAL_REQUIRED', 'P16 requires a separate human execution-contract approval');
  }
  const approvalRef = textRef(approval.approvalRef, 'INVALID_APPROVAL_REF', 'approvalRef', 128);
  const approverRef = textRef(approval.approverRef, 'INVALID_APPROVER_REF', 'approverRef', 128);
  isoTime(approval.approvedAt, 'INVALID_APPROVED_AT', 'approvedAt');

  if (approval.decision !== TML_CANARY_EXECUTION_APPROVAL_DECISION) {
    fail(
      'INVALID_EXECUTION_APPROVAL_DECISION',
      `approval decision must be ${TML_CANARY_EXECUTION_APPROVAL_DECISION}`
    );
  }
  if (approval.scope !== TML_CANARY_EXECUTION_APPROVAL_SCOPE) {
    fail(
      'INVALID_EXECUTION_APPROVAL_SCOPE',
      `approval scope must be ${TML_CANARY_EXECUTION_APPROVAL_SCOPE}`
    );
  }
  if (approval.phaseId !== phaseId) {
    fail('APPROVAL_PHASE_MISMATCH', 'human approval phaseId must match the requested phase');
  }
  if (approval.proposalFingerprint !== proposalFingerprint) {
    fail('APPROVAL_PROPOSAL_FINGERPRINT_MISMATCH', 'human approval must bind the current proposal fingerprint');
  }
  if (approval.attestationFingerprint !== attestationFingerprint) {
    fail('APPROVAL_ATTESTATION_FINGERPRINT_MISMATCH', 'human approval must bind the P13 attestation fingerprint');
  }

  return Object.freeze({
    approvalRef,
    approverRef,
    approvedAt: approval.approvedAt,
    decision: approval.decision,
    scope: approval.scope,
    phaseId: approval.phaseId,
    proposalFingerprint: approval.proposalFingerprint,
    attestationFingerprint: approval.attestationFingerprint
  });
}

function validateCohort(cohort, phase) {
  if (!cohort || typeof cohort !== 'object') {
    fail('EXPLICIT_COHORT_REQUIRED', 'P16 requires an explicit external cohort reference');
  }
  const cohortId = textRef(cohort.id, 'INVALID_COHORT_ID', 'cohort.id');
  if (cohort.assignmentMode !== 'EXTERNAL_EXPLICIT_COHORT') {
    fail('INVALID_COHORT_ASSIGNMENT_MODE', 'cohort assignmentMode must be EXTERNAL_EXPLICIT_COHORT');
  }
  if (cohort.expectedAudiencePercent !== phase.audiencePercent) {
    fail('COHORT_PERCENT_MISMATCH', 'cohort expectedAudiencePercent must match the selected P14 phase');
  }
  if ('members' in cohort || 'userIds' in cohort || 'users' in cohort) {
    fail('COHORT_MEMBERSHIP_EMBEDDED', 'P16 contract must not embed real cohort membership');
  }
  return Object.freeze({
    id: cohortId,
    assignmentMode: cohort.assignmentMode,
    expectedAudiencePercent: cohort.expectedAudiencePercent,
    membershipEmbedded: false
  });
}

function validateHandle(value, code, label) {
  return textRef(value, code, label);
}

function validateValidity({ generatedAt, approvedAt, expiresAt }) {
  isoTime(generatedAt, 'INVALID_GENERATED_AT', 'generatedAt');
  isoTime(expiresAt, 'INVALID_EXPIRES_AT', 'expiresAt');

  const generatedMs = Date.parse(generatedAt);
  const approvedMs = Date.parse(approvedAt);
  const expiresMs = Date.parse(expiresAt);

  if (generatedMs < approvedMs) {
    fail('CONTRACT_PREDATES_APPROVAL', 'contract generatedAt cannot be earlier than approvedAt');
  }
  if (expiresMs <= generatedMs) {
    fail('CONTRACT_EXPIRY_NOT_AFTER_GENERATION', 'expiresAt must be later than generatedAt');
  }
  if (expiresMs - generatedMs > MAX_VALIDITY_MS) {
    fail('CONTRACT_VALIDITY_TOO_LONG', 'P16 execution contract may be valid for at most 2 hours');
  }

  return Object.freeze({
    generatedAt,
    expiresAt,
    maxValidityMs: MAX_VALIDITY_MS
  });
}

export async function createTmlMain2CanaryExecutionContract({
  proposalPack,
  proposalFingerprint,
  phaseId,
  humanApproval,
  cohort,
  rollbackHandle,
  observabilityHandle,
  generatedAt = new Date().toISOString(),
  expiresAt
} = {}) {
  const pack = validateProposalPack(proposalPack);
  const computedProposalFingerprint = await fingerprintTmlMain2PromotionProposal(pack);

  if (proposalFingerprint !== computedProposalFingerprint) {
    fail('PROPOSAL_FINGERPRINT_MISMATCH', 'supplied proposalFingerprint does not match the P14 pack');
  }

  const { phase, index } = findPhase(pack, phaseId);
  const attestationFingerprint = pack.sourceAttestation.attestationFingerprint;
  const approval = validateApproval({
    approval: humanApproval,
    phaseId,
    proposalFingerprint: computedProposalFingerprint,
    attestationFingerprint
  });
  const normalizedCohort = validateCohort(cohort, phase);
  const rollbackRef = validateHandle(
    rollbackHandle,
    'INVALID_ROLLBACK_HANDLE',
    'rollbackHandle'
  );
  const observabilityRef = validateHandle(
    observabilityHandle,
    'INVALID_OBSERVABILITY_HANDLE',
    'observabilityHandle'
  );
  const validity = validateValidity({
    generatedAt,
    approvedAt: approval.approvedAt,
    expiresAt
  });

  const body = {
    schema: 'tml.canary-execution-contract',
    version: '0.1',
    contract: TML_MAIN2_CANARY_EXECUTION_CONTRACT,
    status: TML_CANARY_EXECUTION_CONTRACT_STATUS.CONTRACT_READY,
    generatedAt,
    expiresAt,
    advisoryOnly: true,
    executable: false,
    activationAllowed: false,
    routingEffect: 'NONE',
    deploymentEffect: 'NONE',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    authorityChangeAllowed: false,
    authority: {
      current: 'legacy-main2',
      requestedCandidate: 'tml-main2',
      currentRemainsAuthoritative: true
    },
    sourceProposal: {
      contract: pack.contract,
      generatedAt: pack.generatedAt,
      proposalFingerprint: computedProposalFingerprint,
      reviewFingerprint: pack.sourceAttestation.reviewFingerprint,
      attestationFingerprint
    },
    phase: {
      id: phase.id,
      index,
      totalPhases: pack.canaryPlan.phases.length,
      audiencePercent: phase.audiencePercent,
      entryMode: phase.entryMode,
      exitMode: phase.exitMode,
      fullRollout: false
    },
    humanApproval: approval,
    cohort: normalizedCohort,
    handles: {
      rollback: rollbackRef,
      observability: observabilityRef
    },
    validity,
    requirements: [
      'SEPARATE_HUMAN_ACTIVATION_REQUIRED',
      'EXTERNAL_ROUTER_IMPLEMENTATION_REQUIRED',
      'EXTERNAL_ROLLBACK_ADAPTER_REQUIRED',
      'EXTERNAL_OBSERVABILITY_ADAPTER_REQUIRED',
      'EXPIRY_CHECK_REQUIRED_AT_ACTIVATION'
    ],
    nextAction: 'HUMAN_REVIEW_EXECUTION_ADAPTER_DESIGN_ONLY'
  };

  const contractFingerprint = await sha256Hex(canonicalize(body));
  return freezeCopy({
    ...body,
    evidence: {
      contractFingerprint
    },
    id: `canary-contract.main2.${contractFingerprint.slice(0, 24)}`
  });
}
