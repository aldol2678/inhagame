import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const avatarUrl = new URL('../npc-factory/dev-human-avatar.mjs', import.meta.url);
const runtimeUrl = new URL('../npc-factory/dev-runtime.mjs', import.meta.url);

test('procedural avatar exposes stable face-part handles for expression animation', async () => {
  const source = await readFile(avatarUrl, 'utf8');
  assert.match(source, /const eyes = \[\], brows = \[\]/);
  assert.match(source, /const mouthNode = part\(avatar, 'Mouth'/);
  assert.match(source, /face: Object\.freeze\(\{ head, eyes: Object\.freeze\(eyes\), brows: Object\.freeze\(brows\), mouth: mouthNode \}\)/);
});

test('expression POC is isolated to the main NPC and stays locally deterministic', async () => {
  const source = await readFile(runtimeUrl, 'utf8');
  assert.match(source, /const expressionPilotId = MAIN_NPC_ID/);
  assert.match(source, /createNpcExpressionController\(expressionPilotFace\)/);
  assert.match(source, /NPC_EXPRESSION_NAMES/);
  assert.match(source, /expressionPilot\?\.update\(dt\)/);
  assert.match(source, /setExpression: \(emotion, intensity = 1, options = \{\}\) => setExpressionPoc/);
  assert.doesNotMatch(source, /TYPESAFE.*expression|expression.*TYPESAFE/i,
    'POC must not require an AI provider before the face animation is proven');
});
