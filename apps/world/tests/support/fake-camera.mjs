// A camera entity with PlayCanvas transform semantics, for Node tests without the engine:
// lookAt points -Z at the target with world up; forward is the normalized -Z axis.
const normalize = v => { const l = Math.hypot(...v); return v.map(n => n / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function quatFromBasis(x, y, z) {
  const [m00, m10, m20] = x, [m01, m11, m21] = y, [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = .5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, .25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, .25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, .25 * s, (m10 - m01) / s];
}
export function rotateByQuat([qx, qy, qz, qw], v) {
  const u = [qx, qy, qz], t = cross(u, v).map(n => n * 2), c = cross(u, t);
  return [v[0] + qw * t[0] + c[0], v[1] + qw * t[1] + c[1], v[2] + qw * t[2] + c[2]];
}

export function createFakeCameraEntity({ position = [0, 1, 0], target = [0, 1, -1], fov = 62, nearClip = .3 } = {}) {
  const p = [...position];
  let q = [0, 0, 0, 1];
  const entity = {
    name: 'Camera', camera: { fov, nearClip }, writes: 0,
    setPosition(x, y, z) { p[0] = x; p[1] = y; p[2] = z; entity.writes++; },
    getPosition() { return { x: p[0], y: p[1], z: p[2] }; },
    setRotation(x, y, z, w) { q = [x, y, z, w]; entity.writes++; },
    getRotation() { return { x: q[0], y: q[1], z: q[2], w: q[3] }; },
    lookAt(tx, ty, tz) {
      const back = normalize([p[0] - tx, p[1] - ty, p[2] - tz]);
      const right = normalize(cross([0, 1, 0], back));
      q = quatFromBasis(right, cross(back, right), back);
      entity.writes++;
    },
    get forward() { const [x, y, z] = rotateByQuat(q, [0, 0, -1]); return { x, y, z }; },
    pose() { return { position: [...p], rotation: [...q], fov: entity.camera.fov, nearClip: entity.camera.nearClip }; }
  };
  entity.lookAt(...target);
  entity.writes = 0;
  return entity;
}
