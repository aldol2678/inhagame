import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { roadTreeClear, roadFrame } from '../src/campus-road-layout.js';
import { constrainPondWalk } from '../src/landmark-detail-layout.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { WALK_SHAPE } from '../src/player-dimensions.js';
import { moveAroundObstacles } from '../src/world-collision.js';

const feature = id => SITE_FEATURES.find(f => f.id === 'site_' + id);
const pool = feature(218220690).vertices;
const banks = [feature(481241657), feature(258995842)];
const distance = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
const walk = (p, q) => constrainPondWalk(p, moveAroundObstacles(
  { ...p, y: WALK_SHAPE.footOffset }, q.x-p.x, q.z-p.z));

test('both bank paths remain walkable in both directions', () => {
  for (const bank of banks) {
    for (const points of [bank.vertices, [...bank.vertices].reverse()]) {
      let p = points[0];
      for (const q of points.slice(1)) {
        const frame = roadFrame(p, q);
        for (let u = .4; u < frame.length; u += .4) p = walk(p, frame.at(u));
        p = walk(p, q);
        assert.ok(distance(p,q) < .01, bank.id + ' path obstructed');
      }
    }
  }
});

test('each edge blocks a walking player and a previous save inside can leave', () => {
  const center = { x: pool.reduce((s,p) => s+p.x, 0)/4, z: pool.reduce((s,p) => s+p.z, 0)/4 };
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i], b = pool[(i+1)%pool.length], edge = roadFrame(a, b);
    const middle = edge.at(edge.length/2);
    const from = { x: middle.x + (middle.x-center.x)*.16, z: middle.z + (middle.z-center.z)*.16 };
    assert.ok(!polygonOverlap(from.x, from.z, pool));
    const stopped = walk(from, center);
    assert.ok(!polygonOverlap(stopped.x, stopped.z, pool));
    assert.ok(distance(stopped, middle) < .16);
    assert.ok(distance(constrainPondWalk(center, from), from) < .01);
  }
});

test('each lawn has bank planting inside its mapped footprint and clear of roads', () => {
  const rows = RENDER_CHUNKS.flatMap(chunk => chunk.trees).filter(tree => tree.bankRow);
  for (const id of [218215618, 218220046, 218221011, 258995412]) {
    const lawn = feature(id);
    const trees = rows.filter(tree => tree.id.startsWith(lawn.id + '_'));
    assert.ok(trees.length >= 2);
    assert.ok(trees.every(t => polygonOverlap(t.x,t.z,lawn.vertices) && roadTreeClear(t)));
  }
});
