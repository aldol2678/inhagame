import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPhotoMode, PHOTO_MODE_BLOCK, PHOTO_MODE_OWNER, PHOTO_SUBJECT_DRIFT_LIMIT } from '../src/photo/photo-mode.js';
import { createPhotoCameraController } from '../src/photo/photo-camera-controller.js';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '../src/input/input-focus-runtime.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';

function harness({ position = { x: 12, y: 1.15, z: -40 } } = {}) {
  globalThis.document = { getElementById: () => null };
  globalThis.window = { addEventListener() {} };
  // Play camera behind and above the player, as the orbit leaves it on screen (entity z mirrored).
  const camera = createFakeCameraEntity({ position: [position.x + .4, position.y + 1.3, -(position.z - 3.3)],
    target: [position.x, position.y - .2, -position.z] });
  const orbit = new OrbitCameraController(camera, { addEventListener() {} });
  orbit.yaw = 1.7; orbit.pitch = .38; orbit.distance = 3.5;
  const focus = createInputFocusManager();
  const controller = { inputEnabled: true, setInputEnabled(value) { this.inputEnabled = value; } };
  bindInputFocusRuntime({ manager: focus, controller, orbit });
  const rig = createPhotoCameraController({ camera });
  const subject = { ...position };
  const state = { world: true, region: 'campus', space: 'campus', grounded: true, mounted: false, combat: false,
    cinematic: false, transitioning: false, accountId: 'guest' };
  const calls = { before: 0, poses: [], cancels: 0, changes: [] };
  const mode = createPhotoMode({ orbit, rig, inputFocus: focus, getPosition: () => subject, getState: () => state,
    getPointerLocked: () => true, beforeOpen: () => calls.before++,
    requestPose: () => { calls.poses.push('photo_pose'); return 'started'; }, cancelPose: () => calls.cancels++,
    onChange: change => calls.changes.push(change) });
  return { mode, rig, orbit, focus, controller, camera, subject, state, calls };
}
const orbitView = h => ({ yaw: h.orbit.yaw, pitch: h.orbit.pitch, distance: h.orbit.distance, firstPerson: h.orbit.firstPerson,
  firstPersonPitch: h.orbit.firstPersonPitch, thirdPersonPitch: h.orbit.thirdPersonPitch,
  mounted: h.orbit.mounted, flightProfile: h.orbit.flightProfile, distances: { ...h.orbit.distances }, target: { ...h.orbit.target } });
const frames = (h, n = 30, dt = 1 / 60) => { for (let i = 0; i < n; i++) h.mode.applyCamera(dt); };

test('opens anywhere in normal play: campus points far from the lake and indoor rooms', () => {
  for (const position of [{ x: 0, y: 1.15, z: -98 }, { x: -60, y: 1.4, z: 75 }, { x: 140, y: 1.2, z: 30 }]) {
    const h = harness({ position });
    assert.equal(h.mode.blockedReason(), null); assert.equal(h.mode.canOpen(), true);
    assert.equal(h.mode.open(), true, JSON.stringify(position)); h.mode.close();
  }
  const room = harness(); room.state.space = 'ROOM_CLUBHOUSE_01';
  assert.equal(room.mode.open(), true, 'rooms share the walking camera and its wall/ceiling collision');
});

test('entry keeps the exact play frame: no camera, lens or orbit write until the photographer acts', () => {
  const h = harness(), before = h.camera.pose(), view = orbitView(h);
  assert.equal(h.mode.open(), true);
  assert.deepEqual(h.camera.pose(), before); assert.equal(h.camera.writes, 0);
  frames(h);
  assert.deepEqual(h.camera.pose(), before, 'idle photo frames are the play frame');
  assert.equal(h.camera.writes, 0); assert.deepEqual(orbitView(h), view);
  assert.equal(h.calls.before, 1);
  const saved = h.mode.saved;
  assert.deepEqual(saved.position, { x: before.position[0], y: before.position[1], z: -before.position[2] });
  assert.deepEqual(saved.rotation, before.rotation);
  assert.equal(saved.fov, 62); assert.equal(saved.nearClip, .3); assert.equal(saved.pointerLocked, true);
  assert.deepEqual({ ...saved.orbit }, view);
});

