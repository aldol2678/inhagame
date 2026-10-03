import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalQuestStore } from '../npc-factory/quest-store.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import { createTmlReadOnlyCapabilityRegistry } from '../tml/runtime/capability-registry.mjs';
import {
  createTmlQuestReadAdapter,
  questIdFromTmlRef,
  TML_QUEST_READ_CAPABILITY,
  TML_QUEST_SOURCE
} from '../tml/runtime/quest-read-adapter.mjs';

const QUEST_REF = `quest.${MAIN2_QUEST_ID}`;
const USER_ID = 'tml-p3-user';
const NOW = '2026-10-03T10:20:00+09:00';

test('P3 quest read adapter uses only the existing status read boundary', async () => {
  const calls = [];
  const questStore = async (userId, event, questId) => {
    calls.push({ userId, event, questId });
    assert.equal(event, 'status');
    return { quest_id: questId, stage: 4, available: true };
  };

  const adapter = createTmlQuestReadAdapter({ questStore, now: () => NOW });
  const result = await adapter.read({ userId: USER_ID, questRef: QUEST_REF });

  assert.deepEqual(calls, [{ userId: USER_ID, event: 'status', questId: MAIN2_QUEST_ID }]);
  assert.equal(result.capability, TML_QUEST_READ_CAPABILITY);
  assert.equal(result.source, TML_QUEST_SOURCE);
  assert.equal(result.questRef, QUEST_REF);
  assert.equal(result.observedAt, NOW);
  assert.deepEqual(
    result.facts.map(({ predicate, value, source, observed_at }) => ({ predicate, value, source, observed_at })),
    [
      { predicate: 'quest.stage', value: { type: 'number', value: 4 }, source: TML_QUEST_SOURCE, observed_at: NOW },
      { predicate: 'quest.available', value: { type: 'boolean', value: true }, source: TML_QUEST_SOURCE, observed_at: NOW }
    ]
  );
  assert.deepEqual(result.observations.map((item) => item.query.predicate), ['quest.stage', 'quest.available']);
  assert.ok(result.observations.every((item) => item.source === TML_QUEST_SOURCE));
});

test('P3 adapter reads the real local quest store without advancing Main 2', async () => {
  const store = createLocalQuestStore();
  const adapter = createTmlQuestReadAdapter({ questStore: store, now: () => NOW });

  const first = await adapter.read({ userId: USER_ID, questRef: QUEST_REF });
  const second = await adapter.read({ userId: USER_ID, questRef: QUEST_REF });

  const stage = (result) => result.facts.find((item) => item.predicate === 'quest.stage')?.value.value;
  const available = (result) => result.facts.find((item) => item.predicate === 'quest.available')?.value.value;

  assert.equal(stage(first), 0);
  assert.equal(stage(second), 0);
  assert.equal(available(first), false);
  assert.equal(available(second), false);
});

test('P3 adapter fails closed on invalid refs, users, timestamps and provider responses', async () => {
  assert.throws(() => questIdFromTmlRef('campus_navigation_intro_v1'), (error) => error.code === 'INVALID_QUEST_REF');
  assert.throws(() => questIdFromTmlRef('quest.'), (error) => error.code === 'INVALID_QUEST_REF');

  const validStore = async (_userId, _event, questId) => ({ quest_id: questId, stage: 0, available: false });
  const adapter = createTmlQuestReadAdapter({ questStore: validStore, now: () => NOW });

  await assert.rejects(
    () => adapter.read({ userId: '', questRef: QUEST_REF }),
    (error) => error.code === 'USER_ID_REQUIRED'
  );

  const malformed = createTmlQuestReadAdapter({
    questStore: async () => ({ quest_id: MAIN2_QUEST_ID, stage: '4', available: true }),
    now: () => NOW
  });
  await assert.rejects(
    () => malformed.read({ userId: USER_ID, questRef: QUEST_REF }),
    (error) => error.code === 'QUEST_READ_INVALID_RESPONSE'
  );

  const badTime = createTmlQuestReadAdapter({ questStore: validStore, now: () => 'not-a-time' });
  await assert.rejects(
    () => badTime.read({ userId: USER_ID, questRef: QUEST_REF }),
    (error) => error.code === 'INVALID_OBSERVED_AT'
  );
});

test('P3 capability registry binds world.quest.read and refuses mutating capability execution', async () => {
  const adapter = createTmlQuestReadAdapter({
    questStore: async (_userId, event, questId) => {
      assert.equal(event, 'status');
      return { quest_id: questId, stage: 2, available: true };
    },
    now: () => NOW
  });
  const registry = createTmlReadOnlyCapabilityRegistry({ questReadAdapter: adapter });

  assert.equal(registry.mode, 'READ_ONLY_P3');
  assert.equal(registry.has('world.quest.read'), true);
  assert.equal(registry.has('world.quest.advance'), false);

  const result = await registry.invoke(
    'world.quest.read',
    { quest: { type: 'ref', value: QUEST_REF } },
    { userId: USER_ID }
  );
  assert.equal(result.facts.find((item) => item.predicate === 'quest.stage').value.value, 2);

  await assert.rejects(
    () => registry.invoke(
      'world.quest.advance',
      { quest: { type: 'ref', value: QUEST_REF }, event: { type: 'string', value: 'start' } },
      { userId: USER_ID }
    ),
    (error) => error.code === 'CAPABILITY_NOT_BOUND' && error.capability === 'world.quest.advance'
  );
});
