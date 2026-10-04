import test from 'node:test';
import assert from 'node:assert/strict';
import { campusRoadDetailPlan, fillCampusRoadMicroDetails, ROAD_DETAIL_COLORS, ROAD_DETAIL_SEGMENT_LIMIT } from '../src/campus-road-micro-details.js';
import { ROAD_SEGMENTS, ROAD_CROSSWALKS, distanceToRoad } from '../src/campus-road-layout.js';
import { gateClippedRoadBatch, gateGroundOverlaps } from '../src/main-gate-surface-ownership.js';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';
import { inferCampusMaterialProfile } from '../src/campus-material-profile.js';

test('static detail plan is deterministic, bounded and preserves intersections and crosswalks', () => {
  const plan = campusRoadDetailPlan();
  assert.deepEqual(plan, campusRoadDetailPlan());
  assert.deepEqual(new Set(plan.map(d => d.kind)), new Set(['patch', 'crack', 'wear', 'manhole', 'drain']));
  assert.ok(new Set(plan.map(d => d.segment)).size <= ROAD_DETAIL_SEGMENT_LIMIT);
  for (const d of plan) {
    const radius = Math.hypot(d.length, d.width) / 2;
    assert.ok(d.u - radius >= 1.5 && d.u + radius <= d.segment.frame.length - 1.5);
    assert.ok(Math.abs(d.v) + d.width / 2 <= d.segment.road.width / 2);
    for (const c of ROAD_CROSSWALKS.filter(c => c.segment === d.segment))
      assert.ok(Math.abs(c.u - d.u) >= c.width / 2 + radius + 1);
    for (const s of ROAD_SEGMENTS.filter(s => s !== d.segment))
      assert.ok(distanceToRoad(d.segment.frame.at(d.u, d.v), s) >= s.road.width / 2 + radius + .3);
  }
});

test('detail faces are upward, flat and outside the editor-owned gate, with a fixed batch budget', () => {
  const faces = [];
  fillCampusRoadMicroDetails(gateClippedRoadBatch({ quad(color, ...vertices) { faces.push({ color, vertices }); } }));
  assert.ok(faces.length > 0 && faces.length <= 384);
  assert.deepEqual(new Set(faces.map(f => f.color)), new Set([...Object.values(ROAD_DETAIL_COLORS), '#747d7b']));
  for (const { vertices } of faces) {
    const [a, b, c] = vertices;
    assert.ok(vertices.every(p => p.every(Number.isFinite) && p[1] === a[1] && p[1] >= FLAT_GROUND_Y.EDGE && p[1] < FLAT_GROUND_MAX_Y));
    assert.ok((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 1e-9);
    assert.equal(gateGroundOverlaps(vertices.map(p => ({ x: p[0], z: p[2] }))), false);
  }
  assert.equal(inferCampusMaterialProfile(ROAD_DETAIL_COLORS.asphalt), 'asphalt');
  assert.equal(inferCampusMaterialProfile(ROAD_DETAIL_COLORS.metal), 'metal');
});
