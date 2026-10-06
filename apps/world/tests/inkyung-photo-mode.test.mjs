import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoMode, PHOTO_FRAME_LIMITS } from '../src/photo/photo-mode.js';
import { INKYUNG_PHOTO_POINT, inkyungPhotoPosition } from '../src/photo/inkyung-photo-point.js';
import { positionAt } from '../npc-factory/dev-runtime-state.mjs';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '../src/input/input-focus-runtime.js';

function harness() {
  globalThis.document = { getElementById: () => null };
  globalThis.window = { addEventListener() {} };
  const camera = { camera: { nearClip: .3 }, setPosition() {}, lookAt() {} };
  const orbit = new OrbitCameraController(camera, { addEventListener() {} });
  orbit.yaw = 1.7; orbit.pitch = -.5; orbit.distance = 5.2;
  const focus = createInputFocusManager();
  const controller = { inputEnabled: true, setInputEnabled(value) { this.inputEnabled = value; } };
  bindInputFocusRuntime({ manager: focus, controller, orbit });
  const position = { ...INKYUNG_PHOTO_POINT.position, y: 1.1 };
  const state = { campus: true, grounded: true, mounted: false, seated: false, transitioning: false, combat: false, accountId: 'guest' };
  const changes = [], poses = [], stops = [];
  const mode = createPhotoMode({ orbit, inputFocus: focus, getPosition: () => position, getState: () => state,
    onChange: change => changes.push(change), requestPose: () => { poses.push('photo_pose'); return 'started'; },
    cancelPose: () => stops.push(true) });
  return { mode, orbit, focus, controller, position, state, changes, poses, stops, camera };
}
const view = h => ({ yaw: h.orbit.yaw, pitch: h.orbit.pitch, distance: h.orbit.distance,
  firstPerson: h.orbit.firstPerson, nearClip: h.camera.camera.nearClip,
  firstPersonPitch: h.orbit.firstPersonPitch, thirdPersonPitch: h.orbit.thirdPersonPitch });

test('photo anchor exactly reuses the existing semantic location, including every NPC slot', () => {
  assert.deepEqual(INKYUNG_PHOTO_POINT.position, { x: 119.93159345039713, z: 32.150936735877636 });
  for (let slot = 0; slot < 12; slot++) assert.deepEqual(inkyungPhotoPosition(slot), positionAt('inkyung_photo_point', slot));
});

test('one nearby point opens through context action; repeated entry is idempotent and input authority restores', () => {
  const h = harness(), saved = view(h);
  const action = h.mode.contextAction();
  assert.equal(action.id, 'inkyung-photo-mode');
  assert.equal(action.trigger(), true);
  assert.equal(h.mode.active, true); assert.equal(h.mode.open(), false);
  assert.equal(h.focus.size, 1); assert.equal(h.controller.inputEnabled, false);
  assert.equal(h.orbit.inputEnabled, false); assert.equal(h.focus.can('WORLD_ACTION'), false);
  assert.equal(h.mode.contextAction(), null);
  assert.equal(h.mode.pose(), 'started'); assert.deepEqual(h.poses, ['photo_pose']);
  assert.equal(h.mode.close(), true); assert.equal(h.mode.close(), false);
  assert.deepEqual(view(h), saved); assert.equal(h.controller.inputEnabled, true);
  assert.equal(h.focus.size, 0); assert.equal(h.stops.length, 1);
});

test('framing stays bounded; NaN and closed input cannot corrupt the camera', () => {
  const h = harness(); h.mode.open();
  const initial = view(h);
  h.mode.frame({ yaw: 999, pitch: -999, distance: 999 });
  assert.equal(h.orbit.yaw, initial.yaw + PHOTO_FRAME_LIMITS.yaw);
  assert.equal(h.orbit.pitch, PHOTO_FRAME_LIMITS.pitch.min);
  assert.equal(h.orbit.distance, PHOTO_FRAME_LIMITS.distance.max);
  const bounded = view(h); h.mode.frame({ yaw: NaN, pitch: Infinity, distance: 'bad' }); assert.deepEqual(view(h), bounded);
  h.mode.close(); const closed = view(h); assert.equal(h.mode.frame({ yaw: 1 }), false); assert.deepEqual(view(h), closed);
});

