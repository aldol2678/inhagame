export const TML_HUMAN_ATTESTATION_DECISION = Object.freeze({
  APPROVE_FOR_NEXT_STAGE: 'APPROVE_FOR_NEXT_STAGE',
  REJECT: 'REJECT',
  NEEDS_MORE_DATA: 'NEEDS_MORE_DATA'
});

export const TML_MAIN2_ATTESTATION_CONTRACT = 'main2-shadow-human-attestation@p13';

const MAX_REVIEWER_REF_LENGTH = 128;
const MAX_NOTE_LENGTH = 1000;

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlHumanAttestationError';
  error.code = code;
  throw error;
}

function isoTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_REVIEWED_AT', 'reviewedAt must be an ISO-compatible timestamp');
  }
  return value;
}

function textField(value, { code, label, max }) {
  if (typeof value !== 'string') fail(code, `${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    fail(code, `${label} must be 1..${max} characters`);
  }
  return trimmed;
}

function optionalNote(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_NOTE_LENGTH) {
    fail('INVALID_ATTESTATION_NOTE', `note must be at most ${MAX_NOTE_LENGTH} characters`);
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

async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is required for attestation fingerprints');
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

function requiredChecklistIds(reviewPacket) {
  const checklist = Array.isArray(reviewPacket?.humanChecklist) ? reviewPacket.humanChecklist : [];
  return checklist
    .filter((item) => item?.required === true)
    .map((item) => item.id)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

function normalizeConfirmations(reviewPacket, checklistConfirmations) {
  if (!Array.isArray(checklistConfirmations)) {
    fail('CHECKLIST_CONFIRMATIONS_REQUIRED', 'checklistConfirmations must be an array');
  }

  const requiredIds = requiredChecklistIds(reviewPacket);
  const seen = new Set();
  const confirmations = [];

  for (const item of checklistConfirmations) {
    const id = typeof item === 'string' ? item : item?.id;
    const confirmed = typeof item === 'string' ? true : item?.confirmed === true;
    if (typeof id !== 'string' || !id) fail('INVALID_CHECKLIST_CONFIRMATION', 'checklist confirmation requires id');
    if (seen.has(id)) fail('DUPLICATE_CHECKLIST_CONFIRMATION', `duplicate checklist confirmation: ${id}`);
    seen.add(id);
    confirmations.push(Object.freeze({ id, confirmed }));
  }

  const requiredSet = new Set(requiredIds);
  const unknown = confirmations.filter((item) => !requiredSet.has(item.id));
  if (unknown.length > 0) {
    fail('UNKNOWN_CHECKLIST_CONFIRMATION', `unknown checklist confirmation: ${unknown[0].id}`);
  }

  const missing = requiredIds.filter((id) =>
    !confirmations.some((item) => item.id === id && item.confirmed === true)
  );
  if (missing.length > 0) {
    fail('CHECKLIST_NOT_FULLY_CONFIRMED', `required checklist item not confirmed: ${missing[0]}`);
  }

  return Object.freeze(confirmations);
}

function validateReviewPacket(reviewPacket) {
  if (!reviewPacket || typeof reviewPacket !== 'object') {
    fail('INVALID_REVIEW_PACKET', 'attestation requires a P12 review packet');
  }
  if (reviewPacket.schema !== 'tml.human-promotion-review' || reviewPacket.version !== '0.1') {
    fail('INVALID_REVIEW_PACKET', 'attestation requires tml.human-promotion-review v0.1');
  }
  if (reviewPacket.status !== 'HUMAN_REVIEW_REQUIRED') {
    fail('REVIEW_PACKET_NOT_ELIGIBLE', 'only HUMAN_REVIEW_REQUIRED packets can be attested');
  }
  if (reviewPacket.advisoryOnly !== true || reviewPacket.authorityChangeAllowed !== false) {
    fail('REVIEW_PACKET_AUTHORITY_BOUNDARY_INVALID', 'review packet must remain advisory-only');
  }
  if (reviewPacket.authority?.currentRemainsAuthoritative !== true ||
      reviewPacket.authority?.current !== 'legacy-main2') {
    fail('REVIEW_PACKET_AUTHORITY_BOUNDARY_INVALID', 'legacy Main 2 must remain authoritative');
  }
  if (!Array.isArray(reviewPacket.failedMachineChecks) || reviewPacket.failedMachineChecks.length !== 0) {
    fail('REVIEW_PACKET_HAS_MACHINE_FAILURES', 'review packet contains failed machine checks');
  }
  return reviewPacket;
}

function nextAction(decision) {
  if (decision === TML_HUMAN_ATTESTATION_DECISION.APPROVE_FOR_NEXT_STAGE) {
    return 'DESIGN_NEXT_STAGE_PROPOSAL_ONLY';
  }
  if (decision === TML_HUMAN_ATTESTATION_DECISION.REJECT) {
    return 'RETURN_TO_SHADOW_AND_INVESTIGATE';
  }
  return 'COLLECT_MORE_EVIDENCE';
}

export async function createTmlMain2HumanAttestation({
  reviewPacket,
  reviewerRef,
  decision,
  reviewedAt = new Date().toISOString(),
  checklistConfirmations,
  note = null
} = {}) {
  validateReviewPacket(reviewPacket);

  const allowed = Object.values(TML_HUMAN_ATTESTATION_DECISION);
  if (!allowed.includes(decision)) {
    fail('INVALID_ATTESTATION_DECISION', `decision must be one of: ${allowed.join(', ')}`);
  }

  const normalizedReviewerRef = textField(reviewerRef, {
    code: 'INVALID_REVIEWER_REF',
    label: 'reviewerRef',
    max: MAX_REVIEWER_REF_LENGTH
  });
  isoTime(reviewedAt);
  const normalizedNote = optionalNote(note);
  const confirmations = normalizeConfirmations(reviewPacket, checklistConfirmations);

  const reviewCanonical = canonicalize(reviewPacket);
  const evidenceFingerprint = await sha256Hex(reviewCanonical);

  const decisionPayload = {
    reviewFingerprint: evidenceFingerprint,
    reviewerRef: normalizedReviewerRef,
    decision,
    reviewedAt,
    checklistConfirmations: confirmations,
    note: normalizedNote
  };
  const attestationFingerprint = await sha256Hex(canonicalize(decisionPayload));

  return Object.freeze({
    schema: 'tml.human-attestation',
    version: '0.1',
    contract: TML_MAIN2_ATTESTATION_CONTRACT,
    id: `attestation.main2.${attestationFingerprint.slice(0, 24)}`,
    reviewedAt,
    reviewerRef: normalizedReviewerRef,
    decision,
    note: normalizedNote,
    evidence: Object.freeze({
      reviewContract: reviewPacket.contract ?? null,
      reviewGeneratedAt: reviewPacket.generatedAt ?? null,
      reviewFingerprint: evidenceFingerprint,
      attestationFingerprint
    }),
    checklistConfirmations: confirmations,
    authority: Object.freeze({
      current: 'legacy-main2',
      currentRemainsAuthoritative: true,
      authorityChangeAllowed: false
    }),
    advisoryOnly: true,
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    nextAction: nextAction(decision)
  });
}
