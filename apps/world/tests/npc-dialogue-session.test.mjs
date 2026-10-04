import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_DIALOGUE_ACTION,
  NPC_DIALOGUE_STATE,
  createNpcDialogueSession,
  hasNpcDialogueMemory,
  npcDialogueHomeActions,
  npcTopicLabel
} from '../npc-factory/npc-dialogue-session.mjs';

test('dialogue session follows the P1 hierarchy and rejects cross-branch jumps', () => {
  const session = createNpcDialogueSession({ npcId: 'INKYUNG-NPC-021' });
  assert.deepEqual(session.snapshot(), {
    npcId: 'INKYUNG-NPC-021', state: NPC_DIALOGUE_STATE.HOME, topic: null, revision: 0
  });
  session.go(NPC_DIALOGUE_STATE.TOPICS);
  session.go(NPC_DIALOGUE_STATE.TOPIC_RESPONSE, { selectedTopic: 'music' });
  assert.equal(session.snapshot().topic, 'music');
  assert.throws(() => session.go(NPC_DIALOGUE_STATE.MEMORY), /Invalid NPC dialogue transition/);
  session.go(NPC_DIALOGUE_STATE.TOPICS);
  assert.equal(session.snapshot().topic, null);
  session.home();
  assert.equal(session.snapshot().state, NPC_DIALOGUE_STATE.HOME);
  assert.equal(session.snapshot().topic, null);
});

test('home actions stay bounded to five and expose memory only when useful', () => {
  assert.deepEqual(npcDialogueHomeActions(), [
    NPC_DIALOGUE_ACTION.STATUS, NPC_DIALOGUE_ACTION.TOPICS, NPC_DIALOGUE_ACTION.CLOSE
  ]);
  const full = npcDialogueHomeActions({ hasPriority: true, hasMemory: true });
  assert.equal(full.length, 5);
  assert.deepEqual(full, [
    NPC_DIALOGUE_ACTION.QUEST,
    NPC_DIALOGUE_ACTION.STATUS,
    NPC_DIALOGUE_ACTION.TOPICS,
    NPC_DIALOGUE_ACTION.MEMORY,
    NPC_DIALOGUE_ACTION.CLOSE
  ]);
  assert.equal(hasNpcDialogueMemory({ encounters: 0, topic: null }), false);
  assert.equal(hasNpcDialogueMemory({ encounters: 1, topic: null }), true);
  assert.equal(hasNpcDialogueMemory({ encounters: 0, topic: 'music' }), true);
});

test('all current 48-NPC interest vocabulary has player-facing labels', () => {
  for (const topic of ['architecture','birdwatching','coding','coffee','cooking','cycling','design',
    'film','languages','music','photography','plants','reading','sketching','walking']) {
    assert.ok(npcTopicLabel(topic));
    assert.doesNotMatch(npcTopicLabel(topic), /undefined/);
  }
  assert.equal(npcTopicLabel('languages'), '언어');
  assert.equal(npcTopicLabel('coffee'), '커피');
});
