import { questIdFromTmlRef } from './quest-read-adapter.mjs';
import { snapshotTmlData, summarizeTmlError } from './value-snapshot.mjs';
import { isTmlDateTime } from './conformance.mjs';

export const TML_QUEST_ADVANCE_CAPABILITY = 'world.quest.advance';

function validTime(value) {
  return isTmlDateTime(value) && Number.isFinite(Date.parse(value));
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
      const outcome = {
        ok: false,
        executionKey,
        requestedAt: null,
        completedAt: null,
        dispatchStatus: 'NOT_ATTEMPTED',
        providerReturned: false
      };
      let phase = 'clock';
      try {
        const requestedAt = now();
        if (!validTime(requestedAt)) throw new TypeError('now() must return an ISO-compatible timestamp');
        outcome.requestedAt = requestedAt;
        phase = 'provider';
        outcome.dispatchStatus = 'ATTEMPTED';
        const result = await questStore(userId, event, questId);
        outcome.providerReturned = true;
        phase = 'normalization';
        outcome.response = snapshotTmlData(result);
        outcome.output = normalizeResult(outcome.response, questId);
        outcome.ok = true;
      } catch (error) {
        outcome.error = summarizeTmlError(error);
        if (phase !== 'provider') outcome.processingError = outcome.error;
      }

      // A second clock failure must not replace the already crossed boundary
      // with a thrown exception. Missing time stays missing; it is not invented.
      if (outcome.dispatchStatus === 'ATTEMPTED') {
        try {
          const completedAt = now();
          if (!validTime(completedAt)) throw new TypeError('now() must return an ISO-compatible timestamp');
          outcome.completedAt = completedAt;
        } catch (error) {
          outcome.processingError = summarizeTmlError(error);
          outcome.error ??= outcome.processingError;
        }
      }
      return Object.freeze(outcome);
    }
  });
}
