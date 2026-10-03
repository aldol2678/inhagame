import {
  executeTmlVerifiedWritePlan,
  prepareTmlVerifiedWritePlan,
  TML_P6_PLAN_STATUS
} from './verified-write-plan.mjs';
import {
  executeTmlVerifiedRewardTransition,
  prepareTmlRewardTransition,
  TML_P7_DISPOSITION
} from './reward-settlement.mjs';
import { captureTmlAdapterMethod } from './write-admission.mjs';
import { snapshotTmlData, summarizeTmlError } from './value-snapshot.mjs';

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
  if (!Array.isArray(transition.actions) || transition.actions.length !== 1 ||
      transition.actions[0]?.capability !== 'world.quest.advance') {
    pipelineError(
      'REWARD_TRANSITION_ACTION_INVALID',
      `reward transition ${transitionId} must contain only one world.quest.advance action`
    );
  }
  return transition.actions[0];
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

function pipelineResult({ status, planId, ordinary, reward, stoppedTransitionId }) {
  const dispatchStatuses = [ordinary.dispatchStatus, reward?.dispatchStatus];
  const dispatchStatus = dispatchStatuses.includes('ATTEMPTED') ? 'ATTEMPTED'
    : dispatchStatuses.includes('UNKNOWN') ? 'UNKNOWN' : 'NOT_ATTEMPTED';
  return Object.freeze({
    status,
    planId,
    completedSteps: ordinary.completedSteps + (reward?.disposition === TML_P7_DISPOSITION.VERIFIED ? 1 : 0),
    ordinary,
    reward,
    stoppedTransitionId,
    dispatchStatus,
    automaticMutationRetryAllowed: false
  });
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
  if (typeof questReadAdapter?.read !== 'function' || typeof questAdvanceAdapter?.advance !== 'function') {
    throw new TypeError('reward-aware pipeline requires quest read/write adapters');
  }
  if (typeof walletReadAdapter?.read !== 'function' || typeof progressionReadAdapter?.read !== 'function') {
    throw new TypeError('reward-aware pipeline requires wallet/progression read adapters');
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
  const rewardSpecSnapshot = snapshotTmlData(rewardSpec);
  validatePipeline(moduleSnapshot, selectedIds, rewardTransitionId, rewardSpecSnapshot);

  // Capture every method before any caller-supplied key factory can change it.
  const capturedQuestRead = captureTmlAdapterMethod(questReadAdapter, 'read', 'quest read adapter');
  const capturedQuestAdvance = captureTmlAdapterMethod(questAdvanceAdapter, 'advance', 'quest advance adapter');
  const capturedWalletRead = captureTmlAdapterMethod(walletReadAdapter, 'read', 'wallet read adapter');
  const capturedProgressionRead = captureTmlAdapterMethod(progressionReadAdapter, 'read', 'progression read adapter');

  const preparedOrdinary = selectedIds.length > 0 ? prepareTmlVerifiedWritePlan({
    module: moduleSnapshot,
    profile: profileSnapshot,
    transitionIds: selectedIds,
    context: contextSnapshot,
    readAdapter: capturedQuestRead,
    advanceAdapter: capturedQuestAdvance,
    planId: `${planId}.ordinary`,
    now,
    createExecutionKey: ({ index, action, ...rest }) =>
      createExecutionKey({ planId, index, action, phase: 'ordinary', ...rest })
  }) : null;

  const rewardAction = rewardActionFor(moduleSnapshot, rewardTransitionId);
  const preparedReward = prepareTmlRewardTransition({
    module: moduleSnapshot,
    profile: profileSnapshot,
    transitionId: rewardTransitionId,
    actionId: rewardAction.id,
    context: { ...contextSnapshot, planId, planIndex: selectedIds.length },
    questReadAdapter: capturedQuestRead,
    questAdvanceAdapter: capturedQuestAdvance,
    walletReadAdapter: capturedWalletRead,
    progressionReadAdapter: capturedProgressionRead,
    rewardSpec: rewardSpecSnapshot,
    now,
    traceId: `${planId}.reward.trace`,
    createExecutionKey: ({ action, ...rest }) =>
      createExecutionKey({ planId, index: selectedIds.length, action, phase: 'reward', ...rest })
  });

  if (preparedOrdinary?.steps.some((step) => step.executionKey === preparedReward.write.executionKey)) {
    pipelineError('PIPELINE_EXECUTION_KEY_DUPLICATE', 'reward and ordinary actions require distinct execution keys');
  }

  let ordinary = Object.freeze({
    status: TML_P6_PLAN_STATUS.VERIFIED,
    planId: `${planId}.ordinary`,
    completedSteps: 0,
    stoppedAt: null,
    stoppedTransitionId: null,
    dispatchStatus: 'NOT_ATTEMPTED',
    automaticMutationRetryAllowed: false,
    steps: Object.freeze([])
  });

  if (preparedOrdinary) {
    ordinary = await executeTmlVerifiedWritePlan({
      module: preparedOrdinary.module,
      profile: preparedOrdinary.profile,
      transitionIds: preparedOrdinary.transitionIds,
      context: preparedOrdinary.context,
      readAdapter: preparedOrdinary.readAdapter,
      advanceAdapter: preparedOrdinary.advanceAdapter,
      planId: preparedOrdinary.planId,
      now: preparedOrdinary.now,
      createExecutionKey: ({ index }) => preparedOrdinary.steps[index].executionKey
    });
  }

  if (ordinary.status !== TML_P6_PLAN_STATUS.VERIFIED) {
    return pipelineResult({
      status: TML_P8_PIPELINE_STATUS.STOPPED,
      planId,
      ordinary,
      reward: null,
      stoppedTransitionId: ordinary.stoppedTransitionId
    });
  }

  const write = preparedReward.write;
  let reward;
  try {
    reward = await executeTmlVerifiedRewardTransition({
      module: write.module,
      profile: write.profile,
      transitionId: write.transition.id,
      actionId: write.action.id,
      context: write.context,
      questReadAdapter: write.readAdapter,
      questAdvanceAdapter: write.advanceAdapter,
      walletReadAdapter: preparedReward.walletReadAdapter,
      progressionReadAdapter: preparedReward.progressionReadAdapter,
      rewardSpec: preparedReward.rewardSpec,
      now: preparedReward.now,
      traceId: preparedReward.traceId,
      createExecutionKey: () => write.executionKey
    });
  } catch (error) {
    reward = Object.freeze({
      disposition: TML_P7_DISPOSITION.SETTLEMENT_UNVERIFIED,
      verification: 'UNKNOWN',
      transition: null,
      trace: null,
      dispatchStatus: 'UNKNOWN',
      automaticMutationRetryAllowed: false,
      attempt: Object.freeze({
        requestedExecutionKey: write.executionKey,
        dispatchStatus: 'UNKNOWN',
        error: summarizeTmlError(error)
      })
    });
    return pipelineResult({
      status: TML_P8_PIPELINE_STATUS.STOPPED,
      planId,
      ordinary,
      reward,
      stoppedTransitionId: rewardTransitionId
    });
  }

  if (reward.disposition === TML_P7_DISPOSITION.HOLD_BEFORE_EXECUTION) {
    return pipelineResult({
      status: TML_P8_PIPELINE_STATUS.STOPPED,
      planId,
      ordinary,
      reward,
      stoppedTransitionId: rewardTransitionId
    });
  }

  const verified = reward.disposition === TML_P7_DISPOSITION.VERIFIED;
  return pipelineResult({
    status: verified ? TML_P8_PIPELINE_STATUS.VERIFIED : TML_P8_PIPELINE_STATUS.REWARD_UNVERIFIED,
    planId,
    ordinary,
    reward,
    stoppedTransitionId: verified ? null : rewardTransitionId
  });
}
