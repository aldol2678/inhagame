import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatRuntimeV03, COMBAT_V03_RUNTIME_PHASE } from '../src/combat/combat-runtime-v03.js';
import {
  BUILDING5_TRAINING_TARGET,
  createBuilding5CombatTraining
} from '../src/combat/building5-combat-training.js';

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


test('Combat v0.3 Runtime resolves Blaster actions into the injected local Building 5 target', () => {
  let now = 1000;
  const training = createBuilding5CombatTraining({
    clock: { now: () => now },
    getPlayerPosition: () => ({ x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + 6 })
  });
  const runtime = createCombatRuntimeV03({ clock: { now: () => now }, localTraining: training });
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });

  const basic = runtime.dispatch('basic');
  assert.equal(basic.outcome.damage, 88);
  assert.equal(runtime.snapshot().training.hp, 4112);
  assert.equal(runtime.snapshot().training.momentum, 8);

  const accelerate = runtime.dispatch('active_1');
  assert.equal(accelerate.identity, 'accelerate');
  assert.equal(runtime.snapshot().training.momentum, 23);

  const blocked = runtime.dispatch('active_3');
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'RESOURCE_REQUIRED');

  for (let i = 0; i < 4; i += 1) runtime.dispatch('basic');
  assert.ok(runtime.snapshot().training.momentum >= 50);
  const barrage = runtime.dispatch('active_3');
  assert.equal(barrage.outcome.damagePackets.length, 7);
  assert.equal(barrage.outcome.damage, 546);
  assert.equal(runtime.snapshot().training.momentum, 5);
});

test('Combat local target resets inside the same training session without granting persistence', () => {
  const training = createBuilding5CombatTraining({
    getPlayerPosition: () => ({ x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + 6 })
  });
  const runtime = createCombatRuntimeV03({ localTraining: training });
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  runtime.dispatch('basic');
  runtime.gainUltimate(44);
  const before = runtime.snapshot().ultimateGauge;
  assert.equal(runtime.resetTrainingTarget(), true);
  assert.equal(runtime.snapshot().training.hp, BUILDING5_TRAINING_TARGET.maxHp);
  assert.equal(runtime.snapshot().ultimateGauge, before);
  assert.equal('rewardId' in runtime.snapshot(), false);
  assert.equal('resultRef' in runtime.snapshot(), false);
});
