import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUCK_FOLLOW_CONFIG,
  advanceDuckFollowState,
  createDuckFollowState,
  isActiveDuckCompanion
} from '../src/creature/duck-companion-follow-state.js';

const activeSnapshot = {
  state: 'OWNED',
  ownedCreature: {
    creatureId: 'duck-1',
    currentFormId: 'creature.form.duck.base'
  },
  party: { activeCreatureId: 'duck-1' }
};

test('only owned duck.base in ACTIVE slot renders as companion', () => {
  assert.equal(isActiveDuckCompanion(activeSnapshot), true);
  assert.equal(isActiveDuckCompanion({ ...activeSnapshot, state: 'BOND_ELIGIBLE' }), false);
  assert.equal(isActiveDuckCompanion({
    ...activeSnapshot,
    party: { activeCreatureId: 'other' }
  }), false);
  assert.equal(isActiveDuckCompanion({
    ...activeSnapshot,
    ownedCreature: { creatureId: 'duck-1', currentFormId: 'creature.form.duck.evolved' }
  }), false);
});

test('duck trails moving player and stops inside follow dead-zone', () => {
  const state = createDuckFollowState({ x: 0, z: 0 });
  const initial = { x: state.x, z: state.z };

  for (let i = 0; i < 30; i++) {
    advanceDuckFollowState(state, { player: { x: 4, z: 0 }, dt: 0.05 });
  }
  assert.ok(state.x > initial.x);
  assert.ok(Math.hypot(4 - state.x, state.z) < 3);
  assert.equal(state.teleported, false);

  for (let i = 0; i < 50; i++) {
    advanceDuckFollowState(state, { player: { x: 4, z: 0 }, dt: 0.05 });
  }
  assert.equal(state.moving, false);
});

test('large separation safety-repositions duck instead of running across the map', () => {
  const state = createDuckFollowState({ x: 0, z: 0 });
  state.x = -20;
  state.z = -20;
  advanceDuckFollowState(state, { player: { x: 10, z: 10 }, dt: 0.05 });
  assert.equal(state.teleported, true);
  assert.ok(Math.hypot(10 - state.x, 10 - state.z) < DUCK_FOLLOW_CONFIG.teleportDistance);
});

test('follow step clamps pathological delta time', () => {
  const a = createDuckFollowState({ x: 0, z: 0 });
  const b = structuredClone(a);
  advanceDuckFollowState(a, { player: { x: 4, z: 0 }, dt: 100 });
  advanceDuckFollowState(b, { player: { x: 4, z: 0 }, dt: 0.1 });
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
  assert.ok(Math.abs(a.z - b.z) < 1e-9);
});
