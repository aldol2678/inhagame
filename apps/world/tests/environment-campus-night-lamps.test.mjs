import test from 'node:test';
import assert from 'node:assert/strict';
import { POND_RING, edgeFrame } from '../src/roadview-layout.js';
import {
  CAMPUS_NIGHT_LAMPS,
  CAMPUS_NIGHT_LAMP_POLICY,
  buildCampusNightLampLayout
} from '../src/environment/night-campus-lamp-layout.js';

test('campus night lamp registry covers roads and paths within the hard budget', () => {
  const layout = buildCampusNightLampLayout();
  const snapshot = lamps => lamps.map(lamp => ({
    id: lamp.id,
    sourceKind: lamp.sourceKind,
    center: lamp.center,
    head: lamp.head,
    side: lamp.side,
    height: lamp.height,
    yaw: lamp.frame.yaw
  }));
  assert.deepEqual(snapshot(layout), snapshot(CAMPUS_NIGHT_LAMPS));
  assert.ok(layout.length > 0);
  assert.ok(layout.length <= CAMPUS_NIGHT_LAMP_POLICY.maxRoadLamps +
    CAMPUS_NIGHT_LAMP_POLICY.maxPathLamps + CAMPUS_NIGHT_LAMP_POLICY.maxInkyungLamps);
  assert.ok(layout.some(lamp => lamp.sourceKind === 'road'));
  assert.ok(layout.some(lamp => lamp.sourceKind === 'inkyung-promenade'));
});

test('campus night lamp registry is deterministic, finite, and spatially de-duplicated', () => {
  const ids = new Set();
  for (const lamp of CAMPUS_NIGHT_LAMPS) {
    assert.equal(lamp.source, 'campus');
    assert.equal(lamp.kind, 'lamp');
    assert.ok(!ids.has(lamp.id));
    ids.add(lamp.id);
    assert.ok(Number.isFinite(lamp.center.x) && Number.isFinite(lamp.center.z));
    assert.ok(Number.isFinite(lamp.head.x) && Number.isFinite(lamp.head.y) && Number.isFinite(lamp.head.z));
    assert.equal(lamp.height, CAMPUS_NIGHT_LAMP_POLICY.height);
    assert.ok(Number.isFinite(lamp.frame.yaw));
    if (lamp.sourceKind === 'inkyung-promenade') {
      assert.ok(Math.abs(lamp.frame.yaw - edgeFrame(POND_RING, 1).yaw) < 1e-9,
        `${lamp.id} follows the canonical pond edge rather than a zero-yaw fallback`);
    }
  }
  for (let i = 0; i < CAMPUS_NIGHT_LAMPS.length; i++) {
    for (let j = i + 1; j < CAMPUS_NIGHT_LAMPS.length; j++) {
      const a = CAMPUS_NIGHT_LAMPS[i].center;
      const b = CAMPUS_NIGHT_LAMPS[j].center;
      assert.ok(
        Math.hypot(a.x - b.x, a.z - b.z) >= CAMPUS_NIGHT_LAMP_POLICY.minGap - 1e-9
      );
    }
  }
});
