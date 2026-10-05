import { footprintWorldPoints } from "./map-reference.js";

const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function triangulateFootprint(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 1000 ||
    !points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    throw new Error("E_BUILDING_FOOTPRINT_INVALID");
  }
  const epsilon = 1e-9;
  const onSegment = (a, b, p) => Math.abs(turn(a, b, p)) <= epsilon &&
    p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon &&
    p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= epsilon) throw new Error("E_BUILDING_FOOTPRINT_INVALID");
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if ((turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) ||
        onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
        throw new Error("E_BUILDING_FOOTPRINT_SELF_INTERSECTION");
      }
    }
  }
  const area = points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(area) <= epsilon) throw new Error("E_BUILDING_FOOTPRINT_INVALID");
  const remaining = points.map((_, index) => index);
  if (area > 0) remaining.reverse();
  const indices = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (turn(points[a], points[b], points[c]) >= -epsilon) continue;
      if (remaining.some(p => p !== a && p !== b && p !== c &&
        turn(points[a], points[b], points[p]) <= epsilon &&
        turn(points[b], points[c], points[p]) <= epsilon &&
        turn(points[c], points[a], points[p]) <= epsilon)) continue;
      indices.push(a, b, c);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("E_BUILDING_FOOTPRINT_INVALID");
  }
  if (turn(...remaining.map(i => points[i])) >= -epsilon) throw new Error("E_BUILDING_FOOTPRINT_INVALID");
  return indices.concat(remaining);
}

export function createBuildingMassCandidate(reference, footprint, heightMeters) {
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) throw new Error("E_BUILDING_HEIGHT_INVALID");
  if (typeof footprint?.id !== "string" || !/^footprint\.[a-zA-Z0-9-]+$/.test(footprint.id) ||
    typeof footprint.name !== "string" || !footprint.name.trim()) throw new Error("E_BUILDING_SOURCE_INVALID");
  const points = footprintWorldPoints(reference, footprint);
  triangulateFootprint(points);
  const xs = points.map(point => point[0]), zs = points.map(point => point[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const localFootprint = points.map(([x, z]) => [x - centerX, z - centerZ]);
  return {
    id: buildingMassEntityId(footprint),
    name: footprint.name,
    kind: "building",
    transform: { position: [centerX, 0, centerZ], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    tags: ["inha-editor"],
    components: { "world.building": { footprint: localFootprint, heightMeters } }
  };
}

export function buildingMassEntityId(footprint) {
  return `entity.editor.mass.${footprint.id.replace(/^footprint\./, "")}`;
}

export function buildBuildingMassGeometry(points, heightMeters) {
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) throw new Error("E_BUILDING_HEIGHT_INVALID");
  const cap = triangulateFootprint(points);
  const positions = [], normals = [], uvs = [], indices = [];
  const area = points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length];
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0);
  const sign = area < 0 ? 1 : -1;
  const add = (x, y, z, nx, ny, nz, u, v) => {
    positions.push(x, y, z); normals.push(nx, ny, nz); uvs.push(u, v);
  };
  for (const [x, z] of points) add(x, heightMeters, z, 0, 1, 0, x, z);
  indices.push(...cap);
  const bottom = points.length;
  for (const [x, z] of points) add(x, 0, z, 0, -1, 0, x, z);
  for (let i = 0; i < cap.length; i += 3) indices.push(bottom + cap[i], bottom + cap[i + 2], bottom + cap[i + 1]);
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i], [x1, z1] = points[(i + 1) % points.length];
    const dx = x1 - x0, dz = z1 - z0, length = Math.hypot(dx, dz);
    const nx = sign * -dz / length, nz = sign * dx / length;
    const base = positions.length / 3;
    add(x0, heightMeters, z0, nx, 0, nz, 0, heightMeters);
    add(x0, 0, z0, nx, 0, nz, 0, 0);
    add(x1, heightMeters, z1, nx, 0, nz, length, heightMeters);
    add(x1, 0, z1, nx, 0, nz, length, 0);
    if (sign === 1) indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    else indices.push(base + 2, base + 1, base, base + 3, base + 1, base + 2);
  }
  return { positions, normals, uvs, indices };
}
