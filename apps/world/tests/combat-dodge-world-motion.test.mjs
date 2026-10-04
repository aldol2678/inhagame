import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING5_TRAINING_PLAYER,
  createBuilding5CombatTraining
} from '../src/combat/building5-combat-training.js';
import { createCombatRuntimeV03 } from '../src/combat/combat-runtime-v03.js';
import { createCombatWorldMotionV03 } from '../src/combat/combat-world-motion-v03.js';
import { PlayerController } from '../src/player-controller.js';

test('v9.22 dodge travel integrates to exactly 2.2m on its sine curve', () => {
  let now = 0;
  const training = createBuilding5CombatTraining({
    clock: { now: () => now },
    getPlayerPosition: () => ({ x: 0, z: 0 }),
    getDodgeDirection: () => ({ x: 1, z: 0 })
  });
  training.start();
  training.resolveAction({ action: 'dodge', identity: 'dodge' });

  let total = 0;
  for (const at of [0, 35, 70, 140, 210, 280]) {
    now = at;
    const step = training.consumeDodgeTravel();
    total += step.distance;
    assert.ok(step.x >= 0);
    assert.ok(Math.abs(step.z) < 1e-12);
  }
  assert.ok(Math.abs(total - BUILDING5_TRAINING_PLAYER.dodgeDistance) < 1e-9);
  assert.equal(training.snapshot().player.dodge.active, false);
});

test('Combat world motion routes every dodge delta through PlayerController authority', () => {
  let now = 0;
  const clock = { now: () => now };
  const training = createBuilding5CombatTraining({
    clock,
    getPlayerPosition: () => ({ x: 0, z: 0 }),
    getDodgeDirection: () => ({ x: 0, z: 1 })
  });
  const runtime = createCombatRuntimeV03({ clock, localTraining: training });
  const calls = [];
  const locks = new Map();
  const controller = {
    applyCombatGroundDisplacement(step) { calls.push({ ...step }); return { ...step, moved: true }; },
    setGroundMovementLock(id, locked) { locks.set(id, locked); return locked; }
  };
  const motion = createCombatWorldMotionV03({ runtime, training, controller });
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });
  runtime.dispatch('dodge');
  assert.equal(locks.get('combat-dodge'), true);

  for (const at of [35, 70, 140, 210, 280]) {
    now = at;
    motion.update();
  }
  const distance = calls.reduce((sum, step) => sum + Math.hypot(step.x, step.z), 0);
  assert.ok(Math.abs(distance - 2.2) < 1e-9);
  assert.equal(locks.get('combat-dodge'), false);
  assert.ok(Math.abs(motion.status().appliedDistance - 2.2) < 1e-9);
  motion.destroy();
});

async function controllerRig(position = { x: .9, y: 1.65, z: 0 }) {
  const listeners = {};
  globalThis.window = { addEventListener(type, fn) { (listeners[type] ??= []).push(fn); } };
  globalThis.document = { body: { dataset: {} }, getElementById: () => null };
  globalThis.HTMLElement = class { closest() { return null; } };
  const pos = { ...position };
  const entity = {
    mountKind: null,
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => Object.assign(pos, { x, y, z }),
    setLocalEulerAngles() {}
  };
  const controller = new PlayerController(entity);
  controller.setMovementSpace({
    id: 'combat-test',
    allowMount: false,
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    obstacles: [],
    groundHeight: () => .5,
    constrain: (_from, next) => next
  });
  return {
    controller, pos,
    cleanup() {
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
    }
  };
}

test('PlayerController clamps Combat displacement and keeps feet on the active movement-space ground', async () => {
  const r = await controllerRig();
  try {
    const moved = r.controller.applyCombatGroundDisplacement({ x: 2.2, z: 0 });
    assert.equal(r.pos.x, 1);
    assert.equal(r.pos.y, 1.65);
    assert.equal(r.pos.z, 0);
    assert.ok(Math.abs(moved.x - .1) < 1e-9);
    assert.equal(moved.moved, true);
  } finally { r.cleanup(); }
});

test('Combat dodge direction uses current ground input and normal ground input yields while locked', async () => {
  const r = await controllerRig({ x: 0, y: 1.65, z: 0 });
  try {
    r.controller.keys.add('KeyW');
    assert.deepEqual(r.controller.combatDodgeDirection(0, { targetX: 1, targetZ: 0 }), { x: 0, z: 1 });
    r.controller.setGroundMovementLock('combat-dodge', true);
    r.controller.update(.1, 0);
    assert.equal(r.pos.z, 0, 'normal ground locomotion does not double-move during dodge');
    r.controller.setGroundMovementLock('combat-dodge', false);
    r.controller.update(.1, 0);
    assert.ok(r.pos.z > 0);
  } finally { r.cleanup(); }
});
