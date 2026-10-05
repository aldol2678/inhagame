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

test('expression POC stays isolated to the main NPC and accepts only validated Jev presentation results', async () => {
  const source = await readFile(runtimeUrl, 'utf8');
  assert.match(source, /const expressionPilotId = MAIN_NPC_ID/);
  assert.match(source, /createNpcExpressionController\(expressionPilotFace\)/);
  assert.match(source, /function applyJevExpression\(actorId, decision\)/);
  assert.match(source, /decision\?\.provider !== 'JEV'/);
  assert.match(source, /setExpressionPoc\(expression\.emotion, expression\.intensity, \{ source: 'JEV' \}\)/);
  assert.match(source, /expression_poc: expressionPilot \? \{ npc_id: expressionPilotId, source: expressionSource/);
  assert.match(source, /setExpression: \(emotion, intensity = 1, options = \{\}\) => setExpressionPoc/);
  assert.doesNotMatch(source, /TYPESAFE.*expression|expression.*TYPESAFE/i,
    'runtime consumes the validated router result and must not call TypeSafe directly');
});
