import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatRuntimeV03, COMBAT_V03_RUNTIME_PHASE } from '../src/combat/combat-runtime-v03.js';

test('Combat v0.3 Runtime starts Building-5 style local training with v9.22 default loadout', () => {
  let now = 1000;
  const runtime = createCombatRuntimeV03({ clock: { now: () => now } });
  assert.equal(runtime.snapshot().phase, COMBAT_V03_RUNTIME_PHASE.IDLE);
  assert.equal(runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' }), true);
  const state = runtime.snapshot();
  assert.equal(state.active, true);
  assert.equal(state.phase, COMBAT_V03_RUNTIME_PHASE.TRAINING);
  assert.equal(state.build.jobId, 'blaster');
  assert.deepEqual(state.build.activeSkills, ['accelerate', 'slide', 'barrage']);
  assert.equal(state.build.ultimate, 'overdrive');
  assert.equal(state.ultimateGauge, 0);
});

test('Combat v0.3 Runtime locks build edits during an encounter and accepts six action identities', () => {
  const runtime = createCombatRuntimeV03();
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  assert.throws(() => runtime.setJob('striker'), /locked during an encounter/);
  assert.equal(runtime.dispatch('basic').identity, 'basic');
  assert.equal(runtime.dispatch('active_1').identity, 'accelerate');
  assert.equal(runtime.dispatch('active_2').identity, 'slide');
  assert.equal(runtime.dispatch('active_3').identity, 'barrage');
  assert.equal(runtime.dispatch('dodge').identity, 'dodge');
  assert.equal(runtime.dispatch('ultimate').reason, 'ULTIMATE_NOT_READY');
  runtime.gainUltimate(100);
  assert.equal(runtime.dispatch('ultimate').identity, 'overdrive');
  assert.equal(runtime.snapshot().ultimateGauge, 0);
});

test('Combat v0.3 Runtime ports v9.22 resolved-event Ultimate gauge semantics without owning hit resolution', () => {
  const runtime = createCombatRuntimeV03();
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  runtime.recordResolvedCombat({
    damage: 260,
    weak: true,
    breakTriggered: true,
    perfectDodge: true,
    perfectGuard: true,
    kill: true,
    activeSkillSucceeded: true
  });
  assert.equal(runtime.snapshot().ultimateGauge, 33.2);
  runtime.recordResolvedCombat({ damage: 99999 });
  assert.equal(runtime.snapshot().ultimateGauge, 35);
});

test('Combat v0.3 Runtime exits without creating reward or persistent encounter authority', () => {
  const runtime = createCombatRuntimeV03();
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  runtime.gainUltimate(80);
  assert.equal(runtime.end('PLAYER_EXIT'), true);
  const state = runtime.snapshot();
  assert.equal(state.active, false);
  assert.equal(state.phase, COMBAT_V03_RUNTIME_PHASE.IDLE);
  assert.equal(state.sourceRef, null);
  assert.equal(state.ultimateGauge, 0);
  assert.equal(state.lastAction.reason, 'PLAYER_EXIT');
});
