import { moveAroundPolygons, polygonOverlap } from './polygon-collision.js';

function polygonBounds(ring) {
  const xs = ring.map((p) => p.x),
    zs = ring.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}
const shape = { radius: 0.6, footOffset: 0, headOffset: 2.2 };
function insideBounds(x, z, b) {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}
function triangleHeight(x, z, a, b, c) {
  const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(det) < 1e-10) return null;
  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
  const w = 1 - u - v;
  return Math.min(u, v, w) >= -1e-8 ? u * a.y + v * b.y + w * c.y : null;
}
export function createSpatial(layout) {
  const { bounds, spawn, rooms } = layout;
  const bodies = layout.obstacles.map((o) => ({ ...o, bounds: polygonBounds(o.polygon) }));
  const floors = layout.stairs
    .concat(layout.depressions)
    .map((f) => ({ ...f, bounds: polygonBounds(f.ring) }));
  const cells = layout.cells.map((ring) => ({ ring, bounds: polygonBounds(ring) }));
  function groundHeight(x, z) {
    for (const f of floors) if (insideBounds(x, z, f.bounds) && polygonOverlap(x, z, f.ring)) return f.y;
    for (const { ring, bounds: b } of cells) {
      if (!insideBounds(x, z, b)) continue;
      const [a, b1, c, d] = ring;
      const y = triangleHeight(x, z, a, b1, c) ?? triangleHeight(x, z, a, c, d);
      if (y !== null) return y;
    }
    return 0;
  }
  function nearby(x, z, nx, nz) {
    const r = shape.radius,
      loX = Math.min(x, nx) - r,
      hiX = Math.max(x, nx) + r,
      loZ = Math.min(z, nz) - r,
      hiZ = Math.max(z, nz) + r;
    return bodies.filter(
      ({ bounds: b }) => b.maxX >= loX && b.minX <= hiX && b.maxZ >= loZ && b.minZ <= hiZ,
    );
  }
  function canStand(x, z) {
    if (!insideBounds(x, z, bounds)) return false;
    const y = groundHeight(x, z);
    return nearby(x, z, x, z).every(
      (o) =>
        y >= o.maxY || y + shape.headOffset <= o.minY || !polygonOverlap(x, z, o.polygon, shape.radius),
    );
  }
  function move(x, z, dx, dz) {
    const p = moveAroundPolygons(
      { x, z, y: groundHeight(x, z) },
      dx,
      dz,
      nearby(x, z, x + dx, z + dz),
      shape,
    );
    const nx = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
    const nz = Math.max(bounds.minZ, Math.min(bounds.maxZ, p.z));
    return canStand(nx, nz) ? { x: nx, z: nz } : { x, z };
  }
  for (const p of [spawn, ...Object.values(rooms)])
    if (!canStand(p.x, p.z)) throw Error('Occupied map arrival point');
  return { rooms, spawn, groundHeight, canStand, move };
}
