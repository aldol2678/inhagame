// Reality Base Runtime Adapter: bridges canonical WGS84 reality data to PlayCanvas runtime.
// Canonical source: apps/world/data/reality/campus-landmarks.json.
// Coordinates stay in canonical data; runtime geometry is derived here.

import { geoToWorld } from "./geo-coordinates.js";

// Load canonical landmarks data isomorphically across Browser and Node.js.
let canonicalData = null;
if (new URL(import.meta.url).protocol !== "file:") {
  const url = new URL("../data/reality/campus-landmarks.json", import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Canonical landmarks load failed: ${res.status}`);
  canonicalData = await res.json();
} else {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../data/reality/campus-landmarks.json", import.meta.url);
  canonicalData = JSON.parse(readFileSync(url, "utf8"));
}

export function getCanonicalLandmark(id) {
  const landmark = canonicalData.landmarks.find((l) => l.id === id);
  if (!landmark) throw new Error(`Canonical landmark '${id}' not found`);
  return landmark;
}

export const CANONICAL_AGORA = Object.freeze(getCanonicalLandmark("lmk_agora_plaza"));

/** Project a closed WGS84 [lat, lon] ring without inventing or shifting vertices. */
export function projectPolygon(polygon, project = geoToWorld, { closed = false } = {}) {
  if (!Array.isArray(polygon) || polygon.length < 4 || polygon.some(p =>
    !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) ||
    Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) {
    throw new Error("Expected a finite WGS84 polygon ring");
  }
  const first = polygon[0], last = polygon.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("Polygon ring must be closed");
  const vertices = (closed ? polygon : polygon.slice(0, -1)).map(([lat, lon]) => project(lat, lon));
  if (vertices.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    throw new Error("Polygon projection must be finite");
  }
  return vertices;
}

/**
 * Returns the raw WGS84 [lat, lon] polygon vertices (including closing vertex).
 */
export function getAgoraWgs84Polygon() {
  return CANONICAL_AGORA.polygon;
}

/**
 * Returns the canonical WGS84 centroid { lat, lon }.
 */
export function getAgoraCanonicalCentroid() {
  return { lat: CANONICAL_AGORA.lat, lon: CANONICAL_AGORA.lon };
}

/**
 * Returns runtime world-space vertices { x, z } for the 7 unique vertices of the polygon.
 */
export function getAgoraRuntimePolygon(project = geoToWorld) {
  // Omit the closing 8th vertex (which equals the 1st) for unique vertex math
  return projectPolygon(CANONICAL_AGORA.polygon, project);
}

/**
 * Returns all runtime world-space vertices { x, z } including the closing vertex (length 8).
 */
export function getAgoraRuntimePolygonClosed(project = geoToWorld) {
  return projectPolygon(CANONICAL_AGORA.polygon, project, { closed: true });
}

/** Area-weighted centroid for a non-degenerate projected polygon. */
export function computePolygonCentroid(vertices) {
  let area2 = 0, x = 0, z = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    const cross = p.x * q.z - q.x * p.z;
    area2 += cross;
    x += (p.x + q.x) * cross;
    z += (p.z + q.z) * cross;
  }
  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-9) throw new Error("Degenerate polygon");
  return { x: x / (3 * area2), z: z / (3 * area2) };
}

const turn = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** Ear clipping for simple concave/convex rings, either winding, no holes.
 * Returns clockwise X/Z triangles so their 3D normals point upward.
 * A fan would fill areas outside the concave pond shoreline.
 */
export function triangulatePolygon(vertices) {
  const eps = 1e-9;
  if (vertices.length < 3 || vertices.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    throw new Error("Expected finite polygon vertices");
  }
  if (new Set(vertices.map(p => `${p.x},${p.z}`)).size !== vertices.length) {
    throw new Error("Expected unique polygon vertices without closure");
  }
  const onSegment = (a, b, p) => Math.abs(turn(a, b, p)) <= eps &&
    p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps &&
    p.z >= Math.min(a.z, b.z) - eps && p.z <= Math.max(a.z, b.z) + eps;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      const c = vertices[j], d = vertices[(j + 1) % vertices.length];
      if ((turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) ||
        onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
        throw new Error("Polygon must not self-intersect");
      }
    }
  }
  const signedArea2 = vertices.reduce((sum, p, i) => {
    const q = vertices[(i + 1) % vertices.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0);
  if (Math.abs(signedArea2) <= eps) throw new Error("Degenerate polygon");
  const remaining = vertices.map((_, i) => i);
  if (signedArea2 > 0) remaining.reverse();
  const triangles = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (turn(vertices[a], vertices[b], vertices[c]) >= -eps) continue;
      if (remaining.some(p => p !== a && p !== b && p !== c &&
        turn(vertices[a], vertices[b], vertices[p]) <= eps &&
        turn(vertices[b], vertices[c], vertices[p]) <= eps &&
        turn(vertices[c], vertices[a], vertices[p]) <= eps)) continue;
      triangles.push(a, b, c);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("Cannot triangulate polygon without changing its boundary");
  }
  if (turn(...remaining.map(i => vertices[i])) >= -eps) throw new Error("Degenerate final triangle");
  return triangles.concat(remaining);
}

/** Flat surface only: no inferred islands, banks, thickness or colliders. */
export function buildPolygonSurfaceGeometry(vertices, { y = 0.025 } = {}) {
  if (!Number.isFinite(y)) throw new Error("Surface elevation must be finite");
  const indices = triangulatePolygon(vertices);
  const bounds = computePolygonBounds(vertices);
  return {
    positions: vertices.flatMap(p => [p.x, y, p.z]),
    normals: vertices.flatMap(() => [0, 1, 0]),
    uvs: vertices.flatMap(p => [(p.x - bounds.minX) / (bounds.maxX - bounds.minX || 1),
      (p.z - bounds.minZ) / (bounds.maxZ - bounds.minZ || 1)]),
    indices, bounds
  };
}

export function createPolygonSurface(pc, device, polygon, options = {}) {
  const { positions, normals, uvs, indices } = buildPolygonSurfaceGeometry(projectPolygon(polygon), options);
  return pc.createMesh(device, positions, { normals, uvs, indices });
}

/**
 * Returns runtime world-space centroid { x, z }.
 */
export function getAgoraRuntimeCentroid(project = geoToWorld) {
  return project(CANONICAL_AGORA.lat, CANONICAL_AGORA.lon);
}

/**
 * Calculates 2D bounding box { minX, maxX, minZ, maxZ } for a vertex array.
 */
export function computePolygonBounds(vertices) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Calculates 2D area in World Units squared (WU²) using shoelace formula.
 */
export function computePolygonAreaWU(vertices) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const next = (i + 1) % vertices.length;
    sum += vertices[i].x * vertices[next].z - vertices[next].x * vertices[i].z;
  }
  return Math.abs(sum) / 2;
}

/**
 * Calculates 2D area in square metres (1 WU ≈ 2 m, 1 WU² ≈ 4 m²).
 */
export function computePolygonAreaSqm(vertices) {
  return computePolygonAreaWU(vertices) * 4;
}

/**
 * Finds the western perimeter entrance X coordinate for the walkway at a given Z level.
 * Western perimeter runs from V6 to V0.
 */
export function getAgoraPavingWestEntranceX(walkwayZ, project = geoToWorld) {
  const pts = getAgoraRuntimePolygon(project);
  // Edge from V6 to V0
  const v6 = pts[6];
  const v0 = pts[0];
  const dz = v0.z - v6.z;
  const t = dz !== 0 ? (walkwayZ - v6.z) / dz : 0;
  return v6.x + t * (v0.x - v6.x);
}

/**
 * Generates raw 3D mesh arrays (positions, normals, uvs, indices) for a polygonal slab.
 * Simple convex or concave polygon, either input winding.
 * Ear-clipped caps preserve setbacks; perimeter quads have crisp outward normals.
 */
export function buildPolygonMeshGeometry(vertices, {
  yBase = 0,
  height = 0.09,
  scale = 1.0,
  center = null
} = {}) {
  const c = center || {
    x: vertices.reduce((s, p) => s + p.x, 0) / vertices.length,
    z: vertices.reduce((s, p) => s + p.z, 0) / vertices.length
  };

  const area2 = vertices.reduce((sum,p,i) => sum + p.x*vertices[(i+1)%vertices.length].z - vertices[(i+1)%vertices.length].x*p.z, 0);
  if (area2 > 0) vertices = [...vertices].reverse();
  const scaledPts = vertices.map((p) => ({
    x: c.x + (p.x - c.x) * scale,
    z: c.z + (p.z - c.z) * scale
  }));

  const bounds = computePolygonBounds(scaledPts);
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanZ = bounds.maxZ - bounds.minZ || 1;
  const yTop = yBase + height;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // 1. Top face
  for (const p of scaledPts) {
    positions.push(p.x, yTop, p.z);
    normals.push(0, 1, 0);
    uvs.push((p.x - bounds.minX) / spanX, (p.z - bounds.minZ) / spanZ);
  }
  const cap = triangulatePolygon(scaledPts);
  indices.push(...cap);

  // 2. Bottom face
  const botStart = scaledPts.length;
  for (const p of scaledPts) {
    positions.push(p.x, yBase, p.z);
    normals.push(0, -1, 0);
    uvs.push((p.x - bounds.minX) / spanX, (p.z - bounds.minZ) / spanZ);
  }
  for (let i = 0; i < cap.length; i += 3) indices.push(botStart+cap[i],botStart+cap[i+2],botStart+cap[i+1]);

  // 3. Side skirts
  for (let i = 0; i < scaledPts.length; i++) {
    const nextI = (i + 1) % scaledPts.length;
    const p0 = scaledPts[i];
    const p1 = scaledPts[nextI];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    // Outward 2D normal for CW polygon edge is (-dz/len, dx/len)
    const nx = -dz / len;
    const nz = dx / len;

    const baseIdx = positions.length / 3;
    // T0, B0, T1, B1
    positions.push(p0.x, yTop, p0.z);
    normals.push(nx, 0, nz);
    uvs.push(0, 1);

    positions.push(p0.x, yBase, p0.z);
    normals.push(nx, 0, nz);
    uvs.push(0, 0);

    positions.push(p1.x, yTop, p1.z);
    normals.push(nx, 0, nz);
    uvs.push(1, 1);

    positions.push(p1.x, yBase, p1.z);
    normals.push(nx, 0, nz);
    uvs.push(1, 0);

    // Quad: (T0, B0, T1) and (T1, B0, B1)
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx + 2, baseIdx + 1, baseIdx + 3);
  }

  return { positions, normals, uvs, indices, bounds };
}

/**
 * Creates a PlayCanvas pc.Mesh for the Agora polygonal slab.
 */
export function createAgoraPolygonMesh(pc, device, options = {}) {
  const vertices = getAgoraRuntimePolygon();
  const { positions, normals, uvs, indices } = buildPolygonMeshGeometry(vertices, options);
  return pc.createMesh(device, positions, {
    normals,
    uvs,
    indices
  });
}