test('close restores the exact play camera after free look, dolly and zoom', () => {
  const h = harness(), before = h.camera.pose(), view = orbitView(h);
  h.mode.open();
  h.rig.look(240, -60); h.rig.zoom(.5); h.rig.setMoveIntent({ x: .5, y: 1, z: 1 }); frames(h, 60);
  assert.notDeepEqual(h.camera.pose(), before);
  assert.equal(h.mode.close(), true); assert.equal(h.mode.close(), false);
  assert.deepEqual(h.camera.pose(), before); assert.deepEqual(orbitView(h), view);
  assert.equal(h.rig.active, false); assert.equal(h.controller.inputEnabled, true); assert.equal(h.orbit.inputEnabled, true);
  assert.equal(h.focus.size, 0);
});

test('an external orbit writer is undone so the restored view is always the snapshot', () => {
  const h = harness(), view = orbitView(h);
  h.mode.open(); Object.assign(h.orbit, { yaw: -2, pitch: .9, distance: 6, firstPerson: true });
  h.mode.close(); assert.deepEqual(orbitView(h), view);
});

test('gameplay movement, the orbit camera and world actions are blocked; only photo input is allowed', () => {
  const h = harness(); h.mode.open();
  assert.equal(h.controller.inputEnabled, false); assert.equal(h.orbit.inputEnabled, false);
  for (const capability of ['MOVE', 'CAMERA', 'WORLD_ACTION', 'GAMEPLAY_SHORTCUT', 'POINTER_LOCK']) assert.equal(h.focus.can(capability), false, capability);
  assert.deepEqual(h.focus.snapshot().topOwners, [PHOTO_MODE_OWNER]);
  assert.equal(h.mode.inputAllowed(), true);
  const chat = h.focus.claim('chat', INPUT_FOCUS_POLICY.CHAT);
  assert.equal(h.mode.inputAllowed(), true, 'a lower-priority claim never takes the photo camera');
  h.focus.release(chat); h.mode.close();
  assert.equal(h.mode.inputAllowed(), false);
});

const blocking = {
  lobby: [{ world: false }, PHOTO_MODE_BLOCK.LOBBY], transition: [{ transitioning: true }, PHOTO_MODE_BLOCK.TRANSITION],
  combat: [{ combat: true }, PHOTO_MODE_BLOCK.COMBAT], cinematic: [{ cinematic: true }, PHOTO_MODE_BLOCK.CINEMATIC],
  region: [{ region: 'biryong' }, PHOTO_MODE_BLOCK.REGION], mounted: [{ mounted: true }, PHOTO_MODE_BLOCK.MOUNTED]
};
for (const [name, [patch, reason]] of Object.entries(blocking)) {
  test(`${name} refuses entry with a reason and closes a live session with exact restoration`, () => {
    const h = harness(); Object.assign(h.state, patch);
    assert.equal(h.mode.blockedReason(), reason); assert.equal(h.mode.open(), false); assert.equal(h.calls.before, 0);
    const live = harness(), before = live.camera.pose();
    live.mode.open(); live.rig.look(100, 20); frames(live, 2);
    Object.assign(live.state, patch); assert.equal(live.mode.update(), false);
    assert.equal(live.mode.active, false); assert.deepEqual(live.camera.pose(), before); assert.equal(live.focus.size, 0);
    assert.equal(live.calls.changes.at(-1).reason, 'lifecycle');
  });
}

