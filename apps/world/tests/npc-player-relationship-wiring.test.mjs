import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('campus runtime emits relationship events only at conversation open and topic selection', () => {
  const runtime = read('../npc-factory/dev-runtime.mjs');
  assert.match(runtime, /createNpcPlayerRelationshipClient/);
  assert.match(runtime, /recordConversationOpen\(actor\.id\)/);
  assert.match(runtime, /NPC_DIALOGUE_STATE\.TOPIC_RESPONSE[\s\S]*recordMeaningfulDialogue\(actor\.id\)/);
  assert.match(runtime, /setRelationshipEnabled: enabled => playerRelationship\.setEnabled\(enabled\)/);
  assert.match(runtime, /player_relationship: playerRelationship\.status\(\)/);
});

test('production bootstrap feature-probes relationship source without blocking NPC runtime', () => {
  const main = read('../src/main.js');
  assert.match(main, /probeFeatureFlag\('\/api\/npc-relationship'\)/);
  assert.match(main, /relationshipEnabled: npcRelationshipEnabled/);
  assert.match(main, /relationshipEndpoint: '\/api\/npc-relationship'/);
  assert.match(main, /retryFeatureFlag\('\/api\/npc-relationship'/);
});

test('Cloud Run keeps service-role relationship mutation behind a dedicated path', () => {
  const run = read('../npc-factory/npc-ai-cloud-run.mjs');
  assert.match(run, /createSupabaseNpcRelationshipStore/);
  assert.match(run, /path === '\/relationship'/);
  assert.doesNotMatch(read('../npc-factory/npc-player-relationship-client.mjs'), /service[_-]?role/i);
});
