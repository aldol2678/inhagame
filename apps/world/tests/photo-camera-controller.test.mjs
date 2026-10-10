import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCameraController, photoCameraAngles, photoCameraForward,
  PHOTO_CAMERA_LIMITS, PHOTO_CAMERA_TUNING } from '../src/photo/photo-camera-controller.js';
import { cameraObstaclesNear, cameraSafeFraction } from '../src/world-collision.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';

// Gameplay frame <-> PlayCanvas entity frame (z mirrored), exactly as PhotoMode snapshots it.
const playSnapshot = entity => {
  const p = entity.getPosition(), f = entity.forward;
  return { position: { x: p.x, y: p.y, z: -p.z }, forward: { x: f.x, y: f.y, z: -f.z }, fov: entity.camera.fov };
};
const close = (actual, expected, epsilon = 1e-9, label = '') =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label} ${actual} ≈ ${expected}`);
function rig({ position = [10, 2, -20], target = [10, 1.6, -24], fov = 62, collision = null } = {}) {
  const camera = createFakeCameraEntity({ position, target, fov });
  const controller = createPhotoCameraController({ camera, collision });
  assert.equal(controller.begin(playSnapshot(camera)), true);
  return { camera, controller, entry: camera.pose() };
}
const run = (controller, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) controller.update(dt); };
const position = controller => controller.snapshot().position;

test('entry keeps the exact on-screen pose: no transform write until the photographer moves', () => {
  const { camera, controller, entry } = rig();
  run(controller, .5);
  assert.equal(camera.writes, 0, 'idle frames never rewrite the camera');
  assert.deepEqual(camera.pose(), entry);
  // Reconstructing from the derived yaw/pitch reproduces the same view direction.
  controller.apply();
  const f = camera.forward, e = createFakeCameraEntity({ position: [10, 2, -20], target: [10, 1.6, -24] }).forward;
  for (const axis of ['x', 'y', 'z']) close(f[axis], e[axis], 1e-12, axis);
  close(camera.getPosition().z, -20, 0, 'entity frame keeps mirrored z');
});

test('angles and forward vectors share the orbit convention (positive pitch looks down)', () => {
  for (const [yaw, pitch] of [[0, 0], [1.2, .4], [-2.6, -1.1], [3, 1.4]]) {
    const back = photoCameraAngles(photoCameraForward(yaw, pitch));
    close(back.yaw, yaw, 1e-12); close(back.pitch, pitch, 1e-12);
  }
  assert.ok(photoCameraForward(0, .5).y < 0);
  assert.equal(photoCameraAngles({ x: 0, y: 0, z: 0 }), null);
});

test('free look turns like the gameplay drag camera, clamps pitch and slows when zoomed in', () => {
  const { controller } = rig();
  const before = controller.snapshot();
  controller.look(100, 0);
  close(controller.snapshot().yaw, before.yaw - 100 * PHOTO_CAMERA_TUNING.look.yaw, 1e-12, 'drag right turns right');
  controller.look(0, 1e6); close(controller.snapshot().pitch, PHOTO_CAMERA_LIMITS.pitch, 0, 'pitch max');
  controller.look(0, -1e6); close(controller.snapshot().pitch, -PHOTO_CAMERA_LIMITS.pitch, 0, 'pitch min');
  for (let i = 0; i < 200; i++) controller.look(5000, 0);
  assert.ok(Math.abs(controller.snapshot().yaw) <= Math.PI, 'yaw stays wrapped');
  controller.reset(); controller.setFov(31);
  const yaw = controller.snapshot().yaw; controller.look(100, 0);
  close(controller.snapshot().yaw, yaw - 100 * PHOTO_CAMERA_TUNING.look.yaw * .5, 1e-12, 'half FOV turns at half rate');
});

test('planar dolly moves along the view heading, strafes and rises without touching pitch', () => {
  const { controller } = rig();
  const start = position(controller), { yaw, pitch } = controller.snapshot();
  controller.setMoveIntent({ z: 1 }); run(controller, 1);
  const forward = position(controller);
  const dx = forward.x - start.x, dz = forward.z - start.z, distance = Math.hypot(dx, dz);
  assert.ok(distance > PHOTO_CAMERA_TUNING.speed * .8 && distance < PHOTO_CAMERA_TUNING.speed, `eased forward ${distance}`);
  close(dx / distance, -Math.sin(yaw), 1e-9, 'heading x'); close(dz / distance, Math.cos(yaw), 1e-9, 'heading z');
  close(forward.y, start.y, 1e-12, 'looking down never digs into the ground');
  controller.setMoveIntent({}); run(controller, 1);
  const halted = position(controller);
  controller.setMoveIntent({ x: 1 }); run(controller, .5);
  const strafe = position(controller);
  close((strafe.x - halted.x) * -Math.sin(yaw) + (strafe.z - halted.z) * Math.cos(yaw), 0, 1e-9, 'strafe is perpendicular');
  assert.ok((strafe.x - halted.x) * Math.cos(yaw) + (strafe.z - halted.z) * Math.sin(yaw) > .5, 'D strafes right');
  controller.setMoveIntent({ y: 1 }); run(controller, .5);
  const raised = position(controller);
  assert.ok(raised.y > strafe.y + .5, 'E rises');
  controller.setMoveIntent({}); run(controller, 1);
  const top = position(controller).y;
  controller.setMoveIntent({ y: -1 }); run(controller, .3);
  assert.ok(position(controller).y < top - .2, 'Q lowers');
  controller.setMoveIntent({}); run(controller, .7);
  const settled = position(controller); run(controller, .2);
  assert.deepEqual(position(controller), settled, 'releasing input settles to a complete stop');
  assert.equal(controller.snapshot().moving, false); assert.equal(controller.snapshot().pitch, pitch);
});

test('precision mode scales translation, look and zoom', () => {
  const normal = rig(), precise = rig();
  precise.controller.setPrecision(true);
  for (const { controller } of [normal, precise]) { controller.setMoveIntent({ z: 1 }); run(controller, 1); }
  const travel = ({ controller }) => Math.hypot(position(controller).x - 10, position(controller).z - 20);
  close(travel(precise) / travel(normal), PHOTO_CAMERA_TUNING.precision.move, 1e-9, 'translation');
  normal.controller.reset(); precise.controller.reset();
  normal.controller.look(100, 0); precise.controller.look(100, 0);
  const turn = ({ controller }) => controller.snapshot().yaw - controller.snapshot().entry.yaw;
  close(turn(precise) / turn(normal), PHOTO_CAMERA_TUNING.precision.look, 1e-9, 'look');
  normal.controller.zoom(.5); precise.controller.zoom(.5);
  close(precise.controller.snapshot().fov, 62 * .5 ** PHOTO_CAMERA_TUNING.precision.zoom, 1e-9, 'zoom');
});

test('travel is bounded around the entry camera and never under the floor', () => {
  const floor = 1;
  const { controller } = rig({ collision: { obstacles: () => [], floorHeight: () => floor } });
  const entry = controller.snapshot().entry;
  controller.setMoveIntent({ z: 1, x: .4 }); run(controller, 20, .05);
  const far = position(controller);
  close(Math.hypot(far.x - entry.x, far.z - entry.z), PHOTO_CAMERA_LIMITS.radius, 1e-9, 'horizontal radius');
  controller.setMoveIntent({ y: 1 }); run(controller, 20, .05);
  close(position(controller).y, entry.y + PHOTO_CAMERA_LIMITS.above, 1e-9, 'ceiling');
  controller.setMoveIntent({ y: -1 }); run(controller, 20, .05);
  close(position(controller).y, Math.max(entry.y - PHOTO_CAMERA_LIMITS.below, floor + PHOTO_CAMERA_LIMITS.floorClearance), 1e-9, 'floor');
  controller.reset(); controller.setMoveIntent({ y: -1 }); run(controller, 20, .05);
  close(position(controller).y, floor + PHOTO_CAMERA_LIMITS.floorClearance, 1e-9, 'terrain floor wins over vertical band');
});

test('zoom changes FOV within limits and an unusual entry FOV is preserved, not snapped', () => {
  const { controller, camera } = rig();
  controller.zoom(.5); close(camera.camera.fov, 31, 1e-9);
  controller.zoom(1e-6); assert.equal(camera.camera.fov, PHOTO_CAMERA_LIMITS.fov.min);
  controller.zoom(1e6); assert.equal(camera.camera.fov, PHOTO_CAMERA_LIMITS.fov.max);
  const wide = rig({ fov: 95 });
  assert.equal(wide.camera.camera.fov, 95); assert.equal(wide.controller.snapshot().fovLimits.max, 95);
  wide.controller.zoom(.5); wide.controller.zoom(4); assert.equal(wide.camera.camera.fov, 95);
});

test('reset returns to the entry pose and lens; end releases ownership', () => {
  const { controller, camera, entry } = rig();
  controller.look(300, 80); controller.zoom(.6); controller.setMoveIntent({ z: 1, y: 1 }); run(controller, 1);
  assert.notDeepEqual(camera.pose().position, entry.position);
  controller.reset();
  for (let i = 0; i < 3; i++) close(camera.pose().position[i], entry.position[i], 1e-12);
  for (let i = 0; i < 4; i++) close(Math.abs(camera.pose().rotation[i]), Math.abs(entry.rotation[i]), 1e-9);
  assert.equal(camera.camera.fov, 62); assert.equal(controller.snapshot().moving, false);
  assert.equal(controller.end(), true); assert.equal(controller.end(), false);
  const writes = camera.writes;
  assert.equal(controller.update(1 / 60), false); assert.equal(controller.look(10, 10), false);
  assert.equal(controller.zoom(.5), false); assert.equal(controller.reset(), false); assert.equal(camera.writes, writes);
});

test('NaN and Infinity never corrupt the pose, lens or velocity', () => {
  const { controller, camera } = rig();
  const before = controller.snapshot();
  controller.look(NaN, 1); controller.look(1, Infinity); controller.look(1, 1, { scale: NaN });
  controller.zoom(NaN); controller.zoom(Infinity); controller.zoom(-2); controller.zoom(0); controller.setFov(NaN);
  controller.setMoveIntent({ x: NaN, y: Infinity, z: -Infinity });
  controller.update(NaN); controller.update(Infinity); controller.update(-1);
  const after = controller.snapshot();
  assert.deepEqual(after.position, before.position); assert.equal(after.yaw, before.yaw);
  assert.equal(after.pitch, before.pitch); assert.equal(camera.camera.fov, 62);
  controller.setMoveIntent({ z: Infinity }); run(controller, .2);
  assert.ok(Object.values(position(controller)).every(Number.isFinite));
  const bad = createPhotoCameraController({ camera: createFakeCameraEntity() });
  assert.equal(bad.begin({ position: { x: NaN, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, fov: 62 }), false);
  assert.equal(bad.begin({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 0 }, fov: 62 }), false);
  assert.equal(bad.begin({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, fov: Infinity }), false);
  assert.equal(bad.active, false);
});

// A wall 2 units ahead of the camera along +z (gameplay frame).
const WALL = Object.freeze({ id: 'qa-wall', minX: 5, maxX: 15, minY: 0, maxY: 6, minZ: 22, maxZ: 23 });
const wallRig = (z = 20) => rig({ position: [10, 2, -z], target: [10, 2, -z - 1], collision: { obstacles: () => [WALL], floorHeight: () => 0 } });

test('collision reuses the gameplay camera sweep: stops before a wall and slides along it', () => {
  const { controller } = wallRig();
  controller.setMoveIntent({ z: 1 }); run(controller, 4);
  const stopped = position(controller);
  assert.ok(stopped.z < WALL.minZ - .3 && stopped.z > WALL.minZ - .5, `stopped in front of the skin at ${stopped.z}`);
  controller.setMoveIntent({ z: 1, x: 1 }); run(controller, 1);
  const slid = position(controller);
  assert.ok(slid.x > stopped.x + .5, 'diagonal input slides along the wall'); assert.ok(slid.z < WALL.minZ - .3);
  controller.setCollision(false); controller.setMoveIntent({ z: 1 }); run(controller, 2);
  assert.ok(position(controller).z > WALL.minZ, 'collision off is a deliberate pass-through');
});

test('a camera that starts inside the skin escapes through free space but cannot enter the collider', () => {
  const inside = wallRig(WALL.minZ - .2);
  inside.controller.setMoveIntent({ z: 1 }); run(inside.controller, 3);
  assert.ok(position(inside.controller).z < WALL.minZ - .1, `real wall holds at ${position(inside.controller).z}`);
  inside.controller.setMoveIntent({ z: -1 }); run(inside.controller, 1);
  assert.ok(position(inside.controller).z < WALL.minZ - 1, 'backing away leaves the skin');
  const buried = wallRig(WALL.minZ + .5);
  buried.controller.setMoveIntent({ z: -1 }); run(buried.controller, 2);
  assert.ok(position(buried.controller).z < WALL.minZ - .35, 'a camera inside a collider can always get out');
});

test('broad phase keeps the Campus sweep policy and drops only obstacles beyond the camera skin', async () => {
  const { OBSTACLES } = await import('../src/campus-layout.js');
  const { inMainGateCameraArea } = await import('../src/main-gate-camera-collision.js');
  const footprint = box => box.polygon ? {
    minX: Math.min(...box.polygon.map(p => p.x)), maxX: Math.max(...box.polygon.map(p => p.x)),
    minZ: Math.min(...box.polygon.map(p => p.z)), maxZ: Math.max(...box.polygon.map(p => p.z)) } : box;
  // Distance from a horizontal segment to an AABB, sampled finely enough for a lower bound.
  const gap = (from, to, b) => Math.min(...Array.from({ length: 65 }, (_, i) => {
    const x = from[0] + (to[0] - from[0]) * i / 64, z = from[2] + (to[2] - from[2]) * i / 64;
    return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
  }));
  const samples = [[0, 2, -98], [0, 3.25, -90], [119.9, 2, 32.1], [-40, 2.5, 10], [60, 1.8, -60]];
  let mainGateSegments = 0;
  for (const [x, y, z] of samples) {
    const candidates = cameraObstaclesNear({ x, z }, PHOTO_CAMERA_LIMITS.radius), kept = new Set(candidates);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, r = PHOTO_CAMERA_LIMITS.radius * (.3 + (i % 3) * .3);
      const from = [x, y, z], to = [x + Math.cos(a) * r, y + (i % 4) * .5 - .5, z + Math.sin(a) * r];
      const narrowed = cameraSafeFraction(from, to, undefined, candidates), full = cameraSafeFraction(from, to);
      if (inMainGateCameraArea(from)) { mainGateSegments++; assert.equal(narrowed, full, `main gate ${from} -> ${to}`); }
      if (narrowed === full) continue;
      assert.ok(narrowed > full, 'the broad phase never adds a hit');
      // The only differences are the known far "triangulation tip" phantoms of sliver polygons.
      for (const box of OBSTACLES) {
        if (kept.has(box) || cameraSafeFraction(from, to, [box]) >= 1) continue;
        assert.ok(gap(from, to, footprint(box)) > .35, `${box.id} would be a genuine hit for ${from} -> ${to}`);
      }
    }
  }
  assert.ok(mainGateSegments > 0, 'samples cover the main-gate policy');
  assert.deepEqual(cameraObstaclesNear({ x: 0, z: 0 }, 1, [WALL]), []);
  assert.deepEqual(cameraObstaclesNear({ x: 10, z: 21 }, 1, [WALL]), [WALL]);
});
