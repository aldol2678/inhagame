import { TML_VERIFICATION_STATUS } from './verification.mjs';

export const TML_GYEOL_VERDICT_BRIDGE_CONTRACT = 'tml-gyeol-verdict-bridge@p19';

export const GYEOL_VERDICT_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  HOLD: 'HOLD',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN'
});

const MAX_REF_LENGTH = 256;

const REQUEST_KEYS = Object.freeze(new Set([
  'schema',
  'version',
  'contract',
  'id',
  'mode',
  'policy_ref',
  'requested_at',
  'verification',
  'evidence',
  'context',
  'boundary'
]));

const REQUEST_BOUNDARY_KEYS = Object.freeze(new Set([
  'tmlVerificationIsNotGyeolVerdict',
  'advisoryOnly',
  'runtimeEffect',
  'persistenceEffect',
  'authorityChangeAllowed'
]));

const RESPONSE_KEYS = Object.freeze(new Set([
  'schema',
  'version',
  'contract',
  'request_id',
  'status',
  'reasons',
  'evidence_used',
  'evaluated_at',
  'advisory_only',
  'runtime_effect',
  'persistence_effect',
  'authority_change_allowed',
  'mutation_requests'
]));

const REASON_KEYS = Object.freeze(new Set(['code', 'message']));

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlGyeolVerdictContractError';
  error.code = code;
  throw error;
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

function assertOnlyKeys(value, allowed, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} contains unsupported field: ${key}`);
  }
}

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function textRef(value, code, label) {
  if (typeof value !== 'string') fail(code, `${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REF_LENGTH) {
    fail(code, `${label} must be 1..${MAX_REF_LENGTH} characters`);
  }
  return trimmed;
}

function isoTime(value, code, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(code, `${label} must be an ISO-compatible timestamp`);
  }
  return value;
}

function validateVerification(verification) {
  if (!verification || typeof verification !== 'object' || verification.kind !== 'verification') {
    fail('TML_VERIFICATION_REQUIRED', 'a TML verification record is required');
  }
  textRef(verification.id, 'INVALID_VERIFICATION_ID', 'verification.id');
  textRef(verification.transition, 'INVALID_TRANSITION_REF', 'verification.transition');
  if (!Object.values(TML_VERIFICATION_STATUS).includes(verification.status)) {
    fail('INVALID_TML_VERIFICATION_STATUS', 'verification.status is not a TML verification status');
  }
  isoTime(verification.checked_at, 'INVALID_VERIFICATION_TIME', 'verification.checked_at');
  if (!Array.isArray(verification.evidence) || verification.evidence.length === 0 ||
      verification.evidence.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    fail('INVALID_VERIFICATION_EVIDENCE', 'verification.evidence must contain evidence ids');
  }
  return verification;
}

function validateEvidence(evidence, verification) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail('TML_EVIDENCE_REQUIRED', 'evidence records are required');
  }

  const ids = new Set();
  for (const record of evidence) {
    if (!record || typeof record !== 'object' || record.kind !== 'evidence') {
      fail('INVALID_TML_EVIDENCE', 'every evidence record must be a TML evidence object');
    }
    const id = textRef(record.id, 'INVALID_EVIDENCE_ID', 'evidence.id');
    if (ids.has(id)) fail('DUPLICATE_EVIDENCE_ID', `duplicate evidence id: ${id}`);
    ids.add(id);
  }

  for (const id of verification.evidence) {
    if (!ids.has(id)) {
      fail('VERIFICATION_EVIDENCE_MISSING', `verification evidence not supplied: ${id}`);
    }
  }
  return ids;
}

function validateContext(context) {
  if (context == null) return {};
  if (typeof context !== 'object' || Array.isArray(context)) {
    fail('INVALID_GYEOL_CONTEXT', 'context must be an object');
  }
  return context;
}

function validateBoundary(boundary) {
  assertOnlyKeys(boundary, REQUEST_BOUNDARY_KEYS, 'INVALID_GYEOL_REQUEST_BOUNDARY', 'request.boundary');
  if (boundary.tmlVerificationIsNotGyeolVerdict !== true ||
      boundary.advisoryOnly !== true ||
      boundary.runtimeEffect !== 'NONE' ||
      boundary.persistenceEffect !== 'NONE' ||
      boundary.authorityChangeAllowed !== false) {
    fail('GYEOL_REQUEST_BOUNDARY_INVALID', 'P19 request boundary must remain shadow-only and effect-free');
  }
  return boundary;
}

