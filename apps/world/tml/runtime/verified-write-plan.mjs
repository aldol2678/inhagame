import {
  executeTmlVerifiedWriteTransition,
  TML_P5_DISPOSITION
} from './verified-write-runtime.mjs';
import { captureTmlAdapterMethod, prepareTmlWriteTransition } from './write-admission.mjs';
import { snapshotTmlData, summarizeTmlError } from './value-snapshot.mjs';

export const TML_P6_PLAN_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  STOPPED: 'STOPPED'
});

function planError(code, message) {
  const error = new Error(message);
  error.name = 'TmlVerifiedWritePlanError';
  error.code = code;
  throw error;
}

function transitionIndexMap(module) {
  return new Map(module.transitions.map((transition, index) => [transition.id, index]));
}

function validateTransitionPlan(module, transitionIds) {
  if (!Array.isArray(transitionIds) || transitionIds.length === 0) {
    planError('TRANSITION_PLAN_REQUIRED', 'verified write plan requires at least one transition id');
  }

  const indices = transitionIndexMap(module);
  const seen = new Set();
  let previousIndex = -1;

  for (const transitionId of transitionIds) {
    if (typeof transitionId !== 'string' || !indices.has(transitionId)) {
      planError('TRANSITION_PLAN_UNKNOWN_ID', `unknown transition in plan: ${String(transitionId)}`);
    }
    if (seen.has(transitionId)) {
      planError('TRANSITION_PLAN_DUPLICATE_ID', `duplicate transition in plan: ${transitionId}`);
    }

    const index = indices.get(transitionId);
    if (index <= previousIndex) {
      planError('TRANSITION_PLAN_ORDER_INVALID', 'transition plan must follow module declaration order');
    }

    seen.add(transitionId);
    previousIndex = index;
  }
}

function actionForTransition(transition) {
  if (!Array.isArray(transition.actions) || transition.actions.length !== 1 ||
      transition.actions[0]?.capability !== 'world.quest.advance') {
    planError(
      'TRANSITION_PLAN_ACTION_INVALID',
      `transition ${transition.id} must contain only one world.quest.advance action`
    );
  }
  return transition.actions[0];
}

function defaultPlanExecutionKey({ planId, index, action }) {
  return `${planId}.step-${index + 1}.${action.id}`;
}

export function prepareTmlVerifiedWritePlan({
  module,
  profile,
  transitionIds,
  context,
  readAdapter,
  advanceAdapter,
  planId = 'tml-write-plan',
  now = () => new Date().toISOString(),
  createExecutionKey = defaultPlanExecutionKey
} = {}) {
  if (!module || !Array.isArray(module.transitions)) {
    throw new TypeError('verified write plan requires a TML module');
  }
  if (!profile) throw new TypeError('verified write plan requires a TML profile');
  if (!context || typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new TypeError('verified write plan context requires userId');
  }
  if (!readAdapter || typeof readAdapter.read !== 'function') {
    throw new TypeError('verified write plan requires readAdapter');
  }
  if (!advanceAdapter || typeof advanceAdapter.advance !== 'function') {
    throw new TypeError('verified write plan requires advanceAdapter');
  }
  if (typeof planId !== 'string' || planId.length === 0) {
    throw new TypeError('planId must be a non-empty string');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createExecutionKey !== 'function') throw new TypeError('createExecutionKey must be a function');

  const moduleSnapshot = snapshotTmlData(module);
  const profileSnapshot = snapshotTmlData(profile);
  const contextSnapshot = snapshotTmlData(context);
  const selectedIds = snapshotTmlData(transitionIds);
  validateTransitionPlan(moduleSnapshot, selectedIds);

  const preparedSteps = [];
  const executionKeys = new Set();
  const capturedReadAdapter = captureTmlAdapterMethod(readAdapter, 'read', 'quest read adapter');
  const capturedAdvanceAdapter = captureTmlAdapterMethod(advanceAdapter, 'advance', 'quest advance adapter');

  for (let index = 0; index < selectedIds.length; index += 1) {
    const transitionId = selectedIds[index];
    const transition = moduleSnapshot.transitions.find((item) => item.id === transitionId);
    const action = actionForTransition(transition);
    const prepared = prepareTmlWriteTransition({
      module: moduleSnapshot,
      profile: profileSnapshot,
      transitionId,
      actionId: action.id,
      context: {
        ...contextSnapshot,
        planId,
        planIndex: index
      },
      readAdapter: capturedReadAdapter,
      advanceAdapter: capturedAdvanceAdapter,
      traceId: `${planId}.trace.${index + 1}`,
      now,
      createExecutionKey: ({ module: currentModule, profile: currentProfile, transition: currentTransition, action: currentAction, context: currentContext }) =>
        createExecutionKey({
          planId,
          index,
          module: currentModule,
          profile: currentProfile,
          transition: currentTransition,
          action: currentAction,
          context: currentContext
        })
    });

    if (executionKeys.has(prepared.executionKey)) {
      planError('TRANSITION_PLAN_EXECUTION_KEY_DUPLICATE', 'each planned action requires a distinct execution key');
    }
    executionKeys.add(prepared.executionKey);
    preparedSteps.push(prepared);
  }

  return Object.freeze({
    module: moduleSnapshot,
    profile: profileSnapshot,
    context: contextSnapshot,
    transitionIds: selectedIds,
    readAdapter: capturedReadAdapter,
    advanceAdapter: capturedAdvanceAdapter,
    planId,
    now,
    steps: Object.freeze(preparedSteps)
  });
}

