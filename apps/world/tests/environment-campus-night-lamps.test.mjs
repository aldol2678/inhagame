import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPUS_NIGHT_LAMPS,
  CAMPUS_NIGHT_LAMP_POLICY,
  buildCampusNightLampLayout
} from '../src/environment/night-campus-lamp-layout.js';

test('campus night lamp registry covers roads and paths within the hard budget', () => {
  const layout = buildCampusNightLampLayout();
  assert.deepEqual(layout, CAMPUS_NIGHT_LAMPS);
  assert.ok(layout.length > 0);
  assert.ok(layout.length <= CAMPUS_NIGHT_LAMP_POLICY.maxRoadLamps + CAMPUS_NIGHT_LAMP_POLICY.maxPathLamps);
  assert.ok(layout.some(lamp => lamp.sourceKind === 'road'));
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