export function validateTmlGyeolVerdictRequest(request) {
  assertOnlyKeys(request, REQUEST_KEYS, 'GYEOL_REQUEST_FIELD_FORBIDDEN', 'request');
  if (request.schema !== 'tml.gyeol-verdict-request' ||
      request.version !== '0.1' ||
      request.contract !== TML_GYEOL_VERDICT_BRIDGE_CONTRACT ||
      request.mode !== 'SHADOW_ONLY') {
    fail('INVALID_GYEOL_REQUEST_CONTRACT', 'unexpected P19 request contract or mode');
  }

  const verification = validateVerification(request.verification);
  validateEvidence(request.evidence, verification);
  validateContext(request.context);
  validateBoundary(request.boundary);
  const policy = textRef(request.policy_ref, 'INVALID_GYEOL_POLICY_REF', 'policy_ref');
  const requestedAt = isoTime(request.requested_at, 'INVALID_GYEOL_REQUEST_TIME', 'requested_at');
  const expectedId = `gyeol-request.${token(verification.id)}.${token(requestedAt)}`;
  if (request.id !== expectedId) {
    fail('GYEOL_REQUEST_ID_INVALID', 'P19 request id does not match verification/timestamp identity');
  }
  if (request.policy_ref !== policy) {
    fail('INVALID_GYEOL_POLICY_REF', 'policy_ref must not contain leading or trailing whitespace');
  }

  return freezeCopy(request);
}

export function buildTmlGyeolVerdictRequest({
  verification,
  evidence,
  context = {},
  policyRef = 'gyeol.inha-world.shadow@0.1',
  requestedAt
} = {}) {
  validateVerification(verification);
  validateEvidence(evidence, verification);
  const policy = textRef(policyRef, 'INVALID_GYEOL_POLICY_REF', 'policyRef');
  const requested = isoTime(requestedAt, 'INVALID_GYEOL_REQUEST_TIME', 'requestedAt');
  const safeContext = validateContext(context);

  return validateTmlGyeolVerdictRequest({
    schema: 'tml.gyeol-verdict-request',
    version: '0.1',
    contract: TML_GYEOL_VERDICT_BRIDGE_CONTRACT,
    id: `gyeol-request.${token(verification.id)}.${token(requested)}`,
    mode: 'SHADOW_ONLY',
    policy_ref: policy,
    requested_at: requested,
    verification,
    evidence,
    context: safeContext,
    boundary: {
      tmlVerificationIsNotGyeolVerdict: true,
      advisoryOnly: true,
      runtimeEffect: 'NONE',
      persistenceEffect: 'NONE',
      authorityChangeAllowed: false
    }
  });
}

function validateReason(reason) {
  assertOnlyKeys(reason, REASON_KEYS, 'GYEOL_REASON_FIELD_FORBIDDEN', 'reason');
  textRef(reason.code, 'INVALID_GYEOL_REASON_CODE', 'reason.code');
  if (reason.message !== undefined && typeof reason.message !== 'string') {
    fail('INVALID_GYEOL_REASON_MESSAGE', 'reason.message must be a string when present');
  }
}

export function validateTmlGyeolVerdictResponse({ request, response } = {}) {
  const validatedRequest = validateTmlGyeolVerdictRequest(request);

  assertOnlyKeys(response, RESPONSE_KEYS, 'GYEOL_RESPONSE_FIELD_FORBIDDEN', 'response');
  if (response.schema !== 'gyeol.verdict' || response.version !== '0.1' ||
      response.contract !== TML_GYEOL_VERDICT_BRIDGE_CONTRACT) {
    fail('INVALID_GYEOL_RESPONSE_CONTRACT', 'unexpected Gyeol verdict response contract');
  }
  if (response.request_id !== validatedRequest.id) {
    fail('GYEOL_REQUEST_ID_MISMATCH', 'Gyeol verdict request_id does not match the request');
  }
  if (!Object.values(GYEOL_VERDICT_STATUS).includes(response.status)) {
    fail('INVALID_GYEOL_VERDICT_STATUS', 'unsupported Gyeol verdict status');
  }
  isoTime(response.evaluated_at, 'INVALID_GYEOL_EVALUATED_TIME', 'response.evaluated_at');

  if (!Array.isArray(response.reasons) || response.reasons.length === 0) {
    fail('GYEOL_REASONS_REQUIRED', 'Gyeol verdict must include at least one reason');
  }
  response.reasons.forEach(validateReason);

  if (!Array.isArray(response.evidence_used)) {
    fail('INVALID_GYEOL_EVIDENCE_USED', 'evidence_used must be an array');
  }
  if (new Set(response.evidence_used).size !== response.evidence_used.length) {
    fail('DUPLICATE_GYEOL_EVIDENCE_USED', 'evidence_used must not contain duplicates');
  }
  const available = new Set(validatedRequest.evidence.map((record) => record.id));
  for (const id of response.evidence_used) {
    if (typeof id !== 'string' || !available.has(id)) {
      fail('GYEOL_EVIDENCE_OUT_OF_SCOPE', 'Gyeol verdict referenced evidence outside the request');
    }
  }

  if (response.advisory_only !== true ||
      response.runtime_effect !== 'NONE' ||
      response.persistence_effect !== 'NONE' ||
      response.authority_change_allowed !== false) {
    fail('GYEOL_EFFECT_BOUNDARY_INVALID', 'Gyeol verdict must remain advisory and effect-free');
  }
  if (!Array.isArray(response.mutation_requests) || response.mutation_requests.length !== 0) {
    fail('GYEOL_MUTATION_FORBIDDEN', 'Gyeol verdict must not request mutations in P19');
  }

  return freezeCopy(response);
}