function dispatchStatusForSteps(steps) {
  if (steps.some((step) => step.dispatchStatus === 'ATTEMPTED')) return 'ATTEMPTED';
  if (steps.some((step) => step.dispatchStatus === 'UNKNOWN')) return 'UNKNOWN';
  return 'NOT_ATTEMPTED';
}

function stoppedPlan(planId, steps, index, transitionId) {
  return Object.freeze({
    status: TML_P6_PLAN_STATUS.STOPPED,
    planId,
    completedSteps: steps.filter((step) => step.disposition === TML_P5_DISPOSITION.VERIFIED).length,
    stoppedAt: index,
    stoppedTransitionId: transitionId,
    dispatchStatus: dispatchStatusForSteps(steps),
    automaticMutationRetryAllowed: false,
    steps: Object.freeze([...steps])
  });
}

export async function executeTmlVerifiedWritePlan(options = {}) {
  const preparedPlan = prepareTmlVerifiedWritePlan(options);
  const { planId } = preparedPlan;
  const steps = [];

  for (let index = 0; index < preparedPlan.steps.length; index += 1) {
    const prepared = preparedPlan.steps[index];
    const transitionId = prepared.transition.id;
    const actionId = prepared.action.id;
    let result;
    try {
      result = await executeTmlVerifiedWriteTransition({
        module: prepared.module,
        profile: prepared.profile,
        transitionId,
        actionId,
        context: prepared.context,
        readAdapter: prepared.readAdapter,
        advanceAdapter: prepared.advanceAdapter,
        traceId: prepared.traceId,
        now: prepared.now,
        createExecutionKey: () => prepared.executionKey
      });
    } catch (error) {
      // An escaped child error cannot prove that its provider was never called.
      const attempt = Object.freeze({
        requestedExecutionKey: prepared.executionKey,
        dispatchStatus: 'UNKNOWN',
        error: summarizeTmlError(error)
      });
      result = Object.freeze({
        disposition: TML_P5_DISPOSITION.EXECUTION_OUTCOME_UNKNOWN,
        transitionId,
        actionId,
        executionKey: prepared.executionKey,
        dispatchStatus: 'UNKNOWN',
        automaticMutationRetryAllowed: false,
        attempt,
        precondition: null,
        provider: null,
        postcondition: null,
        trace: null
      });
    }

    const dispatchStatus = result.dispatchStatus ?? 'UNKNOWN';
    const attempt = result.attempt ?? Object.freeze({
      requestedExecutionKey: prepared.executionKey,
      dispatchStatus
    });

    steps.push(Object.freeze({
      index,
      transitionId,
      actionId,
      executionKey: prepared.executionKey,
      disposition: result.disposition,
      dispatchStatus,
      automaticMutationRetryAllowed: false,
      attempt,
      result
    }));

    if (result.disposition !== TML_P5_DISPOSITION.VERIFIED) {
      return stoppedPlan(planId, steps, index, transitionId);
    }
  }

  return Object.freeze({
    status: TML_P6_PLAN_STATUS.VERIFIED,
    planId,
    completedSteps: steps.length,
    stoppedAt: null,
    stoppedTransitionId: null,
    dispatchStatus: dispatchStatusForSteps(steps),
    automaticMutationRetryAllowed: false,
    steps: Object.freeze([...steps])
  });
}
