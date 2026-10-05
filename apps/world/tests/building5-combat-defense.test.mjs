import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING5_TRAINING_ATTACK,
  BUILDING5_TRAINING_PLAYER,
  BUILDING5_TRAINING_TARGET,
  createBuilding5CombatTraining
} from '../src/combat/building5-combat-training.js';
import { createCombatRuntimeV03 } from '../src/combat/combat-runtime-v03.js';

function rig() {
  let now = 1000;
  const player = { x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + 4 };
  const clock = { now: () => now };
  const training = createBuilding5CombatTraining({
    clock,
    getPlayerPosition: () => player
  });
  training.start();
  return {
    training,
    clock,
    now: () => now,
    setNow: value => { now = value; },
    advance: ms => { now += ms; },
    player
  };
}

function primePulse(r) {
  r.setNow(1000 + BUILDING5_TRAINING_ATTACK.firstDelayMs);
  const windup = r.training.update();
  assert.equal(windup.type, 'enemy-windup');
  assert.equal(r.training.snapshot().enemyAttack.phase, 'WINDUP');
  return r.now() + BUILDING5_TRAINING_ATTACK.windupMs;
}

test('Building 5 defense ports v9.22 player HP and dodge timing windows', () => {
  assert.equal(BUILDING5_TRAINING_PLAYER.maxHp, 1000);
  assert.equal(BUILDING5_TRAINING_PLAYER.dodgeDurationMs, 280);
  assert.equal(BUILDING5_TRAINING_PLAYER.iframeStartMs, 70);
  assert.equal(BUILDING5_TRAINING_PLAYER.iframeEndMs, 230);
  assert.equal(BUILDING5_TRAINING_PLAYER.perfectStartMs, 70);
  assert.equal(BUILDING5_TRAINING_PLAYER.perfectEndMs, 180);
});

test('training drone telegraphs before applying the v9.22 44 damage pulse', () => {
  const r = rig();
  const impactAt = primePulse(r);
  const telegraph = r.training.snapshot().enemyAttack;
  assert.equal(telegraph.damage, 44);
  assert.equal(telegraph.range, 5);
  assert.equal(telegraph.remainingMs, 680);

  r.setNow(impactAt);
  const impact = r.training.update();
  assert.equal(impact.outcome, 'HIT');
  assert.equal(impact.damage, 44);
  assert.equal(r.training.snapshot().player.hp, 956);
  assert.equal(r.training.snapshot().player.hitSerial, 1);
});


test('telegraph locks its aim point so spatial dodge movement can leave the impact radius', () => {
  const r = rig();
  const impactAt = primePulse(r);
  const attack = r.training.snapshot().enemyAttack;
  assert.equal(attack.impactRadius, 1.15);
  const lockedAim = { x: attack.aimX, z: attack.aimZ };

  r.player.z += 2.2;
  r.setNow(impactAt);
  const impact = r.training.update();

  assert.equal(impact.outcome, 'MISS');
  assert.equal(impact.damage, 0);
  assert.equal(r.training.snapshot().player.hp, 1000);
  assert.deepEqual(
    { x: r.training.snapshot().lastEnemyAttack.aimX, z: r.training.snapshot().lastEnemyAttack.aimZ },
    lockedAim
  );
});

for (const [elapsed, expected] of [
  [69, 'HIT'],
  [70, 'PERFECT_DODGE'],
  [180, 'PERFECT_DODGE'],
  [181, 'DODGE'],
  [230, 'DODGE'],
  [231, 'HIT']
]) {
  test(`dodge impact at ${elapsed}ms resolves as ${expected}`, () => {
    const r = rig();
    const impactAt = primePulse(r);
    r.setNow(impactAt - elapsed);
    const dodge = r.training.resolveAction({ action: 'dodge', identity: 'dodge' });
    assert.equal(dodge.accepted, true);
    r.setNow(impactAt);
    const impact = r.training.update();
    assert.equal(impact.outcome, expected);
    assert.equal(r.training.snapshot().player.hp, expected === 'HIT' ? 956 : 1000);
  });
}

test('Perfect Dodge gives Rapid +20 Overcharge and reduces S1 cooldown by 1s', () => {
  const r = rig();
  r.training.resolveAction({ action: 'active_1', identity: 'accelerate' });
  assert.equal(r.training.snapshot().momentum, 15);

  const impactAt = primePulse(r);
  r.setNow(impactAt - 70);
  r.training.resolveAction({ action: 'dodge', identity: 'dodge' });
  r.setNow(impactAt);
  const impact = r.training.update();

  assert.equal(impact.perfectDodge, true);
  assert.equal(r.training.snapshot().momentum, 35);
  assert.equal(r.training.snapshot().cooldowns.active_1, 3120);
  assert.equal(r.training.snapshot().player.perfectDodgeSerial, 1);
});

test('Combat Runtime converts local Perfect Dodge into v9.22 Ultimate +6', () => {
  let now = 1000;
  const player = { x: BUILDING5_TRAINING_TARGET.x, z: BUILDING5_TRAINING_TARGET.z + 4 };
  const clock = { now: () => now };
  const training = createBuilding5CombatTraining({ clock, getPlayerPosition: () => player });
  const runtime = createCombatRuntimeV03({ clock, localTraining: training });
  runtime.startTraining({ sourceRef: 'combat.building5.training_gate', placeZoneId: 'AREA_BUILDING_5_WEST' });

  now = 2200;
  runtime.update();
  now = 2810;
  runtime.dispatch('dodge');
  now = 2880;
  runtime.update();

  assert.equal(runtime.snapshot().training.lastEnemyAttack.outcome, 'PERFECT_DODGE');
  assert.equal(runtime.snapshot().ultimateGauge, 6);
});

test('BREAK cancels an armed telegraph and delays the next attack', () => {
  const r = rig();
  primePulse(r);
  assert.equal(r.training.snapshot().enemyAttack.phase, 'WINDUP');

  for (let i = 0; i < 25; i += 1) {
    r.training.resolveAction({ action: 'basic', identity: 'basic' });
  }

  const state = r.training.snapshot();
  assert.equal(state.breakSerial, 1);
  assert.equal(state.broken, true);
  assert.equal(state.enemyAttack.phase, 'IDLE');
  assert.ok(state.enemyAttack.nextInMs >= BUILDING5_TRAINING_TARGET.breakStunMs);
});

test('training reset restores player HP and clears defeat state without persistence', () => {
  const r = rig();
  const impactAt = primePulse(r);
  r.setNow(impactAt);
  r.training.update();
  assert.equal(r.training.snapshot().player.hp, 956);

  r.training.resetTarget();
  const state = r.training.snapshot();
  assert.equal(state.player.hp, 1000);
  assert.equal(state.player.defeated, false);
  assert.equal(state.enemyAttack.phase, 'IDLE');
  assert.equal('rewardId' in state, false);
  assert.equal('resultRef' in state, false);
});
