import test from 'node:test';
import assert from 'node:assert/strict';
import { NPC_DIALOGUE_STATE } from '../npc-factory/npc-dialogue-session.mjs';
import {
  NPC_DIALOGUE_CONTEXT_PRIORITY,
  NPC_DIALOGUE_INTENT,
  NPC_DIALOGUE_RESPONSE_SOURCE,
  buildNpcDialogueCandidates,
  buildNpcDialogueContext,
  resolveNpcDialogueBaseline,
  validateNpcDialogueDecision
} from '../npc-factory/npc-dialogue-context.mjs';

const npc = {
  npc_id: 'INKYUNG-NPC-021',
  archetype: 'student',
  identity: { name: '도하준', year_level: '2' },
  interests: ['reading', 'music', 'coffee'],
  personality: { traits: ['curious', 'calm'] },
  email: 'must-not-leak@example.com'
};
const actor = {
  id: 'INKYUNG-NPC-021',
  name: '도하준',
  location: 'life_student_center',
  activity: 'RESTING',
  social_mode: 'medium',
  moving: false
};

function context(overrides = {}) {
  return buildNpcDialogueContext({
    npc,
    actor,
    rosterEntry: { department: '국어국문학과', residence: 'commuter', student_number: '20269999' },
    session: { state: NPC_DIALOGUE_STATE.STATUS, topic: null, revision: 2 },
    memoryRecord: { encounters: 3, lastPeriod: 'lunch', topic: 'music' },
    socialProfile: {
      group: { groupId: 'g1', label: '생활 모임', status: 'ACTIVE', role: '회원', members: ['a','b','c'] },
      closeTies: [{ npcId: 'INKYUNG-NPC-022', name: '친구', affinity: 28, encounterCount: 3, persistentBond: 2 }]
    },
    questState: { enabled: true, signedIn: true, available: true, complete: false, stage: 2, objective: '본관 찾아가기',
      reward: { coin: 999999 } },
    priority: { quest: true, sideEvent: false },
    world: { weather: 'RAIN', environmentTime: 'EVENING', placeZoneId: 'AREA_INKYUNG_STUDENT_CENTER',
      eventId: 'event.mcm_2026', eventPhase: 'ACTIVE', accountEmail: 'nope@example.com' },
    generationAllowed: true,
    ...overrides
  });
}

test('context builder copies only dialogue-safe facts and derives familiarity', () => {
  const c = context();
  assert.equal(c.schemaVersion, 'dialogue-context-p1');
  assert.equal(c.identity.name, '도하준');
  assert.equal(c.identity.department, '국어국문학과');
  assert.deepEqual(c.identity.interests, ['reading', 'music', 'coffee']);
  assert.equal(c.memory.familiarity, 'REPEATED');
  assert.equal(c.memory.lastTopic, 'music');
  assert.equal(c.world.weather, 'RAIN');
  assert.equal(c.world.placeZoneId, 'AREA_INKYUNG_STUDENT_CENTER');
  assert.equal(c.quest.stage, 2);
  const serialized = JSON.stringify(c);
  assert.doesNotMatch(serialized, /must-not-leak|20269999|reward|999999|accountEmail|nope@example/);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.identity) && Object.isFrozen(c.memory));
});

test('candidate contract is closed and exposes only facts justified by context', () => {
  const candidates = buildNpcDialogueCandidates(context());
  assert.deepEqual(candidates.intents, [NPC_DIALOGUE_INTENT.STATUS, NPC_DIALOGUE_INTENT.SOCIAL]);
  for (const source of [
    NPC_DIALOGUE_RESPONSE_SOURCE.AUTHORED,
    NPC_DIALOGUE_RESPONSE_SOURCE.CONTEXTUAL,
    NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY,
    NPC_DIALOGUE_RESPONSE_SOURCE.QUEST,
    NPC_DIALOGUE_RESPONSE_SOURCE.GENERATIVE
  ]) assert.ok(candidates.responseSources.includes(source));
  for (const priority of [
    NPC_DIALOGUE_CONTEXT_PRIORITY.CURRENT_ACTIVITY,
    NPC_DIALOGUE_CONTEXT_PRIORITY.LAST_TOPIC,
    NPC_DIALOGUE_CONTEXT_PRIORITY.PLAYER_MEMORY,
    NPC_DIALOGUE_CONTEXT_PRIORITY.RELATIONSHIP,
    NPC_DIALOGUE_CONTEXT_PRIORITY.WEATHER,
    NPC_DIALOGUE_CONTEXT_PRIORITY.EVENT,
    NPC_DIALOGUE_CONTEXT_PRIORITY.QUEST
  ]) assert.ok(candidates.contextPriorities.includes(priority));
});

test('baseline resolver is deterministic and never chooses generative merely because it is available', () => {
  const status = resolveNpcDialogueBaseline(context());
  assert.equal(status.responseSource, NPC_DIALOGUE_RESPONSE_SOURCE.CONTEXTUAL);
  assert.equal(status.intent, NPC_DIALOGUE_INTENT.STATUS);
  assert.equal(status.provider, 'DETERMINISTIC_BASELINE');

  const memory = resolveNpcDialogueBaseline(context({
    session: { state: NPC_DIALOGUE_STATE.MEMORY, topic: null, revision: 3 }
  }));
  assert.equal(memory.responseSource, NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY);
  assert.equal(memory.intent, NPC_DIALOGUE_INTENT.MEMORY_RECALL);

  const quest = resolveNpcDialogueBaseline(context({
    session: { state: NPC_DIALOGUE_STATE.QUEST, topic: null, revision: 4 }
  }));
  assert.equal(quest.responseSource, NPC_DIALOGUE_RESPONSE_SOURCE.QUEST);
  assert.equal(quest.intent, NPC_DIALOGUE_INTENT.QUEST_HINT);
});

test('future provider decisions are admitted only inside supplied closed choices', () => {
  const candidates = buildNpcDialogueCandidates(context());
  assert.equal(validateNpcDialogueDecision({
    responseSource: 'GENERATIVE', intent: 'STATUS', contextPriority: 'WEATHER'
  }, candidates), true);
  assert.equal(validateNpcDialogueDecision({
    responseSource: 'MAGIC', intent: 'STATUS', contextPriority: 'WEATHER'
  }, candidates), false);
  assert.equal(validateNpcDialogueDecision({
    responseSource: 'GENERATIVE', intent: 'TELEPORT', contextPriority: 'WEATHER'
  }, candidates), false);
  assert.equal(validateNpcDialogueDecision({
    responseSource: 'GENERATIVE', intent: 'STATUS', contextPriority: 'PRIVATE_EMAIL'
  }, candidates), false);
});

test('generation and memory candidates disappear when unavailable', () => {
  const c = context({
    memoryRecord: { encounters: 0, lastPeriod: null, topic: null },
    priority: { quest: false, sideEvent: false },
    questState: { enabled: false },
    world: {},
    generationAllowed: false
  });
  const candidates = buildNpcDialogueCandidates(c);
  assert.equal(c.memory.familiarity, 'FIRST');
  assert.ok(!candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.MEMORY));
  assert.ok(!candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.QUEST));
  assert.ok(!candidates.responseSources.includes(NPC_DIALOGUE_RESPONSE_SOURCE.GENERATIVE));
});
