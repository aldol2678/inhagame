import assert from "node:assert/strict";
import {
  CANONICAL_AGORA,
  getAgoraWgs84Polygon,
  getAgoraRuntimePolygon,
  getAgoraRuntimePolygonClosed,
  getAgoraRuntimeCentroid,
  computePolygonBounds,
  computePolygonAreaWU,
  computePolygonAreaSqm,
  buildPolygonMeshGeometry
} from "../src/reality-adapter.js";
import { LANDMARKS, OBSTACLES, TOUR_STOPS } from "../src/campus-layout.js";

console.log("=== Archived Agora Geometry and Runtime Removal Test Suite ===");

// 1. Canonical Landmark Data Integrity
console.log("\n[1. Canonical Landmark Data Integrity]");
assert.equal(CANONICAL_AGORA.id, "lmk_agora_plaza");
assert.equal(CANONICAL_AGORA.officialName, "아고라 광장");
assert.equal(CANONICAL_AGORA.type, "plaza");
assert.equal(CANONICAL_AGORA.lat, 37.449281);
assert.equal(CANONICAL_AGORA.lon, 126.656140);
assert.equal(CANONICAL_AGORA.provenance.polygon.accuracy, "verified");
assert.equal(CANONICAL_AGORA.provenance.polygon.sourceId, "osm_way_1099894035");
assert.equal(CANONICAL_AGORA.provenance.position.accuracy, "derived");
assert.equal(CANONICAL_AGORA.provenance.position.method, "polygon-centroid");
console.log("✓ Canonical metadata and provenance verified");

// 2. WGS84 Polygon Closed Ring
console.log("\n[2. WGS84 Polygon Closed Ring]");
const wgs84Poly = getAgoraWgs84Polygon();
assert.equal(wgs84Poly.length, 8, "polygon must have 8 coordinate pairs");
assert.deepEqual(wgs84Poly[0], wgs84Poly[7], "first coordinate must equal last coordinate (closed ring)");
const uniqueCount = new Set(wgs84Poly.map(([lat, lon]) => `${lat},${lon}`)).size;
assert.equal(uniqueCount, 7, "must have exactly 7 unique vertices");
console.log("✓ WGS84 closed ring with 7 unique vertices verified");

// 3. Reality Adapter Coordinate Projection & Centroid
console.log("\n[3. Reality Adapter Projection & Centroid]");
const runtimeCentroid = getAgoraRuntimeCentroid();
assert.ok(Math.abs(runtimeCentroid.x - 130.357) < 0.01, "runtime centroid X ~ 130.36");
assert.ok(Math.abs(runtimeCentroid.z - (-2.100)) < 0.01, "runtime centroid Z ~ -2.10");

const runtimePoly = getAgoraRuntimePolygon();
assert.equal(runtimePoly.length, 7, "unique runtime vertices length is 7");
const runtimeClosed = getAgoraRuntimePolygonClosed();
assert.equal(runtimeClosed.length, 8, "closed runtime vertices length is 8");
assert.ok(Math.hypot(runtimeClosed[0].x - runtimeClosed[7].x, runtimeClosed[0].z - runtimeClosed[7].z) < 1e-6);
console.log("✓ Runtime projection matches canonical centroid and closed ring");

// 4. Area Calculation & Footprint Shrink Verification
console.log("\n[4. Footprint Area Shrink Verification]");
const areaWU = computePolygonAreaWU(runtimePoly);
const areaSqm = computePolygonAreaSqm(runtimePoly);
console.log(`  Canonical Agora Area: ${areaWU.toFixed(2)} WU² (${areaSqm.toFixed(2)} m²)`);
assert.ok(Math.abs(areaWU - 149.76) < 0.5, "area in WU² ~ 149.76");
assert.ok(Math.abs(areaSqm - 599.05) < 2.0, "area in m² ~ 599.05");

