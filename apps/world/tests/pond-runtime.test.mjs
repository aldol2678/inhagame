import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getCanonicalLandmark, projectPolygon, computePolygonAreaSqm,
  computePolygonCentroid, buildPolygonSurfaceGeometry, triangulatePolygon } from "../src/reality-adapter.js";
import { WORLD_BOUNDS, geoToWorld, TOUR_STOPS } from "../src/campus-layout.js";
import { ZoneRegistry } from "../src/zone-registry.js";
import { moveAroundObstacles } from "../src/world-collision.js";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const pond = getCanonicalLandmark("lmk_inkyung_pond");
const source = read("../data/reality/evidence/p2-02b/pond-source.json");
const vertices = projectPolygon(pond.polygon);
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > point.z) !== (b.z > point.z) &&
      point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

test("pond canonical ring exactly follows source node IDs; derived values are not claimed verified", () => {
  assert.equal(source.way.id, 218264623);
  assert.equal(source.way.version, 7);
  assert.equal(source.way.timestamp, "2017-03-18T17:04:18Z");
  assert.equal(source.way.tags.name, "인경호");
  assert.equal(source.way.tags.natural, "water");
  const recovered = source.way.nodes.map(id => {
    const n = source.nodes.find(n => n.id === id);
    assert.ok(n);
    return [n.lat, n.lon];
  });
  assert.deepEqual(pond.polygon, recovered);
  assert.deepEqual(pond.polygon, source.polygon);
  assert.deepEqual(pond.polygon[0], pond.polygon.at(-1));
  assert.equal(vertices.length, 13);
  assert.equal(new Set(pond.polygon.slice(0, -1).map(JSON.stringify)).size, 13);
  assert.ok(pond.polygon.flat().every(Number.isFinite));
  assert.equal(pond.provenance.polygon.accuracy, "verified");
  for (const key of ["position", "polygonArea", "polygonBounds"]) {
    assert.equal(pond.provenance[key].accuracy, "derived");
    assert.ok(pond.provenance[key].method);
  }
  assert.ok(Math.abs(computePolygonAreaSqm(vertices) - 2830.1351) < 0.001);
  assert.ok(Math.abs(pond.polygonArea_sqm - computePolygonAreaSqm(vertices)) < 1e-8);
  const centroid = computePolygonCentroid(vertices), canonical = geoToWorld(pond.lat, pond.lon);
  assert.ok(Math.hypot(centroid.x - canonical.x, centroid.z - canonical.z) < 1e-6);
  assert.deepEqual(pond.polygonBounds, {
    minLat: 37.449236, maxLat: 37.4501596, minLon: 126.6555303, maxLon: 126.6563875
  });
  const landmarks = read("../data/reality/campus-landmarks.json").landmarks;
  assert.equal(new Set(landmarks.map(l => l.id)).size, landmarks.length);
});

test("concave pond mesh preserves boundary, area and upward winding in either source order", () => {
  assert.ok(vertices.some((p, i) => cross(vertices[(i + vertices.length - 1) % vertices.length], p,
    vertices[(i + 1) % vertices.length]) > 0), "pond actually exercises concave triangulation");
  for (const ring of [vertices, [...vertices].reverse()]) {
    const mesh = buildPolygonSurfaceGeometry(ring);
    assert.equal(mesh.indices.length, (ring.length - 2) * 3);
    assert.ok([...mesh.positions, ...mesh.normals, ...mesh.uvs].every(Number.isFinite));
    assert.deepEqual(mesh.positions.filter((_, i) => i % 3 !== 1), ring.flatMap(p => [p.x, p.z]));
    let trianglesArea = 0;
    const edges = new Map();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = mesh.indices.slice(i, i + 3);
      assert.ok(ids.every(id => Number.isInteger(id) && id >= 0 && id < ring.length));
      const [a, b, c] = ids.map(id => ring[id]);
      assert.ok(cross(a, b, c) < 0, "upward 3D normal");
      trianglesArea += -cross(a, b, c) / 2;
      assert.ok(inside({ x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 }, ring));
      for (let j = 0; j < 3; j++) {
        const key = [ids[j], ids[(j + 1) % 3]].sort((a, b) => a - b).join(",");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok(Math.abs(trianglesArea * 4 - pond.polygonArea_sqm) < 1e-7);
    assert.equal([...edges.values()].filter(n => n === 1).length, ring.length);
    assert.ok([...edges.values()].every(n => n === 1 || n === 2));
    for (let i = 0; i < ring.length; i++) {
      assert.equal(edges.get([i, (i + 1) % ring.length].sort((a, b) => a - b).join(",")), 1);
    }
  }
});

test("generic polygon helpers reject invalid input and handle convex/concave surfaces", () => {
  const lShape = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]].map(([x, z]) => ({ x, z }));
  assert.equal(triangulatePolygon(lShape).length, 12);
  assert.throws(() => projectPolygon(pond.polygon.slice(0, -1)), /closed/);
  assert.throws(() => projectPolygon([[NaN, 1], [1, 2], [2, 1], [NaN, 1]]), /finite/);
  assert.throws(() => projectPolygon(pond.polygon, () => ({ x: Infinity, z: 0 })), /finite/);
  assert.throws(() => triangulatePolygon([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }]), /Degenerate/);
  assert.throws(() => triangulatePolygon([{ x: 0, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }, { x: 3, z: 0 }]), /self-intersect/);
  assert.throws(() => buildPolygonSurfaceGeometry(vertices, { y: Infinity }), /finite/);
});

