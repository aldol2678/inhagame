import { cameraObstaclesNear, cameraSafeFraction, canOccupy } from '../world-collision.js';
import { MOUSE_DRAG_LOOK } from '../orbit-camera-controller.js';
import { metersToWorld } from '../world-scale.js';

// Photo Mode camera rig: the single camera-transform authority while Photo Mode is open.
// It temporarily drives the existing camera entity (no second camera or render target),
// starts from the exact on-screen pose and never reads or writes the gameplay orbit.
// Positions are gameplay world units (1 unit ≈ 2 m); the entity frame mirrors z.
export const PHOTO_CAMERA_LIMITS = Object.freeze({
  // Travel is bounded around the entry camera: enough to recompose a shot or walk around
  // the subject, never enough to slip behind a building block or outrun streamed scenery.
  radius: metersToWorld(12),
  below: metersToWorld(4),
  above: metersToWorld(6),
  floorClearance: .15,
  // lookAt keeps world up; stay clear of the vertical singularity.
  pitch: 1.45,
  fov: Object.freeze({ min: 20, max: 80 })
});

export const PHOTO_CAMERA_TUNING = Object.freeze({
  speed: metersToWorld(4.5),
  verticalSpeed: metersToWorld(3),
  // Velocity time constant: a short dolly ease-in/out, not a floaty drift.
  response: .12,
  // Same pixels-to-radians feel as the gameplay drag camera.
  look: MOUSE_DRAG_LOOK,
  precision: Object.freeze({ move: .25, look: .4, zoom: .4 }),
  maxStep: .1
});

// cameraSafeFraction reports at most .06 when a segment cannot advance (or starts in the
// .35 camera skin). Treat that as blocked; accepting it would creep through walls.
const SWEEP_BLOCKED = .0601;
const CAMERA_SHAPE = Object.freeze({ radius: .12, footOffset: .12, headOffset: .12 });
const AXES = Object.freeze(['x', 'z', 'y']);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (...values) => values.every(Number.isFinite);
const unit = n => Number.isFinite(n) ? clamp(n, -1, 1) : 0;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Orbit convention: positive pitch looks down; yaw 0 looks along +z.
export function photoCameraForward(yaw, pitch) {
  const horizontal = Math.cos(pitch);
  return { x: -Math.sin(yaw) * horizontal, y: -Math.sin(pitch), z: Math.cos(yaw) * horizontal };
}
export function photoCameraAngles(forward) {
  const length = Math.hypot(forward.x, forward.y, forward.z);
  if (!(length > 1e-9)) return null;
  return { yaw: Math.atan2(-forward.x / length, forward.z / length), pitch: -Math.asin(clamp(forward.y / length, -1, 1)) };
}

