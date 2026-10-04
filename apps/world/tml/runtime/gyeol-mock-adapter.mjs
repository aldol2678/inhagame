import {
  GYEOL_VERDICT_STATUS,
  TML_GYEOL_VERDICT_BRIDGE_CONTRACT,
  validateTmlGyeolVerdictResponse
} from './gyeol-verdict-contract.mjs';

export const TML_GYEOL_MOCK_ADAPTER_CONTRACT = 'tml-gyeol-mock-adapter@p20';

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlGyeolMockAdapterError';
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

function ensureRequest(request) {
  if (!request || request.schema !== 'tml.gyeol-verdict-request' ||
      request.version !== '0.1' ||
      request.contract !== TML_GYEOL_VERDICT_BRIDGE_CONTRACT ||
      request.mode !== 'SHADOW_ONLY' ||
      request.boundary?.advisoryOnly !== true ||
      request.boundary?.runtimeEffect !== 'NONE' ||
      request.boundary?.persistenceEffect !== 'NONE' ||
      request.boundary?.authorityChangeAllowed !== false) {
    fail('INVALID_GYEOL_MOCK_REQUEST', 'P20 mock adapter requires a valid P19 shadow-only request');
  }
  return request;
}

function normalizeDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    fail('INVALID_GYEOL_MOCK_DECISION', 'mock decide() must return an object');
  }
  if (!Object.values(GYEOL_VERDICT_STATUS).includes(decision.status)) {
    fail('INVALID_GYEOL_MOCK_STATUS', 'mock decide() returned an unsupported status');
  }
  if (!Array.isArray(decision.reasons) || decision.reasons.length === 0) {
    fail('INVALID_GYEOL_MOCK_REASONS', 'mock decide() must return at least one reason');
  }
  if (!Array.isArray(decision.evidence_used)) {
    fail('INVALID_GYEOL_MOCK_EVIDENCE', 'mock decide() must return evidence_used');
  }
  return decision;
}

export function createTmlGyeolMockAdapter({
  decide,
  now = () => new Date().toISOString(),
  source = 'TEST_MOCK',
  mockOnly = true
} = {}) {
  if (mockOnly !== true || source !== 'TEST_MOCK') {
    fail('MOCK_BRAND_REQUIRED', 'P20 accepts TEST_MOCK adapters only');
  }
  if (typeof decide !== 'function') {
    fail('MOCK_DECIDE_REQUIRED', 'createTmlGyeolMockAdapter requires decide(request)');
  }
  if (typeof now !== 'function') {
    fail('MOCK_CLOCK_REQUIRED', 'createTmlGyeolMockAdapter requires a clock function');
  }

  return Object.freeze({
    contract: TML_GYEOL_MOCK_ADAPTER_CONTRACT,
    mockOnly: true,
    source: 'TEST_MOCK',
    async evaluate(request) {
      ensureRequest(request);
      const decision = normalizeDecision(await decide(request));
      const response = freezeCopy({
        schema: 'gyeol.verdict',
        version: '0.1',
        contract: TML_GYEOL_VERDICT_BRIDGE_CONTRACT,
        request_id: request.id,
        status: decision.status,
        reasons: decision.reasons,
        evidence_used: decision.evidence_used,
        evaluated_at: now(),
        advisory_only: true,
        runtime_effect: 'NONE',
        persistence_effect: 'NONE',
        authority_change_allowed: false,
        mutation_requests: []
      });
      return validateTmlGyeolVerdictResponse({ request, response });
    }
  });
}
