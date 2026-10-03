import {
  executeTmlVerifiedWriteTransition,
  TML_P5_DISPOSITION
} from './verified-write-runtime.mjs';

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
  const writes = transition.actions.filter((action) => action.capability === 'world.quest.advance');
  if (writes.length !== 1) {
    planError(
      'TRANSITION_PLAN_ACTION_INVALID',
      `transition ${transition.id} must contain exactly one world.quest.advance action`
    );
  }
  return writes[0];
}

function defaultPlanExecutionKey({ planId, index, action }) {
  return `${planId}.step-${index + 1}.${action.id}`;
}

export async function executeTmlVerifiedWritePlan({
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

  validateTransitionPlan(module, transitionIds);

  const steps = [];

  for (let index = 0; index < transitionIds.length; index += 1) {
    const transitionId = transitionIds[index];
    const transition = module.transitions.find((item) => item.id === transitionId);
    const action = actionForTransition(transition);

    const result = await executeTmlVerifiedWriteTransition({
      module,
      profile,
      transitionId,
      actionId: action.id,
      context: {
        ...context,
        planId,
        planIndex: index
      },
      readAdapter,
      advanceAdapter,
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

    steps.push(Object.freeze({
      index,
      transitionId,
      actionId: action.id,
      disposition: result.disposition,
      result
    }));

    if (result.disposition !== TML_P5_DISPOSITION.VERIFIED) {
      return Object.freeze({
        status: TML_P6_PLAN_STATUS.STOPPED,
        planId,
        completedSteps: steps.filter((step) => step.disposition === TML_P5_DISPOSITION.VERIFIED).length,
        stoppedAt: index,
        stoppedTransitionId: transitionId,
        steps: Object.freeze([...steps])
      });
    }
  }

  return Object.freeze({
    status: TML_P6_PLAN_STATUS.VERIFIED,
    planId,
    completedSteps: steps.length,
    stoppedAt: null,
    stoppedTransitionId: null,
    steps: Object.freeze([...steps])
  });
}
