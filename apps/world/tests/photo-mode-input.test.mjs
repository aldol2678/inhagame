import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '../src/input/input-focus-runtime.js';
import { bindPointerLockRuntime } from '../src/input/pointer-lock-runtime.js';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { createPhotoCameraController, PHOTO_CAMERA_TUNING } from '../src/photo/photo-camera-controller.js';
import { createPhotoInput, PHOTO_WHEEL_ZOOM } from '../src/photo/photo-input.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';

// Real movement/camera/focus/photo modules with synthetic events. Native touch still needs browser QA.
class Control {
  listeners = new Map(); captures = new Set(); style = {}; clientWidth = 120; clientHeight = 720;
  constructor(tagName = 'DIV') { this.tagName = tagName; }
  addEventListener(type, fn) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)); }
  count(type) { return (this.listeners.get(type) ?? []).length; }
  dispatch(type, props = {}) {
    const event = { type, target: this, currentTarget: this, prevented: 0, stopped: 0,
      preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, stopImmediatePropagation() { this.stopped++; }, ...props };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.dispatch('lostpointercapture', { pointerId: id }); }
}
const CANVAS = { tagName: 'CANVAS' }, BUTTON = { tagName: 'BUTTON' };

function stack({ player = false, look = { sensitivity: 1, invertY: false } } = {}) {
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement'].map(k => [k, globalThis[k]]));
  const controls = Object.fromEntries(['joystick', 'joystick-knob', 'jump', 'run', 'descend'].map(id => [id, new Control()]));
  controls['joystick-knob'].clientWidth = 40;
  const win = new Control(), doc = new Control(), canvas = new Control('CANVAS');
  doc.body = { dataset: {} }; doc.getElementById = id => controls[id] ?? null;
  Object.assign(globalThis, { window: win, document: doc, HTMLElement: class {} });
  const ground = roadviewGroundHeight(30, -60), position = { x: 30, y: 1.15 + ground, z: -60 };
  const entity = { getLocalPosition: () => ({ ...position }), setLocalPosition: (x, y, z) => Object.assign(position, { x, y, z }), setLocalEulerAngles() {} };
  const controller = player ? new PlayerController(entity) : { inputEnabled: true, setInputEnabled(v) { this.inputEnabled = v; } };
  const camera = createFakeCameraEntity({ position: [30, ground + 2.4, 63.4], target: [30, ground + .8, 60] });
  const orbit = new OrbitCameraController(camera, canvas);
  const focus = createInputFocusManager();
  const runtime = bindInputFocusRuntime({ manager: focus, controller, orbit });
  const rig = createPhotoCameraController({ camera });
  const mode = createPhotoMode({ orbit, rig, inputFocus: focus, getPosition: () => position,
    getState: () => ({ world: true, region: 'campus', space: 'campus', grounded: true, accountId: 'guest' }) });
  const commands = { capture: 0, toggleUi: 0, reset: 0, escape: 0, tab: 0, lens: 0, precision: [] };
  let shortcuts = true;
  const input = createPhotoInput({ mode, rig, canvas, doc, win, canUseShortcut: () => shortcuts, getMouseLook: () => look });
  input.setCommands({ capture: () => commands.capture++, toggleUi: () => commands.toggleUi++, reset: () => commands.reset++,
    escape: () => { commands.escape++; return false; }, tab: () => commands.tab++, lens: () => commands.lens++,
    precision: active => commands.precision.push(active) });
  const key = (code, props = {}) => doc.dispatch('keydown', { code, target: CANVAS, ...props });
  const keyup = (code, props = {}) => doc.dispatch('keyup', { code, target: CANVAS, ...props });
  const run = (seconds = .5, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) mode.applyCamera(dt); };
  return { win, doc, canvas, controls, controller, orbit, focus, rig, mode, input, commands, position, camera, key, keyup, run, runtime,
    setShortcuts: value => { shortcuts = value; },
    restore() { input.destroy(); mode.destroy(); runtime.destroy(); Object.assign(globalThis, saved); } };
}
const travel = h => { const s = h.rig.snapshot(); return Math.hypot(s.position.x - s.entry.x, s.position.y - s.entry.y, s.position.z - s.entry.z); };