// Old placeholder was 48 x 40 WU = 1920 WU² = 7680 m²
const oldPlaceholderWU = 48 * 40;
const oldPlaceholderSqm = oldPlaceholderWU * 4;
const shrinkRatio = oldPlaceholderSqm / areaSqm;
console.log(`  Old Placeholder: ${oldPlaceholderWU} WU² (${oldPlaceholderSqm} m²)`);
console.log(`  Footprint shrink ratio: ${shrinkRatio.toFixed(2)}x smaller`);
assert.ok(shrinkRatio > 12.0 && shrinkRatio < 13.5, "footprint correctly shrunk by ~12.8x");

// Bounding box verification
const bounds = computePolygonBounds(runtimePoly);
assert.ok(Math.abs(bounds.minX - 121.01) < 0.1, "minX ~ 121.01");
assert.ok(Math.abs(bounds.maxX - 134.86) < 0.1, "maxX ~ 134.86");
assert.ok(Math.abs(bounds.minZ - (-12.71)) < 0.1, "minZ ~ -12.71");
assert.ok(Math.abs(bounds.maxZ - 5.03) < 0.1, "maxZ ~ 5.03");
console.log("✓ Area and bounding box strictly verified (12.8x footprint shrink)");

// 5. Deterministic Triangulation & Normal Correctness
console.log("\n[5. Triangulation & Normal Correctness]");
// Convexity test
for (let i = 0; i < runtimePoly.length; i++) {
  const p0 = runtimePoly[(i - 1 + runtimePoly.length) % runtimePoly.length];
  const p1 = runtimePoly[i];
  const p2 = runtimePoly[(i + 1) % runtimePoly.length];
  const cp = (p1.x - p0.x) * (p2.z - p1.z) - (p1.z - p0.z) * (p2.x - p1.x);
  assert.ok(cp < 0, `edge turn at vertex ${i} must be clockwise (strictly negative cross product)`);
}

const meshData = buildPolygonMeshGeometry(runtimePoly, { yBase: 0, height: 0.09 });
assert.equal(meshData.positions.length, 42 * 3, "42 vertices = 126 position floats");
assert.equal(meshData.normals.length, 42 * 3, "42 normals = 126 normal floats");
assert.equal(meshData.uvs.length, 42 * 2, "42 UVs = 84 UV floats");
assert.equal(meshData.indices.length, 24 * 3, "24 triangles = 72 indices");

// Check top normals (all should be 0, 1, 0)
for (let i = 0; i < 7; i++) {
  assert.equal(meshData.normals[i * 3 + 0], 0);
  assert.equal(meshData.normals[i * 3 + 1], 1);
  assert.equal(meshData.normals[i * 3 + 2], 0);
}

// Check bottom normals (all should be 0, -1, 0)
for (let i = 7; i < 14; i++) {
  assert.equal(meshData.normals[i * 3 + 0], 0);
  assert.equal(meshData.normals[i * 3 + 1], -1);
  assert.equal(meshData.normals[i * 3 + 2], 0);
}

// Check skirt normals: must point outward (positive dot product with vector from centroid)
for (let i = 0; i < 7; i++) {
  const skirtIdx = 14 + i * 4;
  const nx = meshData.normals[skirtIdx * 3 + 0];
  const ny = meshData.normals[skirtIdx * 3 + 1];
  const nz = meshData.normals[skirtIdx * 3 + 2];
  assert.equal(ny, 0, "skirt normal Y must be 0");
  const px = meshData.positions[skirtIdx * 3 + 0];
  const pz = meshData.positions[skirtIdx * 3 + 2];
  const dot = nx * (px - runtimeCentroid.x) + nz * (pz - runtimeCentroid.z);
  assert.ok(dot > 0, `skirt edge ${i} normal must point outward from centroid (got dot=${dot})`);
}
console.log("✓ Strict convexity, deterministic 24-triangle fan, and crisp outward skirt normals verified");

// Runtime removal: archival source geometry is no longer a live landmark or collider.
assert.equal(LANDMARKS.agora, undefined);
assert.deepEqual(TOUR_STOPS.map(s=>s.id), ['gate','main']);
assert.ok(OBSTACLES.filter(b=>b.id.includes('agora')).every(b=>
  b.id.startsWith('fac_agora_courtyard_guard_')&&b.polygon.every(p=>p.z < -60)));
console.log("Archived pond-side Agora removed; only visible 6/9 courtyard guards retained PASS");
