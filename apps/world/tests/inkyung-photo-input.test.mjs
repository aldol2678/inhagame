import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';
import { OrbitCameraController } from '../src/orbit-camera-controller.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';
import { bindInputFocusRuntime } from '../src/input/input-focus-runtime.js';
import { bindPointerLockRuntime } from '../src/input/pointer-lock-runtime.js';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { INKYUNG_PHOTO_POINT } from '../src/photo/inkyung-photo-point.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';

// Real movement/camera/focus modules with synthetic events. Native touch still needs browser QA.
class Control {
  listeners = new Map(); captures = new Set(); style = {}; clientWidth = 120;
  addEventListener(type, fn) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)); }
  dispatch(type, props = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ type, target: this, currentTarget: this, preventDefault() {}, ...props }); }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.dispatch('lostpointercapture', { pointerId: id }); }
}

test('real player and Pointer Lock release held keyboard/touch/assist on entry and never resume stale intent on exit', t => {
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement'].map(k => [k, globalThis[k]]));
  t.after(() => Object.assign(globalThis, saved));
  const controls = Object.fromEntries(['joystick', 'joystick-knob', 'jump', 'run', 'descend'].map(id => [id, new Control()]));
  controls['joystick-knob'].clientWidth = 40;
  const win = new Control(), doc = new Control(), canvas = new Control();
  doc.body = { dataset: {} }; doc.getElementById = id => controls[id] ?? null;
  let exits = 0, requests = 0;
  doc.pointerLockElement = canvas;
  doc.exitPointerLock = () => { exits++; doc.pointerLockElement = null; doc.dispatch('pointerlockchange'); };
  canvas.requestPointerLock = () => { requests++; };
  Object.assign(globalThis, { window: win, document: doc, HTMLElement: class {} });
  const position = { ...INKYUNG_PHOTO_POINT.position, y: 1.15 + roadviewGroundHeight(INKYUNG_PHOTO_POINT.position.x, INKYUNG_PHOTO_POINT.position.z) };
  const entity = { getLocalPosition: () => ({ ...position }), setLocalPosition: (x, y, z) => Object.assign(position, { x, y, z }), setLocalEulerAngles() {} };
  const controller = new PlayerController(entity), focus = createInputFocusManager();
  const orbit = new OrbitCameraController({ camera: { nearClip: .3 } }, canvas);
  const input = bindInputFocusRuntime({ manager: focus, controller, orbit }); t.after(() => input.destroy());
  const lock = bindPointerLockRuntime({ manager: focus, canvas, orbit, documentLike: doc, windowTarget: win, finePointer: true }); t.after(() => lock.destroy());
  const mode = createPhotoMode({ orbit, inputFocus: focus, getPosition: () => position,
    getState: () => ({ campus: true, grounded: controller.grounded, mounted: controller.mounted }) }); t.after(() => mode.destroy());
  win.dispatch('keydown', { code: 'KeyW' });
  controls.joystick.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 60 });
  controller.setAssistedMovement({ x: 1, z: 0, run: false });
  assert.ok(controller.keys.size); assert.equal(controller.touchVector.x, 1); assert.ok(controller.assist);
  const original = { ...position }; assert.equal(mode.open(), true);
  assert.equal(exits, 1); assert.equal(orbit.pointerLockActive, false); assert.equal(lock.status().desired, false);
  assert.equal(controller.keys.size, 0); assert.deepEqual(controller.touchVector, { x: 0, y: 0 });
  assert.equal(controller.assist, null); assert.equal(controls.joystick.hasPointerCapture(1), false);
  win.dispatch('keydown', { code: 'KeyW' }); win.dispatch('keydown', { code: 'Space' });
  controls.joystick.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 60 });
  controller.update(.05, orbit.yaw); assert.deepEqual(position, original);
  mode.close(); assert.equal(lock.status().awaitingGesture, true); assert.equal(requests, 0);
  controls.joystick.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 60 });
  controller.update(.05, orbit.yaw); assert.deepEqual(position, original); assert.equal(controller.jumpQueued, false);
  win.dispatch('keydown', { code: 'KeyW' }); controller.update(.05, orbit.yaw);
  assert.ok(Math.hypot(position.x - original.x, position.z - original.z) > 0, 'fresh movement works after exit');
});
