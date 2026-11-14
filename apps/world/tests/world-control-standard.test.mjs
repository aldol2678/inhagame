import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_AXES, normalizeGroundInput, touchToGroundInput,
  cameraRelativeGroundDirection, applyCameraLook
} from '../src/input/world-control-standard.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('gameplay axes explicitly match the INHA WORLD camera convention', () => {
  assert.deepEqual(CONTROL_AXES, { right: '+X', forward: '+Z', up: '+Y', yawUnit: 'radians' });
});

test('WASD and joystick use the same normalized ground intent', () => {
  assert.deepEqual(touchToGroundInput(0, -1), { right: 0, forward: 1 });
  assert.deepEqual(touchToGroundInput(1, 0), { right: 1, forward: -0 });
  const diagonal = normalizeGroundInput(1, 1);
  near(Math.hypot(diagonal.right, diagonal.forward), 1);
  assert.deepEqual(normalizeGroundInput(0.3, 0.4), { right: 0.3, forward: 0.4 });
  assert.deepEqual(normalizeGroundInput(Number.NaN, 1), { right: 0, forward: 0 });
});

test('right and forward remain orthogonal at 0, 90, 180, and 270 degrees', () => {
  for (const degrees of [0, 90, 180, 270]) {
    const yaw = degrees * Math.PI / 180;
    const forward = cameraRelativeGroundDirection(0, 1, yaw);
    const right = cameraRelativeGroundDirection(1, 0, yaw);
    near(forward.x * right.x + forward.z * right.z, 0);
    near(Math.hypot(forward.x, forward.z), 1);
    near(Math.hypot(right.x, right.z), 1);
    near(forward.x, -Math.sin(yaw));
    near(forward.z, Math.cos(yaw));
  }
});

test('camera-relative mapping retains INHA WORLD cardinal signs', () => {
  const atZero = cameraRelativeGroundDirection(0, 1, 0);
  assert.deepEqual(atZero, { x: 0, z: 1 });
  const atRight = cameraRelativeGroundDirection(1, 0, 0);
  assert.deepEqual(atRight, { x: 1, z: 0 });
  const atQuarterTurn = cameraRelativeGroundDirection(0, 1, Math.PI / 2);
  near(atQuarterTurn.x, -1);
  near(atQuarterTurn.z, 0);
  assert.deepEqual(cameraRelativeGroundDirection(1, 1, Number.NaN), { x: 0, z: 0 });
});

test('drag look has deterministic horizontal sign, invert-Y, and pitch limits', () => {
  const args = { yaw: 0.5, pitch: 0, deltaX: 10, deltaY: 10,
    yawScale: 0.006, pitchScale: 0.005, minPitch: -0.5, maxPitch: 0.5 };
  const normal = applyCameraLook(args);
  near(normal.yaw, 0.44);
  near(normal.pitch, 0.05);
  const inverted = applyCameraLook({ ...args, invertY: true });
  near(inverted.pitch, -0.05);
  near(applyCameraLook({ ...args, pitch: 0.49 }).pitch, 0.5);
  assert.deepEqual(applyCameraLook({ ...args, deltaX: Number.NaN }), { yaw: args.yaw, pitch: args.pitch });
});
