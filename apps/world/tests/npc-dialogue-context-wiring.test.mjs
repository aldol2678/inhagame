import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('D2 runtime rebuilds a sanitized dialogue context and deterministic baseline', () => {
  assert.match(runtime, /buildNpcDialogueContext/);
  assert.match(runtime, /buildNpcDialogueCandidates/);
  assert.match(runtime, /resolveNpcDialogueBaseline/);
  assert.match(runtime, /function captureDialogueContract\(actor/);
  assert.match(runtime, /memoryRecord: memory\.read\(actor\.id\)/);
  assert.match(runtime, /socialProfile: socialNg1\?\.profile\(actor\.id\) \?\? null/);
  assert.match(runtime, /questState: quest\.status\(\)/);
  assert.match(runtime, /generationAllowed: aiEnabled\(actor\.id\)/);
  assert.match(runtime, /activeConversation\.dialogueContext = context/);
  assert.match(runtime, /activeConversation\.dialogueCandidates = candidates/);
  assert.match(runtime, /activeConversation\.dialogueBaseline = baseline/);
});

test('World supplies only dialogue-safe environment facts', () => {
  const block = main.match(/getDialogueWorldContext:\s*\(\) => \{\s*const env = environment\.status\(\);\s*return \{[\s\S]*?\n\s*\};\s*\n\s*\},/)?.[0];
  assert.ok(block, 'world dialogue context callback is wired beside NPC runtime');
  assert.match(block, /weather: env\.targetWeather/);
  assert.match(block, /environmentTime: env\.targetTime/);
  assert.match(block, /placeZoneId: online\?\.network\?\.placeZoneId \?\? null/);
  assert.doesNotMatch(block, /userId|email|displayName|wallet|inventory|reward/i);
});

test('D2 is observational and does not replace existing quest or AI authorities', () => {
  assert.match(runtime, /const baseline = resolveNpcDialogueBaseline\(context\)/);
  assert.doesNotMatch(runtime, /dialogueBaseline[^\n]*\.trigger|dialogueBaseline[^\n]*\.execute/);
  assert.match(runtime, /requestPilot\(actor\.id, topic\)/);
  assert.match(runtime, /quest\.advanceNpc\(actorId\)/);
});
