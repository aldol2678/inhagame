import { questIdFromTmlRef } from './quest-read-adapter.mjs';

export const TML_QUEST_ADVANCE_CAPABILITY = 'world.quest.advance';

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function providerError(error) {
  const code = typeof error?.code === 'string' ? error.code
    : typeof error?.name === 'string' ? error.name
      : 'QUEST_WRITE_PROVIDER_ERROR';
  return Object.freeze({
    code,
    message: typeof error?.message === 'string' ? error.message : undefined
  });
}

function normalizeResult(result, questId) {
  if (!result || typeof result !== 'object' || result.quest_id !== questId ||
      !Number.isInteger(result.stage) || result.stage < 0) {
    const error = new Error('quest advance provider response is malformed');
    error.name = 'TmlQuestAdvanceError';
    error.code = 'QUEST_WRITE_INVALID_RESPONSE';
    throw error;
  }
  if ('available' in result && typeof result.available !== 'boolean') {
    const error = new Error('quest availability must be boolean when present');
    error.name = 'TmlQuestAdvanceError';
    error.code = 'QUEST_WRITE_INVALID_RESPONSE';
    throw error;
  }
  return result;
}

export function createTmlQuestAdvanceAdapter({ questStore, now = () => new Date().toISOString() } = {}) {
  if (typeof questStore !== 'function') {
    throw new TypeError('createTmlQuestAdvanceAdapter requires questStore(userId, event, questId)');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  return Object.freeze({
    capability: TML_QUEST_ADVANCE_CAPABILITY,

    async advance({ userId, questRef, event, executionKey } = {}) {
      if (typeof userId !== 'string' || userId.length === 0) {
        throw Object.assign(new Error('world.quest.advance requires a non-empty userId'), {
          name: 'TmlQuestAdvanceError',
          code: 'USER_ID_REQUIRED'
        });
      }
      if (typeof event !== 'string' || event.length === 0 || event === 'status') {
        throw Object.assign(new Error('world.quest.advance requires a mutating quest event'), {
          name: 'TmlQuestAdvanceError',
          code: 'INVALID_QUEST_EVENT'
        });
      }
      if (typeof executionKey !== 'string' || executionKey.length === 0) {
        throw Object.assign(new Error('world.quest.advance requires executionKey'), {
          name: 'TmlQuestAdvanceError',
          code: 'EXECUTION_KEY_REQUIRED'
        });
      }

      const questId = questIdFromTmlRef(questRef);
      const requestedAt = now();
      if (!validTime(requestedAt)) throw new TypeError('now() must return an ISO-compatible timestamp');

      try {
        const result = normalizeResult(await questStore(userId, event, questId), questId);
        const completedAt = now();
        if (!validTime(completedAt)) throw new TypeError('now() must return an ISO-compatible timestamp');
        return Object.freeze({
          ok: true,
          executionKey,
          requestedAt,
          completedAt,
          output: Object.freeze(result)
        });
      } catch (error) {
        const completedAt = now();
        if (!validTime(completedAt)) throw new TypeError('now() must return an ISO-compatible timestamp');
        return Object.freeze({
          ok: false,
          executionKey,
          requestedAt,
          completedAt,
          error: providerError(error)
        });
      }
    }
  });
}