test('real player and Pointer Lock release held keyboard/touch/assist on entry and never resume stale intent on exit', t => {
  const h = stack({ player: true }); t.after(() => h.restore());
  const { controller, controls, win, doc, canvas, orbit, focus, position } = h;
  let exits = 0, requests = 0;
  doc.pointerLockElement = canvas;
  doc.exitPointerLock = () => { exits++; doc.pointerLockElement = null; doc.dispatch('pointerlockchange'); };
  canvas.requestPointerLock = () => { requests++; };
  const lock = bindPointerLockRuntime({ manager: focus, canvas, orbit, documentLike: doc, windowTarget: win, finePointer: true });
  t.after(() => lock.destroy());
  win.dispatch('keydown', { code: 'KeyW' });
  controls.joystick.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 60 });
  controller.setAssistedMovement({ x: 1, z: 0, run: false });
  assert.ok(controller.keys.size); assert.equal(controller.touchVector.x, 1); assert.ok(controller.assist);
  const original = { ...position }; assert.equal(h.mode.open(), true);
  assert.equal(exits, 1); assert.equal(orbit.pointerLockActive, false); assert.equal(lock.status().desired, false);
  assert.equal(controller.keys.size, 0); assert.deepEqual(controller.touchVector, { x: 0, y: 0 });
  assert.equal(controller.assist, null); assert.equal(controls.joystick.hasPointerCapture(1), false);
  // The photo camera receives these keys; window-level gameplay never does.
  const w = h.key('KeyW'); assert.ok(w.stopped > 0, 'photo keys stop at the document');
  win.dispatch('keydown', { code: 'KeyW' }); win.dispatch('keydown', { code: 'Space' });
  controls.joystick.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 60 });
  h.run(.5); controller.update(.05, orbit.yaw);
  assert.deepEqual(position, original, 'the player never moves while the photo camera does');
  assert.ok(travel(h) > .5, 'W dollies the photo camera');
  h.keyup('KeyW'); h.mode.close();
  assert.equal(lock.status().awaitingGesture, true); assert.equal(requests, 0);
  controls.joystick.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 60 });
  controller.update(.05, orbit.yaw); assert.deepEqual(position, original); assert.equal(controller.jumpQueued, false);
  win.dispatch('keydown', { code: 'KeyW' }); controller.update(.05, orbit.yaw);
  assert.ok(Math.hypot(position.x - original.x, position.z - original.z) > 0, 'fresh movement works after exit');
});

test('WASD/QE drive the planar dolly; a key still held from play is never resumed', t => {
  const h = stack(); t.after(() => h.restore());
  h.mode.open();
  h.key('KeyW', { repeat: true }); h.run(.5);
  assert.equal(travel(h), 0, 'an auto-repeat without our keydown is stale play input');
  for (const [code, axis, sign] of [['KeyW', 'z', 1], ['KeyS', 'z', -1], ['KeyD', 'x', 1], ['KeyA', 'x', -1], ['KeyE', 'y', 1], ['KeyQ', 'y', -1]]) {
    h.key(code); assert.equal(h.input.status().keys.includes(code), true);
    h.keyup(code); assert.deepEqual(h.input.status().keys, []);
  }
  h.key('KeyE'); h.run(.5); h.keyup('KeyE'); h.run(.6);
  const s = h.rig.snapshot();
  assert.ok(s.position.y > s.entry.y + .4, 'E raises'); assert.equal(s.moving, false, 'release settles');
});

test('Shift precision scales travel, latch and badge state follow, and R resets', t => {
  const normal = stack(), precise = stack(); t.after(() => { normal.restore(); precise.restore(); });
  normal.mode.open(); precise.mode.open();
  precise.key('ShiftLeft'); assert.equal(precise.input.precision, true); assert.deepEqual(precise.commands.precision, [true]);
  for (const h of [normal, precise]) { h.key('KeyW'); h.run(1); }
  const ratio = travel(precise) / travel(normal);
  assert.ok(Math.abs(ratio - PHOTO_CAMERA_TUNING.precision.move) < .02, `precision travel ratio ${ratio}`);
  precise.keyup('ShiftLeft'); assert.equal(precise.input.precision, false);
  precise.input.setPrecisionLatch(true); assert.equal(precise.input.precision, true); assert.equal(precise.rig.snapshot().precision, true);
  precise.input.setPrecisionLatch(false);
  normal.keyup('KeyW'); normal.key('KeyR'); assert.equal(normal.commands.reset, 1); assert.equal(travel(normal), 0);
});