test('first-person camera and caches restore exactly without stealing a newer input owner', () => {
  const h = harness(); h.orbit.togglePerspective(); h.orbit.pitch = -.8;
  const saved = view(h); h.mode.open(); assert.equal(h.orbit.firstPerson, false);
  h.mode.frame({ pitch: .3, distance: 3 });
  const token = h.focus.claim('room-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(h.mode.active, false); assert.deepEqual(view(h), saved);
  assert.equal(h.controller.inputEnabled, false); assert.equal(h.orbit.inputEnabled, false);
  assert.equal(h.focus.size, 1); h.focus.release(token); assert.equal(h.controller.inputEnabled, true);
});

for (const [name, patch] of Object.entries({ room: { campus: false }, mount: { mounted: true }, flight: { grounded: false },
  seat: { seated: true }, combat: { combat: true }, transition: { transitioning: true } })) {
  test(`rejects ${name} on entry and closes on ${name} boundary`, () => {
    const h = harness(); Object.assign(h.state, patch); assert.equal(h.mode.open(), false); assert.equal(h.mode.contextAction(), null);
    const ready = harness(); const saved = view(ready); ready.mode.open(); Object.assign(ready.state, patch); ready.mode.update();
    assert.equal(ready.mode.active, false); assert.deepEqual(view(ready), saved);
  });
}

test('retained context callbacks revalidate point proximity and all state at activation', () => {
  const h = harness(), action = h.mode.contextAction(); h.position.x += 100;
  assert.equal(action.trigger(), false); assert.equal(h.focus.size, 0);
  h.position.x = NaN; assert.equal(h.mode.open(), false);
});

test('account change and unexpected teleport close without restoring player coordinates or reacquiring focus', () => {
  for (const cause of ['account', 'teleport']) {
    const h = harness(); h.mode.open();
    if (cause === 'account') h.state.accountId = 'account-b'; else h.position.x += .5;
    h.mode.update(); assert.equal(h.mode.active, false); assert.equal(h.focus.size, 0);
    if (cause === 'teleport') assert.equal(h.position.x, INKYUNG_PHOTO_POINT.position.x + .5);
  }
});

test('other blocking UI prevents entry and takeover cancels safely across repeated sessions', () => {
  const h = harness(); const token = h.focus.claim('inventory', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(h.mode.open(), false); h.focus.release(token);
  for (let i = 0; i < 10; i++) { assert.equal(h.mode.open(), true); h.mode.close(); assert.equal(h.focus.size, 0); }
  h.mode.open(); const takeover = h.focus.claim('inventory', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(h.mode.active, false); assert.equal(h.focus.can('MOVE'), false); h.focus.release(takeover);
  h.mode.destroy(); assert.equal(h.mode.open(), false); assert.equal(h.mode.pose(), false);
});

test('the real stationary NPC keeps dialogue nearby while photo mode has a usable approach band', async () => {
  const { readFile } = await import('node:fs/promises');
  const { snapshotForPeriod, validateDevCandidate, PULSE_PERIODS } = await import('../npc-factory/dev-runtime-state.mjs');
  const { selectContextAction } = await import('../src/context-action.js');
  const { canOccupy } = await import('../src/world-collision.js');
  const { roadviewGroundHeight } = await import('../src/roadview-layout.js');
  const { findSeat } = await import('../src/seat-anchors.js');
  const batch = validateDevCandidate(JSON.parse(await readFile(new URL('../npc-factory/data/repaired/INKYUNG-20-A-R1.json', import.meta.url))));
  const h = harness();
  for (const period of PULSE_PERIODS) {
    const guide = snapshotForPeriod(batch, period).actors.find(actor => actor.npc_id === 'INKYUNG-NPC-002' || actor.id === 'INKYUNG-NPC-002');
    assert.ok(guide, 'stationary guide remains in the validated real roster');
    assert.deepEqual(guide.position, INKYUNG_PHOTO_POINT.position);
    assert.equal(selectContextAction([h.mode.contextAction(), { id: 'npc-talk', priority: 300, distance: 0 }]).id, 'npc-talk');
  }
  // A full 1.5-unit (3 m) band beyond the guide's talk radius, not a pixel-perfect ring.
  for (const distance of [1.7, 2, 2.5, 2.9]) {
    h.position.z = INKYUNG_PHOTO_POINT.position.z + distance;
    h.position.y = 1.15 + roadviewGroundHeight(h.position.x, h.position.z);
    assert.equal(canOccupy(h.position), true, 'photo approach is walkable');
    assert.equal(findSeat(h.position), null, 'a seat does not steal this approach');
    assert.equal(selectContextAction([h.mode.contextAction()]).id, 'inkyung-photo-mode');
  }
});
