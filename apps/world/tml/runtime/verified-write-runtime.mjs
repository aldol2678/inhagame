import { assertTmlReadResultStructure, isTmlDateTime } from './conformance.mjs';
import { createTmlTraceRecorder } from './trace.mjs';
import { TML_VERIFICATION_STATUS, verifyTmlTransition } from './verification.mjs';
import { prepareTmlWriteTransition } from './write-admission.mjs';
import { snapshotTmlData, summarizeTmlError } from './value-snapshot.mjs';

export const TML_P5_DISPOSITION = Object.freeze({
  HOLD_BEFORE_EXECUTION: 'HOLD_BEFORE_EXECUTION',
  VERIFIED: 'VERIFIED',
  EXECUTED_UNVERIFIED: 'EXECUTED_UNVERIFIED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  EXECUTION_OUTCOME_UNKNOWN: 'EXECUTION_OUTCOME_UNKNOWN'
});

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function ensureTime(value, label) {
  if (!isTmlDateTime(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-compatible timestamp`);
  }
  return value;
}

function toTmlValue(value) {
  if (value === null) return Object.freeze({ type: 'null' });
  if (typeof value === 'string') return Object.freeze({ type: 'string', value });
  if (typeof value === 'number' && Number.isFinite(value)) return Object.freeze({ type: 'number', value });
  if (typeof value === 'boolean') return Object.freeze({ type: 'boolean', value });
  if (Array.isArray(value)) return Object.freeze({ type: 'list', value: Object.freeze(value.map(toTmlValue)) });
  if (value && typeof value === 'object') {
    return Object.freeze({
      type: 'object',
      value: Object.freeze(Object.fromEntries(Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toTmlValue(item)])))
    });
  }
  throw new TypeError('provider output cannot be represented as a TML value');
}

function outputValues(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  return Object.freeze(Object.fromEntries(Object.entries(output)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, toTmlValue(value)])));
}

function actionExecutionRecord(action, provider, attempt) {
  const attributed = provider.identityMatched === true;
  const record = {
    kind: 'action',
    id: `action-execution.${token(action.id)}.${token(attempt.requestedExecutionKey)}`,
    call: action.id,
    capability: action.capability,
    execution_key: attempt.requestedExecutionKey,
    requested_at: attempt.requestedAt,
    status: attributed ? (provider.ok ? 'SUCCEEDED' : 'FAILED') : 'REQUESTED',
    extensions: Object.freeze({
      dispatch_status: attempt.dispatchStatus,
      received_execution_key: attempt.receivedExecutionKey,
      identity_matched: provider.identityMatched
    })
  };
  if (provider.completedAt) record.completed_at = provider.completedAt;
  const output = attributed && provider.ok ? outputValues(provider.output) : undefined;
  if (output && Object.keys(output).length > 0) record.output = output;
  if (provider.error) record.error = provider.error;
  return Object.freeze(record);
}

function dispositionFor(provider, verificationStatus) {
  // VERIFIED retains P5's existing state-readback meaning. Identity mismatch and
  // processing failures must not turn an unrelated matching state into success.
  if (provider.identityMatched === false || provider.processingError) {
    return TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN;
  }
  if (verificationStatus === TML_VERIFICATION_STATUS.SATISFIED) return TML_P5_DISPOSITION.VERIFIED;
  if (provider.ok) {
    return verificationStatus === TML_VERIFICATION_STATUS.UNSATISFIED
      ? TML_P5_DISPOSITION.VERIFICATION_FAILED : TML_P5_DISPOSITION.EXECUTED_UNVERIFIED;
  }
  return TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN;
}

async function safeRead(readAdapter, request) {
  try {
    const result = snapshotTmlData(await readAdapter.read(request));
    assertTmlReadResultStructure(result);
    return Object.freeze({ ok: true, result });
  } catch (error) {
    return Object.freeze({ ok: false, error: summarizeTmlError(error) });
  }
}

function providerErrorValue(value) {
  const error = snapshotTmlData(value);
  if (!error || typeof error !== 'object' || Array.isArray(error) ||
      typeof error.code !== 'string' || error.code.trim().length === 0 ||
      (error.message !== undefined && typeof error.message !== 'string') ||
      Object.keys(error).some((key) => key !== 'code' && key !== 'message')) {
    throw Object.assign(new Error('write adapter returned malformed error metadata'), { code: 'INVALID_PROVIDER_ERROR' });
  }
  // Optional undefined must not enter the published JSON action-error shape.
  return Object.freeze(error.message === undefined ? { code: error.code } : { code: error.code, message: error.message });
}

async function safeAdvance(advanceAdapter, request, attempt) {
  const provider = {
    ok: false, executionKey: null, identityMatched: null,
    requestedAt: null, completedAt: null, output: null, error: null
  };
  let returned = false;
  try {
    // An adapter exception cannot tell us whether its underlying provider was
    // reached. The built-in adapter supplies the more precise boundary status.
    attempt.dispatchStatus = 'UNKNOWN';
    const result = await advanceAdapter.advance(request);
    returned = true;
    attempt.providerReturned = true;
    if (!result || typeof result !== 'object') throw new TypeError('write adapter returned an invalid provider outcome');
    provider.executionKey = typeof result.executionKey === 'string' ? result.executionKey : null;
    attempt.receivedExecutionKey = provider.executionKey;
    provider.identityMatched = provider.executionKey === null ? null : provider.executionKey === request.executionKey;
    if (['NOT_ATTEMPTED', 'ATTEMPTED', 'UNKNOWN'].includes(result.dispatchStatus)) {
      attempt.dispatchStatus = result.dispatchStatus;
    } else if (result.dispatchStatus === undefined && typeof result.ok === 'boolean' && provider.executionKey) {
      attempt.dispatchStatus = 'ATTEMPTED';
    }
    if (typeof result.providerReturned === 'boolean') attempt.providerReturned = result.providerReturned;
    provider.ok = result.ok === true;
    if (result.output !== undefined) provider.output = snapshotTmlData(result.output);
    if (result.response !== undefined) provider.response = snapshotTmlData(result.response);
    if (result.error !== undefined && result.error !== null) {
      provider.rawError = snapshotTmlData(result.error);
      provider.error = providerErrorValue(provider.rawError);
    }
    if (result.processingError !== undefined && result.processingError !== null) provider.processingError = providerErrorValue(result.processingError);
    if (typeof result.ok !== 'boolean' || !provider.executionKey ||
        (result.dispatchStatus !== undefined && !['NOT_ATTEMPTED', 'ATTEMPTED', 'UNKNOWN'].includes(result.dispatchStatus))) {
      throw new TypeError('write adapter returned an invalid provider outcome');
    }
    if (result.requestedAt !== null || !provider.processingError) {
      provider.requestedAt = ensureTime(result.requestedAt, 'provider requestedAt');
    }
    if (result.completedAt !== null || !provider.processingError) {
      provider.completedAt = ensureTime(result.completedAt, 'provider completedAt');
    }
    if (!provider.ok && !provider.error) throw new TypeError('failed provider outcome requires error metadata');
    if (attempt.dispatchStatus === 'NOT_ATTEMPTED' &&
        (provider.ok || result.providerReturned !== false || provider.output !== null || provider.response !== undefined)) {
      throw new TypeError('provider return evidence contradicts dispatch NOT_ATTEMPTED');
    }
  } catch (error) {
    const summary = summarizeTmlError(error);
    provider.error ??= summary;
    if (returned) {
      provider.processingError = summary;
      if (attempt.dispatchStatus === 'NOT_ATTEMPTED') attempt.dispatchStatus = 'UNKNOWN';
    }
  }
  if (provider.identityMatched === false) {
    provider.processingError = Object.freeze({ code: 'EXECUTION_KEY_MISMATCH', message: 'provider executionKey differs from the requested executionKey' });
    provider.error ??= provider.processingError;
  }
  return Object.freeze(provider);
}

export async function executeTmlVerifiedWriteTransition(options = {}) {
  // All static failures (including key creation) happen before the first await.
  const prepared = prepareTmlWriteTransition(options);
  const { module, profile, transition, action, context, questRef, event, executionKey, readAdapter, advanceAdapter, now } = prepared;
  const attempt = {
    requestedExecutionKey: executionKey, receivedExecutionKey: null,
    dispatchStatus: 'NOT_ATTEMPTED', providerReturned: false, requestedAt: null
  };
  let recorder = null;
  let preRead = null;
  let postRead = null;
  let preVerification = null;
  let postVerification = null;
  let provider = null;
  let diagnostic = null;

  function finish(disposition) {
    let trace = null;
    let traceComplete = false;
    if (recorder) {
      try {
        trace = recorder.close(ensureTime(now(), 'endedAt'));
        traceComplete = diagnostic === null;
      } catch (error) {
        diagnostic ??= summarizeTmlError(error);
        try { trace = recorder.snapshot(); } catch { /* Attempt metadata remains available without a trace. */ }
      }
    }
    if (attempt.dispatchStatus === 'NOT_ATTEMPTED') {
      disposition = TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION;
    } else if (diagnostic || !traceComplete) {
      disposition = provider?.ok && provider?.identityMatched !== false && !provider?.processingError
        ? TML_P5_DISPOSITION.EXECUTED_UNVERIFIED : TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN;
    }
    return Object.freeze({
      disposition, transitionId: transition.id, actionId: action.id, executionKey,
      dispatchStatus: attempt.dispatchStatus, attempt: Object.freeze({ ...attempt }),
      automaticMutationRetryAllowed: false,
      precondition: preVerification?.status ?? TML_VERIFICATION_STATUS.UNKNOWN,
      preReadError: preRead?.ok === false ? preRead.error : null,
      provider,
      postcondition: postVerification?.status ?? (attempt.dispatchStatus === 'NOT_ATTEMPTED' ? null : TML_VERIFICATION_STATUS.UNKNOWN),
      postReadError: postRead?.ok === false ? postRead.error : null,
      reads: Object.freeze({ precondition: preRead?.result ?? null, postcondition: postRead?.result ?? null }),
      diagnostic: diagnostic ?? provider?.processingError ?? null,
      trace, traceComplete
    });
  }

  try {
    const startedAt = ensureTime(now(), 'startedAt');
    recorder = createTmlTraceRecorder({
      id: prepared.traceId ?? `trace.${token(transition.id)}.${token(startedAt)}`,
      module: module.id, profile: profile.id, startedAt
    });
    preRead = await safeRead(readAdapter, { userId: context.userId, questRef });
    if (preRead.ok) recorder.appendReadResult(preRead.result);
    preVerification = verifyTmlTransition({
      transition, profile,
      observations: preRead.ok ? preRead.result.observations : [],
      facts: preRead.ok ? preRead.result.facts : [],
      checkedAt: ensureTime(now(), 'precondition checkedAt'), phase: 'precondition'
    });
    recorder.appendVerificationResult(preVerification);
    if (preVerification.status !== TML_VERIFICATION_STATUS.SATISFIED) return finish(TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);

    attempt.requestedAt = ensureTime(now(), 'dispatch requestedAt');
    provider = await safeAdvance(advanceAdapter, { userId: context.userId, questRef, event, executionKey }, attempt);
    if (attempt.dispatchStatus !== 'NOT_ATTEMPTED') recorder.append(actionExecutionRecord(action, provider, attempt));
    if (attempt.dispatchStatus === 'NOT_ATTEMPTED') return finish(TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION);

    postRead = await safeRead(readAdapter, { userId: context.userId, questRef });
    if (postRead.ok) recorder.appendReadResult(postRead.result);
    postVerification = verifyTmlTransition({
      transition, profile,
      observations: postRead.ok ? postRead.result.observations : [],
      facts: postRead.ok ? postRead.result.facts : [],
      checkedAt: ensureTime(now(), 'postcondition checkedAt'), phase: 'postcondition'
    });
    recorder.appendVerificationResult(postVerification);
    return finish(dispositionFor(provider, postVerification.status));
  } catch (error) {
    diagnostic = summarizeTmlError(error);
    return finish(TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN);
  }
}