test('Space/Enter capture, H toggles UI, Escape closes, Tab is delegated; focused controls keep native activation', t => {
  const h = stack(); t.after(() => h.restore());
  h.mode.open();
  h.key('Space'); h.key('Enter'); h.key('Space', { repeat: true });
  assert.equal(h.commands.capture, 2);
  h.key('Space', { target: BUTTON }); h.key('Enter', { target: BUTTON });
  assert.equal(h.commands.capture, 2, 'a focused photo button activates itself instead');
  h.key('KeyH'); assert.equal(h.commands.toggleUi, 1);
  h.key('Tab'); assert.equal(h.commands.tab, 1);
  h.key('KeyW', { ctrlKey: true }); h.key('KeyS', { metaKey: true }); assert.deepEqual(h.input.status().keys, []);
  const escape = h.key('Escape');
  assert.equal(h.commands.escape, 1); assert.equal(h.mode.active, false); assert.ok(escape.prevented && escape.stopped);
});

test('P opens from play under the shortcut gate, never while typing or composing', t => {
  const h = stack(); t.after(() => h.restore());
  h.key('KeyP', { target: { tagName: 'INPUT' } }); assert.equal(h.mode.active, false);
  h.key('KeyP', { isComposing: true }); h.key('KeyP', { ctrlKey: true }); assert.equal(h.mode.active, false);
  h.setShortcuts(false); h.key('KeyP'); assert.equal(h.mode.active, false);
  h.setShortcuts(true); h.key('KeyP'); assert.equal(h.mode.active, true);
  h.key('KeyP'); assert.equal(h.mode.active, true, 'P is not a toggle while composing a shot');
});

test('canvas: one pointer looks with gameplay mouse settings, two pointers pinch, wheel zooms', t => {
  const h = stack({ look: { sensitivity: 2, invertY: true } }); t.after(() => h.restore());
  h.mode.open();
  const start = h.rig.snapshot();
  h.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
  h.canvas.dispatch('pointermove', { pointerId: 1, clientX: 350, clientY: 310 });
  const mouse = h.rig.snapshot();
  assert.ok(Math.abs((mouse.yaw - start.yaw) + 50 * PHOTO_CAMERA_TUNING.look.yaw * 2) < 1e-9, 'mouse sensitivity applies');
  assert.ok(mouse.pitch < start.pitch, 'invert Y applies to the mouse');
  h.canvas.dispatch('pointerup', { pointerId: 1 });
  h.rig.reset();
  h.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 });
  h.canvas.dispatch('pointermove', { pointerId: 2, clientX: 150, clientY: 110 });
  const touch = h.rig.snapshot();
  assert.ok(Math.abs((touch.yaw - start.yaw) + 50 * PHOTO_CAMERA_TUNING.look.yaw) < 1e-9, 'touch uses base sensitivity');
  assert.ok(touch.pitch > start.pitch, 'touch never inverts');
  h.canvas.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 250, clientY: 110 });
  const yawBeforePinch = h.rig.snapshot().yaw;
  h.canvas.dispatch('pointermove', { pointerId: 3, clientX: 350, clientY: 110 });
  assert.ok(Math.abs(h.rig.snapshot().fov - 62 / 2) < 1e-9, 'spreading to twice the distance halves the FOV');
  assert.equal(h.rig.snapshot().yaw, yawBeforePinch, 'pinch never looks'); assert.equal(h.commands.lens, 1);
  h.canvas.dispatch('pointerup', { pointerId: 3 });
  h.canvas.dispatch('pointermove', { pointerId: 2, clientX: 160, clientY: 110 });
  assert.ok(Math.abs(h.rig.snapshot().yaw - (yawBeforePinch - 10 * PHOTO_CAMERA_TUNING.look.yaw * .5)) < 1e-9,
    'the remaining finger continues from its own last point (half rate at half FOV)');
  h.canvas.dispatch('pointerup', { pointerId: 2 });
  const wheel = h.canvas.dispatch('wheel', { deltaY: 100, deltaMode: 0 });
  assert.ok(Math.abs(h.rig.snapshot().fov - 31 * Math.exp(100 * PHOTO_WHEEL_ZOOM)) < 1e-9); assert.equal(wheel.prevented, 1);
});

