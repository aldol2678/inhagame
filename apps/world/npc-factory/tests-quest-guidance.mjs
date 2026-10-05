import assert from 'node:assert/strict';
import { formatQuestGuidance, questGuidance } from './quest-guidance.mjs';

assert.deepEqual(
  questGuidance({ x: 0, z: 5 }, { x: 0, z: 0 }, 0),
  { arrow: '↑', distanceMeters: 10 }
);
assert.deepEqual(
  questGuidance({ x: 5, z: 0 }, { x: 0, z: 0 }, 0),
  { arrow: '→', distanceMeters: 10 }
);
assert.equal(
  formatQuestGuidance({ x: -5, z: 5 }, { x: 0, z: 0 }, 0),
  '↖ 14m'
);
assert.equal(
  formatQuestGuidance({ x: 0, z: 5 }, { x: 0, z: 0 }, Math.PI),
  '↓ 10m'
);
assert.equal(formatQuestGuidance(null, { x: 0, z: 0 }, 0), '');
assert.equal(
  formatQuestGuidance({ x: 0, z: 1, kind: 'quest-npc' }, { x: 0, z: 0 }, 0, { interactionHint: true }),
  '↑ 2m · 상호작용으로 대화'
);
assert.equal(
  formatQuestGuidance({ x: 0, z: 3, kind: 'quest-npc' }, { x: 0, z: 0 }, 0, { interactionHint: true }),
  '↑ 6m'
);
assert.equal(
  formatQuestGuidance({ x: 0, z: 3, kind: 'destination' }, { x: 0, z: 0 }, 0, { interactionHint: true }),
  '↑ 6m'
);

console.log('World Main quest HUD bearing + distance + guided interaction hint: PASS');
