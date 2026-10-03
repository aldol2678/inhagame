import { executeTmlVerifiedWritePlan, TML_P6_PLAN_STATUS } from './verified-write-plan.mjs';
import { executeTmlVerifiedRewardTransition, TML_P7_DISPOSITION } from './reward-settlement.mjs';

export const TML_P8_PIPELINE_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  STOPPED: 'STOPPED',
  REWARD_UNVERIFIED: 'REWARD_UNVERIFIED'
});

function pipelineError(code, message) {
  const error = new Error(message);
  error.name = 'TmlRewardAwarePipelineError';
  error.code = code;
  throw error;
}

function transitionIndex(module, id) {
  return module.transitions.findIndex((transition) => transition.id === id);
}

function rewardActionFor(module, transitionId) {
  const transition = module.transitions.find((item) => item.id === transitionId);
  if (!transition) pipelineError('REWARD_TRANSITION_UNKNOWN', `unknown reward transition: ${transitionId}`);
  const actions = transition.actions.filter((action) => action.capability === 'world.quest.advance');
  if (actions.length !== 1) {
    pipelineError(
      'REWARD_TRANSITION_ACTION_INVALID',
      `reward transition ${transitionId} must contain exactly one world.quest.advance action`
    );
  }
  return actions[0];
}

function validatePipeline(module, transitionIds, rewardTransitionId, rewardSpec) {
  if (!module || !Array.isArray(module.transitions)) {
    throw new TypeError('reward-aware pipeline requires a TML module');
  }
  if (!Array.isArray(transitionIds)) {
    throw new TypeError('reward-aware pipeline transitionIds must be an array');
  }
  if (typeof rewardTransitionId !== 'string' || rewardTransitionId.length === 0) {
    throw new TypeError('rewardTransitionId must be a non-empty string');
  }
  if (rewardSpec?.source_transition !== rewardTransitionId) {
    pipelineError(
      'REWARD_SPEC_TRANSITION_MISMATCH',
      'reward spec source_transition must equal rewardTransitionId'
    );
  }

  const finalIndex = transitionIndex(module, rewardTransitionId);
  if (finalIndex < 0) pipelineError('REWARD_TRANSITION_UNKNOWN', `unknown reward transition: ${rewardTransitionId}`);

  const seen = new Set();
  let previousIndex = -1;
  for (const id of transitionIds) {
    const index = transitionIndex(module, id);
    if (index < 0) pipelineError('PIPELINE_TRANSITION_UNKNOWN', `unknown transition in pipeline: ${String(id)}`);
    if (seen.has(id)) pipelineError('PIPELINE_TRANSITION_DUPLICATE', `duplicate transition in pipeline: ${id}`);
    if (id === rewardTransitionId) {
      pipelineError('REWARD_TRANSITION_DUPLICATED', 'reward transition must not also appear in transitionIds');
    }
    if (index <= previousIndex) {
      pipelineError('PIPELINE_TRANSITION_ORDER_INVALID', 'pipeline transitions must follow module order');
    }
    if (index >= finalIndex) {
      pipelineError('PIPELINE_TRANSITION_AFTER_REWARD', 'ordinary transitions must precede the reward transition');
    }
    seen.add(id);
    previousIndex = index;
  }
}

function defaultExecutionKey({ planId, index, action }) {
  return `${planId}.step-${index + 1}.${action.id}`;
}

export async function executeTmlRewardAwarePipeline({
  module,
  profile,
  transitionIds,
  rewardTransitionId,
  rewardSpec,
  context,
  questReadAdapter,
  questAdvanceAdapter,
  walletReadAdapter,
  progressionReadAdapter,
  planId = 'tml-reward-aware-pipeline',
  now = () => new Date().toISOString(),
  createExecutionKey = defaultExecutionKey
} = {}) {
  if (!profile) throw new TypeError('reward-aware pipeline requires a TML profile');
  if (!context || typeof context.userId !== 'string' || context.userId.length === 0) {
    throw new TypeError('reward-aware pipeline context requires userId');
  }
  if (!questReadAdapter?.read || !questAdvanceAdapter?.advance) {
    throw new TypeError('reward-aware pipeline requires quest read/write adapters');
  }
  if (!walletReadAdapter?.read || !progressionReadAdapter?.read) {
    throw new TypeError('reward-aware pipeline requires wallet/progression read adapters');
  }
  if (typeof planId !== 'string' || planId.length === 0) {
    throw new TypeError('planId must be a non-empty string');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createExecutionKey !== 'function') throw new TypeError('createExecutionKey must be a function');

  validatePipeline(module, transitionIds, rewardTransitionId, rewardSpec);

  let ordinary = Object.freeze({
    status: TML_P6_PLAN_STATUS.VERIFIED,
    planId: `${planId}.ordinary`,
    completedSteps: 0,
    stoppedAt: null,
    stoppedTransitionId: null,
    steps: Object.freeze([])
  });

  if (transitionIds.length > 0) {
    ordinary = await executeTmlVerifiedWritePlan({
      module,
      profile,
      transitionIds,
      context,
      readAdapter: questReadAdapter,
      advanceAdapter: questAdvanceAdapter,
      planId: `${planId}.ordinary`,
      now,
      createExecutionKey: ({ index, action, ...rest }) =>
        createExecutionKey({ planId, index, action, phase: 'ordinary', ...rest })
    });
  }

  if (ordinary.status !== TML_P6_PLAN_STATUS.VERIFIED) {
    return Object.freeze({
      status: TML_P8_PIPELINE_STATUS.STOPPED,
      planId,
      completedSteps: ordinary.completedSteps,
      ordinary,
      reward: null,
      stoppedTransitionId: ordinary.stoppedTransitionId
    });
  }

  const rewardAction = rewardActionFor(module, rewardTransitionId);
  const reward = await executeTmlVerifiedRewardTransition({
    module,
    profile,
    transitionId: rewardTransitionId,
    actionId: rewardAction.id,
    context: {
      ...context,
      planId,
      planIndex: transitionIds.length
    },
    questReadAdapter,
    questAdvanceAdapter,
    walletReadAdapter,
    progressionReadAdapter,
    rewardSpec,
    now,
    traceId: `${planId}.reward.trace`,
    createExecutionKey: ({ action, ...rest }) =>
      createExecutionKey({
        planId,
        index: transitionIds.length,
        action,
        phase: 'reward',
        ...rest
      })
  });

  if (reward.disposition === TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION) {
    return Object.freeze({
      status: TML_P8_PIPELINE_STATUS.STOPPED,
      planId,
      completedSteps: ordinary.completedSteps,
      ordinary,
      reward,
      stoppedTransitionId: rewardTransitionId
    });
  }

  const verified = reward.disposition === TML_P7_DISPOSITION.VERIFIED;
  return Object.freeze({
    status: verified ? TML_P8_PIPELINE_STATUS.VERIFIED : TML_P8_PIPELINE_STATUS.REWARD_UNVERIFIED,
    planId,
    completedSteps: ordinary.completedSteps + (verified ? 1 : 0),
    ordinary,
    reward,
    stoppedTransitionId: verified ? null : rewardTransitionId
  });
}