export function createPhotoCameraController({ camera, collision = null, limits = PHOTO_CAMERA_LIMITS,
  tuning = PHOTO_CAMERA_TUNING } = {}) {
  if (!camera?.setPosition || !camera?.lookAt || !camera?.camera) throw new TypeError('Photo camera requires the camera entity');
  let session = null;

  function floorAt(x, z) {
    const height = collision?.floorHeight?.(x, z);
    return Number.isFinite(height) ? height + limits.floorClearance : -Infinity;
  }
  function sweep(from, to) {
    return cameraSafeFraction([from.x, from.y, from.z], [to.x, to.y, to.z], session.obstacles, session.candidates);
  }
  function free(point) {
    return canOccupy(point, CAMERA_SHAPE, session.candidates);
  }
  // One axis of a collide-and-slide move, using the gameplay camera's own sweep authority.
  function stepAxis(from, axis, distance) {
    const to = { ...from, [axis]: from[axis] + distance };
    const fraction = sweep(from, to);
    if (fraction >= 1) return to;
    if (fraction > SWEEP_BLOCKED) return { ...from, [axis]: from[axis] + distance * fraction };
    // Blocked both ways means the camera starts inside the skin (a first-person eye at a
    // wall) or, after collision was toggled off, inside a collider. Let it move through
    // free space only, so it can leave without ever entering real geometry.
    const back = sweep(from, { ...from, [axis]: from[axis] - distance });
    if (back <= SWEEP_BLOCKED && (free(to) || !free(from))) return to;
    return from;
  }
  function clampToBounds(point) {
    const { entry } = session;
    const dx = point.x - entry.x, dz = point.z - entry.z, r = Math.hypot(dx, dz);
    const scale = r > limits.radius ? limits.radius / r : 1;
    return { x: entry.x + dx * scale, z: entry.z + dz * scale,
      y: clamp(point.y, entry.y - limits.below, entry.y + limits.above) };
  }
  function translate(dx, dy, dz) {
    if (!finite(dx, dy, dz) || (!dx && !dy && !dz)) return false;
    const start = { x: session.x, y: session.y, z: session.z };
    const target = clampToBounds({ x: start.x + dx, y: start.y + dy, z: start.z + dz });
    let point = start;
    if (session.collision) {
      for (const axis of AXES) if (target[axis] !== point[axis]) point = stepAxis(point, axis, target[axis] - point[axis]);
    } else point = target;
    const floor = floorAt(point.x, point.z);
    if (point.y < floor) point = { ...point, y: floor };
    if (!finite(point.x, point.y, point.z)) return false;
    const moved = point.x !== start.x || point.y !== start.y || point.z !== start.z;
    if (moved) { session.x = point.x; session.y = point.y; session.z = point.z; session.dirty = true; }
    return moved;
  }
  function localToWorld({ x = 0, y = 0, z = 0 }) {
    const sin = Math.sin(session.yaw), cos = Math.cos(session.yaw);
    // Planar dolly: forward follows heading only, so looking down never digs into the ground.
    return { x: -sin * z + cos * x, y, z: cos * z + sin * x };
  }
  function applyFov() {
    camera.camera.fov = session.fov;
  }
  function apply() {
    if (!session) return false;
    const f = photoCameraForward(session.yaw, session.pitch);
    camera.setPosition(session.x, session.y, -session.z);
    camera.lookAt(session.x + f.x, session.y + f.y, -(session.z + f.z));
    session.dirty = false;
    return true;
  }

  function begin(snapshot) {
    if (session || !snapshot) return false;
    const { position: p, forward, fov } = snapshot;
    const angles = forward ? photoCameraAngles(forward) : null;
    if (!p || !angles || !finite(p.x, p.y, p.z, fov) || !(fov > 0 && fov < 180)) return false;
    const obstacles = collision?.obstacles?.();
    session = {
      entry: Object.freeze({ x: p.x, y: p.y, z: p.z, yaw: angles.yaw, pitch: angles.pitch, fov }),
      x: p.x, y: p.y, z: p.z, yaw: angles.yaw, pitch: angles.pitch, fov,
      velocity: { x: 0, y: 0, z: 0 }, intent: { x: 0, y: 0, z: 0 },
      precision: false, collision: !!collision,
      obstacles, candidates: collision ? cameraObstaclesNear(p, limits.radius, obstacles) : [],
      // Ranges always contain the entry pose, so opening never snaps the view.
      pitchLimit: Math.max(limits.pitch, Math.abs(angles.pitch)),
      fovLimits: Object.freeze({ min: Math.min(limits.fov.min, fov), max: Math.max(limits.fov.max, fov) }),
      // No transform write until something changes: the first photo frame is the play frame.
      dirty: false
    };
    return true;
  }
  function end() {
    if (!session) return false;
    session = null;
    return true;
  }
  function update(dt) {
    if (!session) return false;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, tuning.maxStep) : 0;
    const v = session.velocity;
    if (step) {
      const scale = session.precision ? tuning.precision.move : 1;
      const target = localToWorld({ x: session.intent.x * tuning.speed * scale,
        y: session.intent.y * tuning.verticalSpeed * scale, z: session.intent.z * tuning.speed * scale });
      const blend = 1 - Math.exp(-step / tuning.response);
      for (const axis of AXES) v[axis] += (target[axis] - v[axis]) * blend;
      const idle = !session.intent.x && !session.intent.y && !session.intent.z;
      // Below ~4 cm/s the remaining glide is a few millimetres: come to rest so a shot taken
      // just after releasing a key is not of a still-drifting camera.
      if (idle && Math.hypot(v.x, v.y, v.z) < .02) v.x = v.y = v.z = 0;
      if (v.x || v.y || v.z) translate(v.x * step, v.y * step, v.z * step);
    }
    if (session.dirty) apply();
    return true;
  }
  // Pixel deltas from a drag; scale carries the player's mouse sensitivity.
  function look(dx, dy, { scale = 1 } = {}) {
    if (!session || !finite(dx, dy, scale)) return false;
    // A zoomed-in lens turns proportionally slower, like a real long lens.
    const k = scale * (session.precision ? tuning.precision.look : 1) * (session.fov / session.entry.fov);
    session.yaw = wrapAngle(session.yaw - dx * tuning.look.yaw * k);
    session.pitch = clamp(session.pitch + dy * tuning.look.pitch * k, -session.pitchLimit, session.pitchLimit);
    session.dirty = true;
    return true;
  }
  function setMoveIntent({ x = 0, y = 0, z = 0 } = {}) {
    if (!session) return false;
    let ix = unit(x), iz = unit(z);
    const planar = Math.hypot(ix, iz);
    if (planar > 1) { ix /= planar; iz /= planar; }
    session.intent = { x: ix, y: unit(y), z: iz };
    return true;
  }
  // Discrete local-frame step (keyboard-activated nudge controls); same bounds and collision.
  function nudge(local = {}) {
    if (!session) return false;
    const d = localToWorld({ x: unit(local.x), y: unit(local.y), z: unit(local.z) });
    const moved = translate(d.x * .25, d.y * .25, d.z * .25);
    if (session.dirty) apply();
    return moved;
  }
  function setFov(value) {
    if (!session || !Number.isFinite(value)) return false;
    session.fov = clamp(value, session.fovLimits.min, session.fovLimits.max);
    applyFov();
    return true;
  }
  // factor > 1 widens the lens (zoom out), < 1 narrows it (zoom in).
  function zoom(factor) {
    if (!session || !Number.isFinite(factor) || factor <= 0) return false;
    return setFov(session.fov * factor ** (session.precision ? tuning.precision.zoom : 1));
  }
  function reset() {
    if (!session) return false;
    const { entry } = session;
    Object.assign(session, { x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw, pitch: entry.pitch, fov: entry.fov,
      velocity: { x: 0, y: 0, z: 0 }, dirty: true });
    applyFov();
    apply();
    return true;
  }
  function snapshot() {
    if (!session) return null;
    const s = session;
    return Object.freeze({ position: Object.freeze({ x: s.x, y: s.y, z: s.z }), yaw: s.yaw, pitch: s.pitch, fov: s.fov,
      precision: s.precision, collision: s.collision, entry: s.entry, fovLimits: s.fovLimits,
      moving: !!(s.velocity.x || s.velocity.y || s.velocity.z) });
  }

  return Object.freeze({
    begin, end, update, look, setMoveIntent, nudge, zoom, setFov, reset, snapshot, apply,
    setPrecision(active) { if (!session) return false; session.precision = active === true; return true; },
    setCollision(active) { if (!session || !collision) return false; session.collision = active === true; return true; },
    distanceTo(point) {
      if (!session || !point || !finite(point.x, point.y, point.z)) return Infinity;
      return Math.hypot(session.x - point.x, session.y - point.y, session.z - point.z);
    },
    get active() { return !!session; },
    get limits() { return limits; }
  });
}
