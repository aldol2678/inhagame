import { TML_QUEST_READ_CAPABILITY } from './quest-read-adapter.mjs';

function capabilityError(capability) {
  const error = new Error(`TML capability is not bound in P3 read-only runtime: ${capability}`);
  error.name = 'TmlCapabilityBindingError';
  error.code = 'CAPABILITY_NOT_BOUND';
  error.capability = capability;
  return error;
}

export function createTmlReadOnlyCapabilityRegistry({ questReadAdapter } = {}) {
  if (!questReadAdapter || typeof questReadAdapter.read !== 'function') {
    throw new TypeError('createTmlReadOnlyCapabilityRegistry requires a questReadAdapter');
  }

  const bindings = new Map([
    [TML_QUEST_READ_CAPABILITY, async (args, context) => {
      const questRef = args?.quest?.type === 'ref' ? args.quest.value : null;
      return questReadAdapter.read({ userId: context?.userId, questRef });
    }]
  ]);

  return Object.freeze({
    mode: 'READ_ONLY_P3',
    has(capability) {
      return bindings.has(capability);
    },
    async invoke(capability, args = {}, context = {}) {
      const handler = bindings.get(capability);
      if (!handler) throw capabilityError(capability);
      return handler(args, context);
    }
  });
}

import { TML_QUEST_ADVANCE_CAPABILITY } from './quest-advance-adapter.mjs';
import { executeTmlVerifiedWriteTransition } from './verified-write-runtime.mjs';

function stable(value) {
  return JSON.stringify(value);
}

function verifyBoundActionArgs(module, transitionId, actionId, args) {
  const transition = module?.transitions?.find?.((item) => item.id === transitionId);
  if (!transition) {
    const error = capabilityError(TML_QUEST_ADVANCE_CAPABILITY);
    error.code = 'TRANSITION_NOT_FOUND';
    throw error;
  }
  const candidates = actionId
    ? transition.actions.filter((item) => item.id === actionId)
    : transition.actions.filter((item) => item.capability === TML_QUEST_ADVANCE_CAPABILITY);
  if (candidates.length !== 1) {
    const error = capabilityError(TML_QUEST_ADVANCE_CAPABILITY);
    error.code = 'ACTION_NOT_RESOLVED';
    throw error;
  }
  const action = candidates[0];
  if (stable(action.args) !== stable(args)) {
    const error = capabilityError(TML_QUEST_ADVANCE_CAPABILITY);
    error.code = 'ACTION_ARGUMENT_MISMATCH';
    throw error;
  }
  return action;
}

export function createTmlVerifiedWriteCapabilityRegistry({
  module,
  profile,
  questReadAdapter,
  questAdvanceAdapter,
  now,
  createExecutionKey
} = {}) {
  if (!module || !profile) throw new TypeError('verified write registry requires module and profile');
  if (!questReadAdapter || typeof questReadAdapter.read !== 'function') {
    throw new TypeError('verified write registry requires questReadAdapter');
  }
  if (!questAdvanceAdapter || typeof questAdvanceAdapter.advance !== 'function') {
    throw new TypeError('verified write registry requires questAdvanceAdapter');
  }

  return Object.freeze({
    mode: 'VERIFIED_WRITE_P5',
    has(capability) {
      return capability === TML_QUEST_READ_CAPABILITY || capability === TML_QUEST_ADVANCE_CAPABILITY;
    },
    async invoke(capability, args = {}, context = {}) {
      if (capability === TML_QUEST_READ_CAPABILITY) {
        const questRef = args?.quest?.type === 'ref' ? args.quest.value : null;
        return questReadAdapter.read({ userId: context?.userId, questRef });
      }
      if (capability === TML_QUEST_ADVANCE_CAPABILITY) {
        const action = verifyBoundActionArgs(module, context?.transitionId, context?.actionId, args);
        return executeTmlVerifiedWriteTransition({
          module,
          profile,
          transitionId: context.transitionId,
          actionId: action.id,
          context,
          readAdapter: questReadAdapter,
          advanceAdapter: questAdvanceAdapter,
          traceId: context.traceId,
          now,
          createExecutionKey
        });
      }
      throw capabilityError(capability);
    }
  });
}
