// Plan test inputs against the baked solids. The browser must walk these
// polylines using its own input, simulation, rendering and room triggers.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createSpatial } from '../src/map/spatial.js';
const layout = JSON.parse(readFileSync(new URL('../data/layout.json', import.meta.url)));
const world = createSpatial(layout);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
function clear(a, b) {
  const n = Math.max(1, Math.ceil(distance(a, b) / 0.35));
  for (let i = 0; i <= n; i++) {
    const { x, z } = lerp(a, b, i / n);
    // Reserve extra clearance for screen input/HUD rounding and replay in reverse.
    if (
      ![
        [0, 0],
        [0.24, 0],
        [-0.24, 0],
        [0, 0.24],
        [0, -0.24],
      ].every(([dx, dz]) => world.canStand(x + dx, z + dz))
    )
      return false;
  }
  return true;
}
function path(a, b) {
  if (clear(a, b)) return [a, b];
  const q = [{ p: a, prev: null }],
    seen = new Set();
  for (let i = 0; i < q.length; i++) {
    const n = q[i];
    if (distance(n.p, b) < 3 && clear(n.p, b)) {
      let rev = [b];
      for (let k = n; k; k = k.prev) rev.push(k.p);
      const raw = rev.reverse(),
        short = [raw[0]];
      for (let j = 0; j < raw.length - 1; ) {
        let far = raw.length - 1;
        while (far > j + 1 && !clear(raw[j], raw[far])) far--;
        short.push(raw[far]);
        j = far;
      }
      return short;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const p = { x: Math.round(n.p.x) + dx, z: Math.round(n.p.z) + dz };
      const id = p.x + ',' + p.z;
      if (seen.has(id) || p.x < -65 || p.x > 82 || p.z < -110 || p.z > 40 || !clear(n.p, p)) continue;
      seen.add(id);
      q.push({ p, prev: n });
    }
  }
  throw Error('Unreachable ' + JSON.stringify([a, b]));
}
function midpoint(id) {
  const line = layout.routes.find((r) => r.id === id).line;
  let half = line.slice(1).reduce((n, p, i) => n + distance(p, line[i]), 0) / 2;
  for (let i = 1; i < line.length; i++) {
    const len = distance(line[i - 1], line[i]);
    if (half <= len) return lerp(line[i - 1], line[i], half / len);
    half -= len;
  }
}
const gate = world.rooms['main-gate'],
  hall = world.rooms['main-building'],
  lib = world.rooms.library;
const waypoints = {
  spawn: world.spawn,
  gate,
  hall,
  west: midpoint('site_481241657'),
  east: midpoint('site_258995842'),
  library: lib,
};
const legs = {};
for (const [a, b] of [
  ['spawn', 'gate'],
  ['gate', 'hall'],
  ['hall', 'west'],
  ['west', 'library'],
  ['hall', 'east'],
  ['east', 'library'],
]) {
  legs[a + '-' + b] = path(waypoints[a], waypoints[b]);
  for (const p of legs[a + '-' + b]) assert(world.canStand(p.x, p.z));
}
console.log(JSON.stringify({ waypoints, legs }));
