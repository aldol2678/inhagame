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
