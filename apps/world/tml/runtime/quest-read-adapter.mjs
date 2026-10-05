const QUEST_REF_PREFIX = 'quest.';

export const TML_QUEST_READ_CAPABILITY = 'world.quest.read';
export const TML_QUEST_SOURCE = 'server.quest';

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlQuestReadError';
  error.code = code;
  throw error;
}

export function questIdFromTmlRef(questRef) {
  if (typeof questRef !== 'string' || !questRef.startsWith(QUEST_REF_PREFIX)) {
    fail('INVALID_QUEST_REF', "quest ref must use the 'quest.<id>' form");
  }
  const questId = questRef.slice(QUEST_REF_PREFIX.length);
  if (!questId) fail('INVALID_QUEST_REF', 'quest ref must contain a quest id');
  return questId;
}

function fact({ userId, questRef, predicate, value, observedAt, sequence }) {
  return Object.freeze({
    kind: 'fact',
    id: createTmlRecordId('fact', [TML_QUEST_SOURCE, userId, questRef, predicate, observedAt, sequence]),
    subject: questRef,
    predicate,
    value,
    source: TML_QUEST_SOURCE,
    observed_at: observedAt,
    confidence: 1,
    extensions: Object.freeze({ observation_sequence: sequence })
  });
}

function observation({ userId, questRef, predicate, factId, observedAt, sequence }) {
  return Object.freeze({
    kind: 'observation',
    id: createTmlRecordId('observation', [TML_QUEST_SOURCE, userId, questRef, predicate, observedAt, sequence]),
    source: TML_QUEST_SOURCE,
    observed_at: observedAt,
    query: Object.freeze({ subject: questRef, predicate }),
    facts: Object.freeze([factId]),
    extensions: Object.freeze({ observation_sequence: sequence })
  });
}

function validateObservedAt(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_OBSERVED_AT', 'now() must return an ISO-compatible timestamp');
  }
  return value;
}

function normalizeQuestStatus(result, questId) {
  if (!result || typeof result !== 'object' || result.quest_id !== questId ||
      !Number.isInteger(result.stage) || result.stage < 0) {
    fail('QUEST_READ_INVALID_RESPONSE', 'quest status response is malformed');
  }
  if ('available' in result && typeof result.available !== 'boolean') {
    fail('QUEST_READ_INVALID_RESPONSE', 'quest availability must be boolean when present');
  }
  return result;
}

export function createTmlQuestReadAdapter({ questStore, now = () => new Date().toISOString() } = {}) {
  if (typeof questStore !== 'function') {
    throw new TypeError('createTmlQuestReadAdapter requires questStore(userId, event, questId)');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  let observationSequence = 0;

  return Object.freeze({
    capability: TML_QUEST_READ_CAPABILITY,
    source: TML_QUEST_SOURCE,

    async read({ userId, questRef } = {}) {
      if (typeof userId !== 'string' || userId.length === 0) {
        fail('USER_ID_REQUIRED', 'world.quest.read requires a non-empty userId');
      }

      const questId = questIdFromTmlRef(questRef);
      const result = normalizeQuestStatus(await questStore(userId, 'status', questId), questId);
      const observedAt = validateObservedAt(now());
      const sequence = ++observationSequence;

      const facts = [
        fact({
          userId,
          questRef,
          predicate: 'quest.stage',
          value: Object.freeze({ type: 'number', value: result.stage }),
          observedAt,
          sequence
        })
      ];

      if (typeof result.available === 'boolean') {
        facts.push(fact({
          userId,
          questRef,
          predicate: 'quest.available',
          value: Object.freeze({ type: 'boolean', value: result.available }),
          observedAt,
          sequence
        }));
      }

      const observations = facts.map((item) => observation({
        userId,
        questRef,
        predicate: item.predicate,
        factId: item.id,
        observedAt,
        sequence
      }));

      return Object.freeze({
        capability: TML_QUEST_READ_CAPABILITY,
        source: TML_QUEST_SOURCE,
        questRef,
        observedAt,
        sequence,
        facts: Object.freeze(facts),
        observations: Object.freeze(observations)
      });
    }
  });
}
import { createTmlRecordId } from './trace.mjs';
