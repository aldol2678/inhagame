import { isTmlGyeolMockAdapter } from './gyeol-mock-adapter.mjs';
import {
  validateTmlGyeolVerdictRequest,
  validateTmlGyeolVerdictResponse
} from './gyeol-verdict-contract.mjs';

export const TML_GYEOL_REPLAY_CONFORMANCE_CONTRACT = 'tml-gyeol-replay-conformance@p20';

export const TML_GYEOL_REPLAY_STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL'
});

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

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticProjection(response) {
  return freezeCopy({
    status: response.status,
    reasons: response.reasons,
    evidence_used: response.evidence_used,
    advisory_only: response.advisory_only,
    runtime_effect: response.runtime_effect,
    persistence_effect: response.persistence_effect,
    authority_change_allowed: response.authority_change_allowed,
    mutation_requests: response.mutation_requests
  });
}

function diagnostic(code, message, attempt = null) {
  return Object.freeze({
    code,
    message,
    ...(attempt == null ? {} : { attempt })
  });
}

function replayResult({ status, attempts = 0, semanticReplayStable = false, diagnostics = [], outputs = [] }) {
  return freezeCopy({
    schema: 'tml.gyeol-replay-conformance',
    version: '0.1',
    contract: TML_GYEOL_REPLAY_CONFORMANCE_CONTRACT,
    status,
    mockOnly: true,
    liveAdapterInvocationAllowed: false,
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    authorityChangeAllowed: false,
    attempts,
    semanticReplayStable,
    diagnostics,
    outputs
  });
}

export async function runTmlGyeolReplayConformance({
  request,
  adapter,
  attempts = 3
} = {}) {
  const diagnostics = [];
  const outputs = [];
  let validatedRequest;

  try {
    validatedRequest = validateTmlGyeolVerdictRequest(request);
  } catch (error) {
    diagnostics.push(diagnostic(
      error?.code ?? 'INVALID_REPLAY_REQUEST',
      error?.message ?? 'P20 requires a valid strict P19 request'
    ));
    return replayResult({
      status: TML_GYEOL_REPLAY_STATUS.FAIL,
      diagnostics,
      outputs
    });
  }

  if (!isTmlGyeolMockAdapter(adapter)) {
    diagnostics.push(diagnostic(
      'MOCK_ADAPTER_REQUIRED',
      'P20 refuses adapters that were not created by createTmlGyeolMockAdapter'
    ));
    return replayResult({
      status: TML_GYEOL_REPLAY_STATUS.FAIL,
      diagnostics,
      outputs
    });
  }

  if (!Number.isInteger(attempts) || attempts < 2 || attempts > 20) {
    diagnostics.push(diagnostic('INVALID_REPLAY_ATTEMPTS', 'attempts must be an integer from 2 to 20'));
    return replayResult({
      status: TML_GYEOL_REPLAY_STATUS.FAIL,
      diagnostics,
      outputs
    });
  }

  const requestBefore = stable(validatedRequest);
  let baseline = null;

  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await adapter.evaluate(validatedRequest);
      validateTmlGyeolVerdictResponse({ request: validatedRequest, response });
      const projection = semanticProjection(response);
      const canonical = stable(projection);
      outputs.push(Object.freeze({
        attempt: index + 1,
        response,
        projection
      }));
      if (baseline === null) baseline = canonical;
      else if (canonical !== baseline) {
        diagnostics.push(diagnostic(
          'NONDETERMINISTIC_GYEOL_VERDICT',
          'same request produced a different semantic verdict projection',
          index + 1
        ));
      }
    } catch (error) {
      diagnostics.push(diagnostic(
        error?.code ?? 'MOCK_REPLAY_INVOCATION_FAILED',
        error?.message ?? 'mock replay invocation failed',
        index + 1
      ));
      break;
    }

    if (stable(validatedRequest) !== requestBefore) {
      diagnostics.push(diagnostic(
        'REPLAY_REQUEST_MUTATED',
        'mock adapter mutated the validated P19 request',
        index + 1
      ));
      break;
    }
  }

  const pass = diagnostics.length === 0 && outputs.length === attempts;
  return replayResult({
    status: pass ? TML_GYEOL_REPLAY_STATUS.PASS : TML_GYEOL_REPLAY_STATUS.FAIL,
    attempts: outputs.length,
    semanticReplayStable: pass,
    diagnostics,
    outputs
  });
}