test("verified envelope plus 20m margin fits existing neighbor zones; pond approach remains reachable", () => {
  const zones = ["C01_GATE", "C02_MAIN_HALL", "C03_CENTRAL"].map(id => read(`../data/zones/${id}.json`));
  const registry = new ZoneRegistry(zones), central = registry.get("C03_CENTRAL");
  for (const id of ["lmk_agora_plaza", "lmk_inkyung_pond"]) {
    for (const p of projectPolygon(getCanonicalLandmark(id).polygon)) {
      assert.equal(registry.findContaining(p)?.id, "C03_CENTRAL");
      for (const dx of [-10, 10]) for (const dz of [-10, 10]) {
        assert.ok(p.x + dx >= WORLD_BOUNDS.minX && p.x + dx <= WORLD_BOUNDS.maxX);
        assert.ok(p.z + dz >= WORLD_BOUNDS.minZ && p.z + dz <= WORLD_BOUNDS.maxZ);
        const marginZone = registry.findContaining({ x: p.x + dx, z: p.z + dz });
        assert.ok(marginZone && (marginZone.id === central.id || central.neighbors.includes(marginZone.id)));
      }
    }
  }
  assert.equal(registry.findContaining({ x: 0, z: -110 }).id, "C01_GATE");
  for (const stop of TOUR_STOPS) assert.equal(registry.findContaining(stop).id, stop.zone);
  // Follow the south approach around the hall. A direct diagonal to the pond
  // cuts through its facade and relies on the old oversized capsule sliding
  // past a narrow setback; human-sized collision correctly enters that recess.
  const path = [TOUR_STOPS[1], { x: 60, z: -18 }, { x: 90, z: -18 }, { x: 95, z: -4 }, { x: 100, z: 20 }, computePolygonCentroid(vertices)];
  let position = { ...path[0], y: 1.15 };
  for (let i = 1; i < path.length; i++) {
    const from = { ...position }, to = path[i];
    for (let step = 1; step <= 100; step++) {
      const x = from.x + (to.x - from.x) * step / 100;
      const z = from.z + (to.z - from.z) * step / 100;
      position = { ...moveAroundObstacles(position, x - position.x, z - position.z), y: 1.15 };
    }
    assert.ok(Math.hypot(position.x - to.x, position.z - to.z) < 0.01);
  }
});

test("conflicting Student Center geometry stays evidence-only", () => {
  const student = read("../data/reality/campus-buildings.json").buildings.find(b => b.id === "bldg_07");
  assert.equal(student.lat, null);
  assert.equal(student.lon, null);
  assert.equal(student.height_m, null);
  assert.equal(student.polygon, undefined);
  const research = read("../data/reality/evidence/p2-02b/student-center-revalidation.json");
  assert.equal(research.decision, "HOLD_AUTHORITY_GEOMETRY_CONFLICT");
  const feature = research.features.find(f => f.properties.buld_idntfc_no === "12163");
  assert.equal(feature.properties.dong_nm, "7동 (7호관 학생회관)");
  assert.equal(feature.derived.polygonCount, 1);
  assert.equal(feature.derived.ringCount, 1);
  assert.ok(feature.derived.areaDifferencePercent > 370 && feature.derived.areaDifferencePercent < 371);
});