test('airborne entry and an existing dialog or system owner are refused; beforeOpen is re-checked', () => {
  const air = harness(); air.state.grounded = false;
  assert.equal(air.mode.blockedReason(), PHOTO_MODE_BLOCK.AIRBORNE); assert.equal(air.mode.open(), false);
  const dialog = harness(), token = dialog.focus.claim('npc-dialogue', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(dialog.mode.blockedReason(), PHOTO_MODE_BLOCK.FOCUS); assert.equal(dialog.mode.open(), false);
  dialog.focus.release(token); assert.equal(dialog.mode.open(), true);
  const racing = harness();
  const mode = createPhotoMode({ orbit: racing.orbit, rig: racing.rig, inputFocus: racing.focus,
    getPosition: () => racing.subject, getState: () => racing.state,
    beforeOpen: () => { racing.state.transitioning = true; } });
  assert.equal(mode.open(), false, 'a transaction started by beforeOpen wins'); assert.equal(racing.focus.size, 0);
  const lost = harness(); lost.subject.x = NaN;
  assert.equal(lost.mode.blockedReason(), PHOTO_MODE_BLOCK.POSITION);
});

test('account and space changes or a teleported subject close without moving the player', () => {
  for (const cause of ['account', 'space', 'teleport', 'nan']) {
    const h = harness(); h.mode.open();
    if (cause === 'account') h.state.accountId = 'account-b';
    if (cause === 'space') h.state.space = 'ROOM_DORM1_LOBBY';
    if (cause === 'teleport') h.subject.x += PHOTO_SUBJECT_DRIFT_LIMIT + .5;
    if (cause === 'nan') h.subject.z = NaN;
    const subject = { ...h.subject };
    h.mode.applyCamera(1 / 60);
    assert.equal(h.mode.active, false, cause); assert.equal(h.focus.size, 0);
    assert.deepEqual(h.subject, subject, 'the player is never moved by photo lifecycle');
  }
  const settle = harness(); settle.mode.open(); settle.subject.y -= .3; settle.subject.x += .4;
  assert.equal(settle.mode.update(), true, 'settling or a pose stays inside the subject drift limit');
});

test('a takeover closes and restores before the new owner snapshots the camera', () => {
  const h = harness(), before = h.camera.pose();
  h.mode.open(); h.rig.look(300, 0); frames(h, 2);
  let seen = null;
  h.focus.subscribe(state => { if (state.topOwners.includes('room-transition')) seen = h.camera.pose(); });
  const token = h.focus.claim('room-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(h.mode.active, false); assert.equal(h.calls.changes.at(-1).reason, 'takeover');
  assert.deepEqual(h.camera.pose(), before); assert.deepEqual(seen, before);
  assert.equal(h.controller.inputEnabled, false, 'the transition keeps movement locked');
  h.focus.release(token); assert.equal(h.controller.inputEnabled, true);
  const peer = harness(); peer.mode.open(); peer.focus.claim('inventory', INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(peer.mode.active, false, 'an equal-priority panel also takes over');
});

test('pose marks the session and closing cancels it; repeated sessions and destroy never leak', () => {
  const h = harness(); h.mode.open();
  assert.equal(h.mode.pose(), 'started'); assert.deepEqual(h.calls.poses, ['photo_pose']);
  h.mode.close(); assert.equal(h.calls.cancels, 1);
  for (let i = 0; i < 10; i++) { assert.equal(h.mode.open(), true); assert.equal(h.mode.open(), false); h.mode.close(); assert.equal(h.focus.size, 0); }
  assert.equal(h.mode.toggle(), true); assert.equal(h.mode.active, true); assert.equal(h.mode.toggle(), true); assert.equal(h.mode.active, false);
  h.mode.open(); h.mode.destroy(); h.mode.destroy();
  assert.equal(h.mode.active, false); assert.equal(h.focus.size, 0);
  assert.equal(h.mode.open(), false); assert.equal(h.mode.pose(), false); assert.equal(h.mode.blockedReason(), PHOTO_MODE_BLOCK.DESTROYED);
});

test('Photo Mode is a global entry: no context action, place coordinate or Inkyung dependency', async () => {
  const h = harness();
  assert.equal('contextAction' in h.mode, false);
  for (const file of ['photo-mode.js', 'photo-camera-controller.js', 'photo-input.js', 'photo-mode-panel.js']) {
    const source = await readFile(new URL(`../src/photo/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /inkyung|INKYUNG|PHOTO_FRAME_LIMITS|lakeYaw/i, file);
  }
});