test('UI pointers never leak into the camera look, and photo input is inert outside its session', t => {
  const h = stack(); t.after(() => h.restore());
  h.mode.open();
  const before = h.rig.snapshot();
  // A drag that began on a photo button arrives at the canvas without a canvas pointerdown.
  h.canvas.dispatch('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 400, clientY: 400 });
  h.canvas.dispatch('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 500, clientY: 450 });
  assert.equal(h.rig.snapshot().yaw, before.yaw); assert.equal(h.rig.snapshot().pitch, before.pitch);
  h.canvas.dispatch('pointerdown', { pointerId: 4, pointerType: 'mouse', button: 3, clientX: 1, clientY: 1 });
  h.canvas.dispatch('pointermove', { pointerId: 4, clientX: 90, clientY: 1 });
  assert.equal(h.rig.snapshot().yaw, before.yaw, 'back/forward mouse buttons are not look buttons');
  h.mode.close();
  h.canvas.dispatch('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
  h.canvas.dispatch('wheel', { deltaY: 300 }); h.key('KeyW');
  assert.equal(h.input.status().pointers, 0); assert.deepEqual(h.input.status().keys, []);
  assert.equal(h.rig.snapshot(), null, 'the photo rig is released');
  assert.ok(h.orbit.distance > 3.5, 'after exit the wheel belongs to the gameplay orbit again');
});

test('photo move pad and hold buttons: pad forward/strafe, release stops, keyboard click nudges', t => {
  const h = stack(); t.after(() => h.restore());
  const pad = new Control(), knob = new Control(), up = new Control('BUTTON'), down = new Control('BUTTON');
  h.input.bindMovePad(pad, knob); h.input.bindHoldButton(up, 1); h.input.bindHoldButton(down, -1);
  pad.dispatch('pointerdown', { pointerId: 7, clientX: 60, clientY: 0 });
  assert.equal(h.input.status().pad.z, 0, 'inert until a session owns input');
  h.mode.open();
  const event = pad.dispatch('pointerdown', { pointerId: 7, clientX: 60, clientY: 0 });
  assert.ok(pad.hasPointerCapture(7) && event.stopped, 'the pad captures its drag away from the canvas look');
  assert.deepEqual(h.input.status().pad, { x: 0, z: 1 });
  assert.match(knob.style.transform, /translate\(0\.0px, -33\.0px\)/);
  pad.dispatch('pointermove', { pointerId: 7, clientX: 120, clientY: 60 });
  assert.deepEqual(h.input.status().pad, { x: 1, z: -0 });
  pad.dispatch('pointermove', { pointerId: 7, clientX: 63, clientY: 61 });
  assert.deepEqual(h.input.status().pad, { x: 0, z: -0 }, 'dead zone');
  pad.dispatch('pointermove', { pointerId: 7, clientX: 60, clientY: 0 }); h.run(.5);
  assert.ok(travel(h) > .4);
  pad.dispatch('pointerup', { pointerId: 7 }); assert.deepEqual(h.input.status().pad, { x: 0, z: 0 }); assert.equal(knob.style.transform, '');
  h.rig.reset();
  up.dispatch('pointerdown', { pointerId: 8 }); assert.equal(h.input.status().vertical.up, 1); h.run(.4);
  up.dispatch('pointercancel', { pointerId: 8 }); assert.equal(h.input.status().vertical.up, 0);
  assert.ok(h.rig.snapshot().position.y > h.rig.snapshot().entry.y + .2);
  h.rig.reset();
  down.dispatch('click', { detail: 0 });
  assert.ok(Math.abs(h.rig.snapshot().position.y - (h.rig.snapshot().entry.y - .25)) < 1e-9, 'Enter/Space on ▼ nudges down');
  down.dispatch('click', { detail: 1 });
  assert.ok(Math.abs(h.rig.snapshot().position.y - (h.rig.snapshot().entry.y - .25)) < 1e-9, 'a pointer click already held');
});

test('window blur releases held input without ending the shot; destroy removes every listener', t => {
  const h = stack(); t.after(() => Object.assign(globalThis, { window: undefined }));
  h.mode.open(); h.key('KeyW'); h.key('ShiftRight');
  h.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 1, clientY: 1 });
  h.win.dispatch('blur');
  assert.equal(h.mode.active, true); assert.deepEqual(h.input.status().keys, []);
  assert.equal(h.input.status().shift, false); assert.equal(h.input.status().pointers, 0);
  const targets = [[h.doc, 'keydown'], [h.doc, 'keyup'], [h.win, 'blur'], [h.canvas, 'pointerdown'], [h.canvas, 'pointermove'], [h.canvas, 'wheel']];
  const alive = targets.map(([target, type]) => target.count(type));
  h.restore();
  targets.forEach(([target, type], i) => assert.equal(target.count(type), alive[i] - 1, `photo ${type} listener removed`));
});

test('another owner taking focus ends the session and the photo listeners go inert', t => {
  const h = stack(); t.after(() => h.restore());
  h.mode.open(); h.key('KeyW');
  const token = h.focus.claim('room-transition', INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(h.mode.active, false); assert.deepEqual(h.input.status().keys, []);
  h.key('KeyE'); h.canvas.dispatch('wheel', { deltaY: 100 });
  assert.deepEqual(h.input.status().keys, []); h.focus.release(token);
});
