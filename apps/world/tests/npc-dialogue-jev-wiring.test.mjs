import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/npc-dialogue-route.js', import.meta.url), 'utf8');

test('World probes Jev independently and passes it into NPC runtime', () => {
  assert.match(main, /probeFeatureFlag\('\/api\/npc-dialogue-route'\)/);
  assert.match(main, /npcJevEnabled = jevResult === FLAG_ENABLED/);
  assert.match(main, /jevEnabled: npcJevEnabled/);
  assert.match(main, /jevEndpoint: '\/api\/npc-dialogue-route'/);
});

test('Jev routing is shadow-only and deterministic baseline remains immediate authority', () => {
  assert.match(runtime, /createNpcJevDialogueRouter/);
  assert.match(runtime, /activeConversation\.dialogueDecision = \{[\s\S]*provider: 'DETERMINISTIC_BASELINE'/);
  assert.match(runtime, /void dialogueRouter\.route\(\{ context, candidates, baseline \}\)\.then/);
  assert.match(runtime, /dialogue_decision: activeConversation\?\.dialogueDecision/);
  assert.match(runtime, /dialogue_jev: dialogueRouter\.status\(\)/);
  assert.doesNotMatch(runtime, /dialogueDecision[^\n]*(line\.textContent|quest\.advanceNpc|applyPilotAction)/);
});

test('server route is opt-in and keeps TypeSafe secret server-side', () => {
  assert.match(api, /NPC_JEV_ENABLED === '1'/);
  assert.match(api, /process\.env\.TYPESAFE_API_KEY/);
  assert.match(api, /verifyNpcAiUser/);
  assert.match(api, /EXPERIMENT_ONLY/);
  assert.match(api, /authorityEffect: 'NONE'/);
  assert.doesNotMatch(main, /TYPESAFE_API_KEY/);
  assert.doesNotMatch(runtime, /TYPESAFE_API_KEY/);
});
