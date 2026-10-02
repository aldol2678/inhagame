const AXES = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
const MIN_SCALE = 0.001;

export function normalizeQuaternion(value) {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error("E_ROTATION_INVALID");
  return value.map(component => component / length);
}

export function multiplyQuaternions(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]);
}

export function inverseQuaternion(q) {
  const [x, y, z, w] = normalizeQuaternion(q);
  return [-x, -y, -z, w];
}

export function rotateVector(q, vector) {
  const [x, y, z, w] = normalizeQuaternion(q);
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

export function quaternionFromAxisAngle(axis, degrees) {
  const half = degrees * Math.PI / 360;
  const sine = Math.sin(half);
  return normalizeQuaternion(axis.map(component => component * sine).concat(Math.cos(half)));
}

export function quaternionFromEuler(degrees) {
  const [x, y, z] = degrees.map(value => value * Math.PI / 180);
  const [sx, cx] = [Math.sin(x / 2), Math.cos(x / 2)];
  const [sy, cy] = [Math.sin(y / 2), Math.cos(y / 2)];
  const [sz, cz] = [Math.sin(z / 2), Math.cos(z / 2)];
  return normalizeQuaternion([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz
  ]);
}

export function eulerFromQuaternion(quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  return [
    Math.atan2(2 * (w * x - y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(Math.max(-1, Math.min(1, 2 * (w * y + z * x)))),
    Math.atan2(2 * (w * z - x * y), 1 - 2 * (y * y + z * z))
  ].map(value => value * 180 / Math.PI);
}

export function worldTransform(world, entityId, localOverride = null) {
  const entity = world.getEntity(entityId);
  if (!entity) throw new Error(`E_ENTITY_NOT_FOUND:${entityId}`);
  const local = localOverride || entity.transform;
  if (!entity.parentId) return structuredClone(local);
  const parent = worldTransform(world, entity.parentId);
  const scaled = local.position.map((value, index) => value * parent.scale[index]);
  const offset = rotateVector(parent.rotation, scaled);
  return {
    position: parent.position.map((value, index) => value + offset[index]),
    rotation: multiplyQuaternions(parent.rotation, local.rotation),
    scale: parent.scale.map((value, index) => value * local.scale[index])
  };
}

export function worldPositionToLocal(world, entityId, position) {
  const entity = world.getEntity(entityId);
  if (!entity?.parentId) return [...position];
  const parent = worldTransform(world, entity.parentId);
  const offset = position.map((value, index) => value - parent.position[index]);
  return rotateVector(inverseQuaternion(parent.rotation), offset)
    .map((value, index) => value / parent.scale[index]);
}

export function worldRotationToLocal(world, entityId, rotation) {
  const entity = world.getEntity(entityId);
  if (!entity?.parentId) return normalizeQuaternion(rotation);
  const parent = worldTransform(world, entity.parentId);
  return multiplyQuaternions(inverseQuaternion(parent.rotation), rotation);
}

export function transformedForDrag(world, entityId, before, mode, axis, space, amount) {
  if (!Number.isFinite(amount)) throw new Error("E_TRANSFORM_AMOUNT_INVALID");
  if (!AXES[axis] && axis !== "all") throw new Error(`E_AXIS_UNKNOWN:${axis}`);
  const result = structuredClone(before);
  const worldBefore = worldTransform(world, entityId, before);

  if (mode === "move") {
    if (axis === "all") throw new Error("E_MOVE_AXIS_REQUIRED");
    const direction = space === "local" ? rotateVector(worldBefore.rotation, AXES[axis]) : AXES[axis];
    const position = worldBefore.position.map((value, index) => value + direction[index] * amount);
    result.position = worldPositionToLocal(world, entityId, position);
  } else if (mode === "rotate") {
    if (axis === "all") throw new Error("E_ROTATE_AXIS_REQUIRED");
    const rotation = quaternionFromAxisAngle(AXES[axis], amount);
    result.rotation = space === "local"
      ? multiplyQuaternions(before.rotation, rotation)
      : worldRotationToLocal(world, entityId, multiplyQuaternions(rotation, worldBefore.rotation));
  } else if (mode === "scale") {
    const factor = Math.max(MIN_SCALE, 1 + amount);
    if (axis === "all") result.scale = before.scale.map(value => Math.max(MIN_SCALE, value * factor));
    else {
      const localAxis = space === "local" ? AXES[axis] : rotateVector(inverseQuaternion(worldBefore.rotation), AXES[axis]);
      result.scale = before.scale.map((value, index) => Math.max(MIN_SCALE, value * (1 + (factor - 1) * Math.abs(localAxis[index]))));
    }
  } else throw new Error(`E_TRANSFORM_MODE_UNKNOWN:${mode}`);
  return result;
}
