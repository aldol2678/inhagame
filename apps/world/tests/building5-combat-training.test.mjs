import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING5_BLASTER_RAPID_ACTIONS,
  BUILDING5_TRAINING_TARGET,
  createBuilding5CombatTraining
} from '../src/combat/building5-combat-training.js';
import { FIVE, FIVE_SOUTH_ENTRY_APPROACH } from '../src/north-campus-layout.js';

function rig({ distance = 6 } = {}) {
  let now = 1000;
  let player = { x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + distance };
  const training = createBuilding5CombatTraining({
    clock: { now: () => now },
    getPlayerPosition: () => player
  });
  training.start();
  return {
    training,
    setNow: value => { now = value; },
    advance: ms => { now += ms; },
    setDistance: value => { player = { x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + value }; }
  };
}

test('Building 5 training target is outside the building and carries local HP/Break authority only', () => {
  assert.equal(BUILDING5_TRAINING_TARGET.maxHp, 4200);
  assert.equal(BUILDING5_TRAINING_TARGET.breakMax, 100);
  assert.equal(BUILDING5_TRAINING_TARGET.breakStunMs, 1550);
  const entryDistance = Math.hypot(
    FIVE_SOUTH_ENTRY_APPROACH.x - FIVE.center.x,
    FIVE_SOUTH_ENTRY_APPROACH.z - FIVE.center.z
  );
  const targetDistance = Math.hypot(
    BUILDING5_TRAINING_TARGET.x - FIVE.center.x,
    BUILDING5_TRAINING_TARGET.z - FIVE.center.z
  );
  assert.ok(targetDistance > entryDistance, 'training target extends outward from the walkable south entry');
});

test('v9.22 Blaster Rapid basic applies 88 damage, Break 4 and Overcharge +8', () => {
  const { training } = rig();
  const result = training.resolveAction({ action: 'basic', identity: 'basic' });
  assert.equal(result.accepted, true);
  assert.equal(result.damage, 88);
  assert.equal(result.breakApplied, 4);
  assert.equal(training.snapshot().hp, 4112);
  assert.equal(training.snapshot().breakValue, 4);
  assert.equal(training.snapshot().momentum, 8);
});

test('Accelerate is a 6s utility skill: +15 Overcharge and 4.2s rapid buff without fake damage', () => {
  const { training, advance } = rig();
  const result = training.resolveAction({ action: 'active_1', identity: 'accelerate' });
  assert.equal(result.accepted, true);
  assert.equal(result.damage, 0);
  assert.equal(training.snapshot().momentum, 15);
  assert.equal(training.snapshot().rapidBuffRemainingMs, 4200);
  assert.equal(training.resolveAction({ action: 'active_1', identity: 'accelerate' }).reason, 'COOLDOWN');
  advance(6000);
  assert.equal(training.resolveAction({ action: 'active_1', identity: 'accelerate' }).accepted, true);
});

test('Slide Shot resolves 3 x 72 damage packets and 3 x Break 4 / Overcharge 5', () => {
  const { training } = rig();
  const result = training.resolveAction({ action: 'active_2', identity: 'slide' });
  assert.deepEqual(result.damagePackets, [72, 72, 72]);
  assert.equal(result.damage, 216);
  assert.equal(result.breakApplied, 12);
  assert.equal(training.snapshot().momentum, 15);
});

test('Barrage requires 50 Overcharge then resolves 7 x 78 and can trigger Break mid-volley', () => {
  const { training, advance } = rig();
  assert.equal(training.resolveAction({ action: 'active_3', identity: 'barrage' }).reason, 'RESOURCE_REQUIRED');
  for (let i = 0; i < 5; i += 1) training.resolveAction({ action: 'basic', identity: 'basic' });
  training.resolveAction({ action: 'active_1', identity: 'accelerate' });
  assert.equal(training.snapshot().momentum, 55);
  const result = training.resolveAction({ action: 'active_3', identity: 'barrage' });
  assert.equal(result.damage, 546);
  assert.equal(result.breakApplied, 42);
  assert.equal(training.snapshot().momentum, 5);
  advance(BUILDING5_BLASTER_RAPID_ACTIONS.barrage.cooldownMs);
  assert.equal(training.resolveAction({ action: 'active_3', identity: 'barrage' }).reason, 'RESOURCE_REQUIRED');
});

test('Break resets to zero at threshold and exposes the v9.22 1.55s stun window', () => {
  const { training } = rig();
  for (let i = 0; i < 22; i += 1) training.resolveAction({ action: 'basic', identity: 'basic' });
  assert.equal(training.snapshot().breakValue, 88);
  training.resolveAction({ action: 'active_2', identity: 'slide' });
  assert.equal(training.snapshot().breakSerial, 1);
  assert.equal(training.snapshot().breakValue, 0);
  assert.equal(training.snapshot().broken, true);
  assert.equal(training.snapshot().brokenRemainingMs, 1550);
});

test('out-of-range projectiles consume the action but never invent damage or resource gain', () => {
  const { training, setDistance } = rig();
  setDistance(30);
  const result = training.resolveAction({ action: 'active_2', identity: 'slide' });
  assert.equal(result.accepted, true);
  assert.equal(result.hit, false);
  assert.equal(result.damage, 0);
  assert.equal(training.snapshot().momentum, 0);
});

test('Overdrive is a buff ultimate: set Overcharge 100 and 8s rapid state, no direct damage', () => {
  const { training } = rig();
  const before = training.snapshot().hp;
  const result = training.resolveAction({ action: 'ultimate', identity: 'overdrive' });
  assert.equal(result.accepted, true);
  assert.equal(result.damage, 0);
  assert.equal(training.snapshot().momentum, 100);
  assert.equal(training.snapshot().overdriveRemainingMs, 8000);
  assert.equal(training.snapshot().hp, before);
});
