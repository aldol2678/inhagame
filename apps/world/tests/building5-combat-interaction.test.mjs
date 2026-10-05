import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatRuntimeV03 } from '../src/combat/combat-runtime-v03.js';
import {
  BUILDING5_COMBAT_ENTRY,
  BUILDING5_COMBAT_EXIT_PRIORITY,
  createBuilding5CombatInteraction
} from '../src/combat/building5-combat-interaction.js';

test('Building 5 publishes Combat training only at the walkable south entry', () => {
  const runtime = createCombatRuntimeV03();
  const interaction = createBuilding5CombatInteraction({ runtime });
  const position = { x: BUILDING5_COMBAT_ENTRY.x, z: BUILDING5_COMBAT_ENTRY.z };
  assert.equal(interaction.observe(position, { placeZoneId: 'AREA_MAIN_HALL', grounded: true, blocked: false }), null);
  assert.equal(interaction.observe(position, { placeZoneId: 'AREA_BUILDING_5_WEST', grounded: false, blocked: false }), null);
  const action = interaction.observe(position, { placeZoneId: 'AREA_BUILDING_5_WEST', grounded: true, blocked: false });
  assert.equal(action.id, 'building5-combat-training');
  assert.equal(action.trigger(), true);
  assert.equal(runtime.active, true);
});

test('active Building 5 Combat always exposes the explicit local-training exit action', () => {
  const runtime = createCombatRuntimeV03();
  const interaction = createBuilding5CombatInteraction({ runtime });
  runtime.startTraining({ sourceRef: BUILDING5_COMBAT_ENTRY.id, placeZoneId: BUILDING5_COMBAT_ENTRY.placeZoneId });
  const action = interaction.observe({ x: 999, z: 999 }, { placeZoneId: null, grounded: false, blocked: true });
  assert.equal(action.id, 'building5-combat-exit');
  assert.equal(action.priority, BUILDING5_COMBAT_EXIT_PRIORITY);
  assert.equal(action.trigger(), true);
  assert.equal(runtime.active, false);
});
