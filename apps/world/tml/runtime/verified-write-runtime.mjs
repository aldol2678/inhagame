import { assertTmlConformance } from './conformance.mjs';
import { createTmlTraceRecorder } from './trace.mjs';
import { TML_VERIFICATION_STATUS, verifyTmlTransition } from './verification.mjs';
import { TML_QUEST_ADVANCE_CAPABILITY } from './quest-advance-adapter.mjs';

export const TML_P5_DISPOSITION = Object.freeze({
  HOLD_BEFORE_EXECUTION: 'HOLD_BEFORE_EXECUTION',
  VERIFIED: 'VERIFIED',
  EXECUTED_UNVERIFIED: 'EXECUTED_UNVERIFIED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  EXECUTION_OUTCOME_UNKNOWN: 'EXECUTION_OUTCOME_UNKNOWN'
});

let executionSequence = 0;

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function defaultExecutionKey({ action }) {
  executionSequence += 1;
  return `tml-write.${token(action.id)}.${Date.now()}.${executionSequence}`;
}

function ensureTime(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-compatible timestamp`);
  }
  return value;
}

function errorSummary(error) {
  if (!error) return null;
  return Object.freeze({
    code: typeof error.code === 'string' ? error.code
      : typeof error.name === 'string' ? error.name
        : 'TML_RUNTIME_ERROR',
    message: typeof error.message === 'string' ? error.message : undefined
  });
}

function toTmlValue(value) {
  if (value === null) return Object.freeze({ type: 'null' });
  if (typeof value === 'string') return Object.freeze({ type: 'string', value });
  if (typeof value === 'number' && Number.isFinite(value)) return Object.freeze({ type: 'number', value });
  if (typeof value === 'boolean') return Object.freeze({ type: 'boolean', value });
  if (Array.isArray(value)) return Object.freeze({
    type: 'list',
    value: Object.freeze(value.map(toTmlValue))
  });
  if (value && typeof value === 'object') {
    return Object.freeze({
      type: 'object',
      value: Object.freeze(Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, toTmlValue(item)])
      ))
    });
  }
  return Object.freeze({ type: 'string', value: String(value) });
}

function outputValues(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  return Object.freeze(Object.fromEntries(
    Object.entries(output)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toTmlValue(value)])
  ));
}

function resolveTransition(module, transitionId) {
  const transition = module.transitions.find((item) => item.id === transitionId);
  if (!transition) {
    const error = new Error(`TML transition not found: ${transitionId}`);
    error.name = 'TmlVerifiedWriteError';
    error.code = 'TRANSITION_NOT_FOUND';
    throw error;
  }
  return transition;
}

function resolveAction(transition, actionId) {
  const candidates = actionId
    ? transition.actions.filter((item) => item.id === actionId)
    : transition.actions.filter((item) => item.capability === TML_QUEST_ADVANCE_CAPABILITY);

  if (candidates.length !== 1) {
    const error = new Error(actionId
      ? `TML action not found or ambiguous: ${actionId}`
      : 'verified write transition must contain exactly one world.quest.advance action');
    error.name = 'TmlVerifiedWriteError';
    error.code = 'ACTION_NOT_RESOLVED';
    throw error;
  }

  const action = candidates[0];
  if (action.capability !== TML_QUEST_ADVANCE_CAPABILITY) {
    const error = new Error('P5 supports only world.quest.advance');
    error.name = 'TmlVerifiedWriteError';
    error.code = 'UNSUPPORTED_WRITE_CAPABILITY';
    throw error;
  }
  return action;
}

function resolveQuestArgs(action) {
  const questRef = action.args?.quest?.type === 'ref' ? action.args.quest.value : null;
  const event = action.args?.event?.type === 'string' ? action.args.event.value : null;
  if (!questRef || !event) {
    const error = new Error('world.quest.advance action requires quest ref and string event');
    error.name = 'TmlVerifiedWriteError';
    error.code = 'WRITE_ARGUMENTS_INVALID';
    throw error;
  }
  return { questRef, event };
}

function actionExecutionRecord(action, provider) {
  const record = {
    kind: 'action',
    id: `action-execution.${token(action.id)}.${token(provider.executionKey)}`,
    call: action.id,
    capability: action.capability,
    execution_key: provider.executionKey,
    requested_at: provider.requestedAt,
    completed_at: provider.completedAt,
    status: provider.ok ? 'SUCCEEDED' : 'FAILED'
  };
  const output = provider.ok ? outputValues(provider.output) : undefined;
  if (output && Object.keys(output).length > 0) record.output = output;
  if (!provider.ok) record.error = provider.error ?? { code: 'QUEST_WRITE_PROVIDER_ERROR' };
  return Object.freeze(record);
}

function dispositionFor(provider, verificationStatus) {
  if (verificationStatus === TML_VERIFICATION_STATUS.SATISFIED) {
    return TML_P5_DISPOSITION.VERIFIED;
  }
  if (provider.ok) {
    if (verificationStatus === TML_VERIFICATION_STATUS.UNSATISFIED) {
      return TML_P5_DISPOSITION.VERIFICATION_FAILED;
    }
    return TML_P5_DISPOSITION.EXECUTED_UNVERIFIED;
  }
  return TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN;
}

async function safeRead(readAdapter, { userId, questRef }) {
  try {
    return Object.freeze({ ok: true, result: await readAdapter.read({ userId, questRef }) });
  } catch (error) {
    return Object.freeze({ ok: false, error: errorSummary(error) });
  }
}

export async function executeTmlVerifiedWriteTransition({
  module,
  profile,
  transitionId,
  actionId,
  context,
  readAdapter,
  advanceAdapter,
  traceId,
  now = () => new Date().toISOString(),
  createExecutionKey = defaultExecutionKey
} = {}) {
  assertTmlConformance(module, profile);

  if (!context || typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new TypeError('verified write context requires userId');
  }
  if (!readAdapter || typeof readAdapter.read !== 'function') {
    throw new TypeError('verified write runtime requires readAdapter');
  }
  if (!advanceAdapter || typeof advanceAdapter.advance !== 'function') {
    throw new TypeError('verified write runtime requires advanceAdapter');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createExecutionKey !== 'function') throw new TypeError('createExecutionKey must be a function');

  const transition = resolveTransition(module, transitionId);
  const action = resolveAction(transition, actionId);
  const { questRef, event } = resolveQuestArgs(action);

  const startedAt = ensureTime(now(), 'startedAt');
  const recorder = createTmlTraceRecorder({
    id: traceId ?? `trace.${token(transition.id)}.${token(startedAt)}`,
    module: module.id,
    profile: profile.id,
    startedAt
  });

  const preRead = await safeRead(readAdapter, { userId: context.userId, questRef });
  if (preRead.ok) recorder.appendReadResult(preRead.result);

  const preVerification = verifyTmlTransition({
    transition,
    profile,
    observations: preRead.ok ? preRead.result.observations : [],
    facts: preRead.ok ? preRead.result.facts : [],
    checkedAt: ensureTime(now(), 'precondition checkedAt'),
    phase: 'precondition'
  });
  recorder.appendVerificationResult(preVerification);

  if (preVerification.status !== TML_VERIFICATION_STATUS.SATISFIED) {
    const trace = recorder.close(ensureTime(now(), 'endedAt'));
    return Object.freeze({
      disposition: TML_P5_DISPOSITION.HOLD_BEFORE_EXECUTION,
      transitionId: transition.id,
      actionId: action.id,
      precondition: preVerification.status,
      preReadError: preRead.ok ? null : preRead.error,
      provider: null,
      postcondition: null,
      trace
    });
  }

  const executionKey = createExecutionKey({ module, profile, transition, action, context });
  if (typeof executionKey !== 'string' || executionKey.length === 0) {
    throw new TypeError('createExecutionKey must return a non-empty string');
  }

  const provider = await advanceAdapter.advance({
    userId: context.userId,
    questRef,
    event,
    executionKey
  });
  recorder.append(actionExecutionRecord(action, provider));

  const postRead = await safeRead(readAdapter, { userId: context.userId, questRef });
  if (postRead.ok) recorder.appendReadResult(postRead.result);

  const postVerification = verifyTmlTransition({
    transition,
    profile,
    observations: postRead.ok ? postRead.result.observations : [],
    facts: postRead.ok ? postRead.result.facts : [],
    checkedAt: ensureTime(now(), 'postcondition checkedAt'),
    phase: 'postcondition'
  });
  recorder.appendVerificationResult(postVerification);

  const disposition = dispositionFor(provider, postVerification.status);
  const trace = recorder.close(ensureTime(now(), 'endedAt'));

  return Object.freeze({
    disposition,
    transitionId: transition.id,
    actionId: action.id,
    executionKey,
    precondition: preVerification.status,
    provider: Object.freeze({
      ok: provider.ok,
      error: provider.ok ? null : provider.error
    }),
    postcondition: postVerification.status,
    postReadError: postRead.ok ? null : postRead.error,
    trace
  });
}
