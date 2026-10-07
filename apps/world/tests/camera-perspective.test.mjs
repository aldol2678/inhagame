import test from 'node:test';
import assert from 'node:assert/strict';
import { MOUSE_DRAG_LOOK, OrbitCameraController, POINTER_LOCK_LOOK } from '../src/orbit-camera-controller.js';

function fixture({ canUseGameplayShortcut = () => true } = {}) {
  const events = new Map(), keys = new Map();
  const button = { attrs: {}, addEventListener(type, fn) { this[type] = fn; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const panels = { 'toggle-first-person': button };
  globalThis.document = { getElementById: id => panels[id] };
  globalThis.window = { addEventListener: (type, fn) => keys.set(type, fn) };
  const canvas = { clientHeight: 800, setPointerCapture() {}, addEventListener: (type, fn) => events.set(type, fn) };
  const camera = { camera: { nearClip: .3 }, setPosition(...p) { this.position = p; }, lookAt(...p) { this.target = p; } };
  const orbit = new OrbitCameraController(camera, canvas, { canUseGameplayShortcut });
  const fire = (type, data) => events.get(type)({ preventDefault() {}, ...data });
  const key = data => keys.get('keydown')({ code: 'KeyV', preventDefault() {}, ...data });
  return { orbit, camera, button, panels, fire, key };
}

test('walking wheel and pinch share human-scale zoom limits; flight restores its own distance', () => {
  const { orbit, fire } = fixture();
  assert.equal(orbit.distance, 3.5);
  fire('wheel', { deltaY: 10000, deltaMode: 0 });
  assert.equal(orbit.distance, 7);
  fire('wheel', { deltaY: -10000, deltaMode: 0 });
  assert.equal(orbit.distance, 1.5);
  fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  fire('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 });
  fire('pointermove', { pointerId: 2, clientX: 1, clientY: 0 });
  assert.equal(orbit.distance, 7);
  orbit.setMounted(true);
  assert.equal(orbit.distance, Math.hypot(7.3, 18.5));
  orbit.zoom(100);
  assert.equal(orbit.distance, 36);
  orbit.setMounted(false);
  assert.equal(orbit.distance, 7);
  orbit.setMounted(true);
  assert.equal(orbit.distance, 36);
});

test('V and mobile button toggle perspective; typing, modifiers and repeat do not', () => {
  const { orbit, camera, button, key } = fixture();
  for (const event of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { target: { tagName: 'INPUT' } }, { target: { isContentEditable: true } }]) {
    key(event); assert.equal(orbit.firstPerson, false);
  }
  key({});
  assert.equal(orbit.firstPerson, true);
  assert.equal(camera.camera.nearClip, .05);
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(button.textContent, '👁 3인칭으로');
  button.click();
  assert.equal(orbit.firstPerson, false);
  assert.equal(camera.camera.nearClip, .3);
});

test('input focus gate blocks V and the perspective button without mutating camera state', () => {
  let allowed = false;
  const { orbit, button, key } = fixture({ canUseGameplayShortcut: () => allowed });

  key({});
  assert.equal(orbit.firstPerson, false);
  button.click();
  assert.equal(orbit.firstPerson, false);

  allowed = true;
  key({});
  assert.equal(orbit.firstPerson, true);
  button.click();
  assert.equal(orbit.firstPerson, false);
});

test('Pointer Lock mouse look rotates without drag, clamps pitch and leaves drag fallback available after unlock', () => {
  const { orbit, fire } = fixture();
  const startYaw = orbit.yaw;
  const startPitch = orbit.pitch;

  orbit.setPointerLockActive(true);
  assert.equal(orbit.pointerLook(100, -1000), true);
  assert.equal(orbit.yaw, startYaw - 100 * POINTER_LOCK_LOOK.yaw);
  assert.equal(orbit.pitch, -1.25);

  // While locked, mouse pointer drag state is not captured.
  fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
  assert.equal(orbit.pointers.size, 0);

  orbit.setPointerLockActive(false);
  assert.equal(orbit.pointerLook(10, 10), false);
  orbit.pitch = startPitch;
  fire('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: 20, clientY: 10 });
  assert.notEqual(orbit.yaw, startYaw - 100 * POINTER_LOCK_LOOK.yaw, 'legacy drag fallback works after unlock');
});

test('mouse sensitivity and invert-Y affect Pointer Lock and mouse-drag fallback but not touch drag', () => {
  const { orbit, fire } = fixture();
  orbit.setMouseLookSettings({ sensitivity: 2, invertY: true });

  const startYaw = orbit.yaw;
  const startPitch = orbit.pitch;
  orbit.setPointerLockActive(true);
  orbit.pointerLook(10, 20);
  assert.equal(orbit.yaw, startYaw - 10 * POINTER_LOCK_LOOK.yaw * 2);
  assert.equal(orbit.pitch, startPitch - 20 * POINTER_LOCK_LOOK.pitch * 2);

  orbit.setPointerLockActive(false);
  orbit.yaw = 0;
  orbit.pitch = 0;
  fire('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 3, pointerType: 'mouse', clientX: 10, clientY: 20 });
  assert.equal(orbit.yaw, -10 * MOUSE_DRAG_LOOK.yaw * 2);
  assert.equal(orbit.pitch, -20 * MOUSE_DRAG_LOOK.pitch * 2);
  fire('pointerup', { pointerId: 3 });

  orbit.yaw = 0;
  orbit.pitch = 0;
  fire('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 20 });
  assert.equal(orbit.yaw, -10 * MOUSE_DRAG_LOOK.yaw, 'touch camera ignores mouse sensitivity');
  assert.equal(orbit.pitch, 20 * MOUSE_DRAG_LOOK.pitch, 'touch camera ignores mouse invert-Y');
});

test('mouse sensitivity is clamped to the supported desktop range', () => {
  const { orbit } = fixture();
  assert.deepEqual(orbit.setMouseLookSettings({ sensitivity: 99, invertY: true }), { sensitivity: 2, invertY: true });
  assert.deepEqual(orbit.setMouseLookSettings({ sensitivity: 0.01, invertY: false }), { sensitivity: 0.5, invertY: false });
  assert.deepEqual(orbit.setMouseLookSettings({ sensitivity: 'bad', invertY: true }), { sensitivity: 1, invertY: true });
});

test('third person looks upward without dropping the chase camera below its safe orbit floor on mouse or touch', () => {
  const { orbit, camera, fire } = fixture();
  const position = { x: 0, y: 1.15, z: -98 };
  orbit.pitch = 0.12;
  orbit.apply(position, -.35);
  const safeFloorY = camera.position[1];

  fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: -1000 });
  assert.equal(orbit.pitch, -1.25);
  orbit.apply(position, -.35);
  assert.ok(Math.abs(camera.position[1] - safeFloorY) < 1e-9);
  assert.ok(camera.target[1] > camera.position[1], 'negative third-person pitch looks above the camera');
  fire('pointerup', { pointerId: 1 });

  orbit.pitch = 0.12;
  fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 0, clientY: -1000 });
  assert.equal(orbit.pitch, -1.25);
});

test('first person follows eye height and world yaw, looks up/down and preserves third-person zoom', () => {
  const { orbit, camera, fire } = fixture();
  const thirdPitch = orbit.pitch;
  orbit.togglePerspective();
  orbit.zoom(100);
  assert.equal(orbit.distance, 3.5);
  orbit.apply({ x: 0, y: 1.15, z: -98 }, -.35);
  assert.ok(Math.abs(camera.position[1] - .8) < 1e-9);
  assert.deepEqual(camera.target, [0, camera.position[1], 97]);
  fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  fire('pointermove', { pointerId: 1, clientX: 0, clientY: -1000 });
  assert.equal(orbit.pitch, -1.35);
  orbit.apply({ x: 0, y: 2.8, z: -98 }, -.35);
  assert.ok(camera.target[1] > camera.position[1]);
  assert.ok(Math.abs(camera.position[1] - 2.45) < 1e-9);
  orbit.setMounted(true);
  orbit.apply({ x: 0, y: 8, z: -98 }, 1.35);
  assert.equal(camera.position[1], 9.35);
  orbit.togglePerspective();
  assert.equal(orbit.pitch, thirdPitch);
  orbit.setMounted(false);
  assert.equal(orbit.distance, 3.5);
  orbit.togglePerspective();
  assert.equal(orbit.pitch, -1.35);
});

test('Annyongi frames the compact mascot without changing other flight cameras or walking zoom', () => {
  const {orbit,camera}=fixture();globalThis.document.body={dataset:{mountId:'annyongi'}};
  orbit.setMounted(true);assert.equal(orbit.distance,7.4);assert.equal(orbit.zoomLimits.min,4.5);
  orbit.apply({x:0,y:3,z:-98});assert.equal(orbit.target.y,3.3);
  assert.ok(Math.abs(orbit.target.z-(-98+.2))<1e-9);
  orbit.zoom(1.4);assert.equal(orbit.distance,7.4*1.4);orbit.setMounted(false);assert.equal(orbit.distance,3.5);
  globalThis.document.body.dataset.mountId='mount.campus_helicopter.prototype';
  orbit.setMounted(true);assert.equal(orbit.distance,Math.hypot(7.3,18.5));assert.equal(orbit.zoomLimits.min,12);
  orbit.apply({x:0,y:3,z:-98});assert.equal(orbit.target.y,5.1);
  orbit.setMounted(false);globalThis.document.body.dataset.mountId='annyongi';orbit.setMounted(true);assert.equal(orbit.distance,7.4*1.4);
  orbit.togglePerspective();orbit.apply({x:0,y:3,z:-98},1);assert.equal(camera.position[1],4);
});

test('Annyongi portrait framing adds bounded wing room, keeps zoom memory and restores walking', () => {
  const {orbit,camera}=fixture();globalThis.document.body={dataset:{mountId:'annyongi'}};
  orbit.setMounted(true);camera.camera.aspectRatio=390/844;
  orbit.apply({x:0,y:10,z:-98});
  const distance=Math.hypot(camera.position[0]-orbit.target.x,camera.position[1]-orbit.target.y,camera.position[2]+orbit.target.z);
  assert.ok(Math.abs(distance-7.4*1.35)<1e-6);
  assert.equal(orbit.distance,7.4,'aspect does not overwrite preferred zoom');
  camera.camera.aspectRatio=1280/800;orbit.apply({x:0,y:10,z:-98});
  const landscape=Math.hypot(camera.position[0]-orbit.target.x,camera.position[1]-orbit.target.y,camera.position[2]+orbit.target.z);
  assert.ok(Math.abs(landscape-7.4)<1e-6);
  orbit.setMounted(false);assert.equal(orbit.distance,3.5);
});
