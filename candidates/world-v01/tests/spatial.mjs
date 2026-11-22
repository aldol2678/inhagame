import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reality, spatialSource } from '../tools/spatial-source.mjs';
import { geoToWorld, GEO_ORIGIN } from '../../../apps/world/src/geo-coordinates.js';
import { METERS_PER_WORLD_UNIT } from '../../../apps/world/src/world-scale.js';
import { createSpatial } from '../src/map/spatial.js';
import { polygonOverlap } from '../src/map/polygon-collision.js';
const layout = JSON.parse(readFileSync(new URL('../data/layout.json', import.meta.url)));
const world = createSpatial(layout);
const sites = await reality('site'),
  buildings = await reality('buildings'),
  landmarks = await reality('landmarks');
const facilities = (await reality('facilities')).features;
const packet = process.env.MOA_CAMPUS_DATA ? await spatialSource(process.env.MOA_CAMPUS_DATA) : null;
const toCoordinate = packet?.geoToWorld ?? geoToWorld;
assert.equal(METERS_PER_WORLD_UNIT, 2);
assert.deepEqual(toCoordinate(GEO_ORIGIN.lat, GEO_ORIGIN.lon), { x: 0, z: -90 });
let count = 0,
  maxDelta = 0;
for (const [rows, portRows] of [
  [sites.features, packet?.SITE_FEATURES],
  [buildings.buildings, packet?.BUILDINGS],
  [landmarks.landmarks, packet?.LANDMARKS],
]) {
  if (portRows) assert.deepEqual(rows.map((r) => r.id).sort(), portRows.map((r) => r.id).sort());
  for (const row of rows)
    for (const key of ['line', 'polygon']) {
      const coords =
        key === 'polygon' && row.id === 'fac_biryong_parking'
          ? facilities.find((f) => f.id === row.id).rings[0]
          : row[key];
      if (portRows) assert.deepEqual(portRows.find((p) => p.id === row.id)[key] ?? null, coords ?? null);
      for (const ll of coords ?? []) {
        const p = geoToWorld(...ll),
          q = toCoordinate(...ll);
        maxDelta = Math.max(maxDelta, Math.hypot(p.x - q.x, p.z - q.z));
        count++;
      }
    }
}
assert.equal(count, 174);
assert.equal(maxDelta, 0);
assert.deepEqual(Object.keys(world.rooms), ['main-gate', 'main-building', 'library']);
assert.equal(Object.keys(layout.walkwaySurvey).length, 6);
assert(Object.values(layout.walkwaySurvey).every((v) => v === null));
assert.deepEqual(
  layout.obstacles.filter((o) => o.id.startsWith('bldg_')).map((o) => o.id),
  ['bldg_01', 'bldg_jungseok'],
);
assert.equal(layout.routes.length, 8);
for (const p of [world.spawn, ...Object.values(world.rooms)]) assert(world.canStand(p.x, p.z));
let sweeps = 0;
for (const body of layout.obstacles.filter(
  (o) =>
    ['bldg_01', 'bldg_jungseok', 'site_218220690', 'lmk_inkyung_pond'].includes(o.id) ||
    o.id.startsWith('tree-'),
)) {
  let checked = false;
  for (let i = 0; i < body.polygon.length && !checked; i++) {
    const a = body.polygon[i],
      b = body.polygon[(i + 1) % body.polygon.length];
    const h = Math.hypot(b.z - a.z, b.x - a.x),
      x = (a.x + b.x) / 2,
      z = (a.z + b.z) / 2;
    for (const sign of [1, -1]) {
      const dx = ((b.z - a.z) * sign) / h,
        dz = ((a.x - b.x) * sign) / h;
      const from = { x: x + dx * 2, z: z + dz * 2 };
      if (!world.canStand(from.x, from.z) || !polygonOverlap(x - dx * 0.1, z - dz * 0.1, body.polygon))
        continue;
      const stop = world.move(from.x, from.z, -dx * 3, -dz * 3);
      assert(world.canStand(stop.x, stop.z));
      assert(!polygonOverlap(stop.x, stop.z, body.polygon, 0.599));
      assert(Math.hypot(stop.x - (x - dx), stop.z - (z - dz)) > 1);
      checked = true;
      sweeps++;
      break;
    }
  }
  assert(checked, body.id);
}
console.log(
  JSON.stringify({
    points: count,
    independentPort: !!packet,
    maxDeltaWU: maxDelta,
    sweeps,
    rooms: world.rooms,
    survey: layout.walkwaySurvey,
  }),
);
