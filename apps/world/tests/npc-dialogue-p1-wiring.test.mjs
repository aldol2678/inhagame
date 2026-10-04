import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { npcTopicLabel } from '../npc-factory/npc-dialogue-session.mjs';

const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const base = JSON.parse(readFileSync(new URL('../npc-factory/data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const expansion = JSON.parse(readFileSync(new URL('../npc-factory/data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));

test('production NPC dialogue is hierarchical instead of a flat debug menu', () => {
  assert.match(runtime, /createNpcDialogueSession\(\{ npcId: actor\.id \}\)/);
  assert.match(runtime, /NPC_DIALOGUE_STATE\.STATUS/);
  assert.match(runtime, /NPC_DIALOGUE_STATE\.TOPICS/);
  assert.match(runtime, /NPC_DIALOGUE_STATE\.MEMORY/);
  assert.match(runtime, /NPC_DIALOGUE_STATE\.QUEST/);
  assert.match(runtime, /근황 묻기/);
  assert.match(runtime, /관심사 이야기/);
  assert.match(runtime, /지난번 이야기/);
  assert.match(runtime, /대화 마치기/);
  assert.doesNotMatch(runtime, /textContent = '기억 확인'/);
});

test('provider implementation is not presented as an NPC identity in production', () => {
  assert.match(runtime, /speaker\.textContent = production\s*\? actor\.name/);
  assert.match(runtime, /label\.textContent = production \? actor\.name/);
  assert.match(runtime, /로그인하면 더 다양한 대화를 이어갈 수 있어요/);
});

test('current 48 NPC topics fit the bounded topic screen and all have labels', () => {
  for (const npc of [...base.npcs, ...expansion.npcs]) {
    assert.ok((npc.interests ?? []).length <= 3, `${npc.npc_id} exceeds the three-topic P1 screen`);
    for (const topic of npc.interests ?? []) {
      const label = npcTopicLabel(topic);
      assert.ok(label && label !== 'undefined', `${npc.npc_id}/${topic} has no player-facing label`);
    }
  }
});


test('shared schedule movement does not disable or instantly close nearby NPC dialogue', () => {
  const nearest = runtime.match(/function nearestVisible\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.ok(nearest, 'nearestVisible exists');
  assert.doesNotMatch(nearest, /\.moving/, 'moving NPCs remain valid proximity targets');
  assert.match(runtime, /if \(state && !state\.visible\) closeConversation\(false\);/);
  assert.doesNotMatch(runtime, /if \(state && \(!state\.visible \|\| state\.moving\)\) closeConversation\(false\);/);
  assert.match(runtime, /NPC_CONVERSATION_RELEASE_RADIUS/, 'distance still owns automatic conversation release');
});
