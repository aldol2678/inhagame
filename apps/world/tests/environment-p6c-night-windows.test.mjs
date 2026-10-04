import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NIGHT_WINDOW_TIER_POLICY,
  nightWindowGlowFactor,
  nightWindowLayout,
  nightWindowTierPolicy
} from '../src/environment/night-window-policy.js';

const box = (id, x, z, w, d, height = 12, floors = 0) => ({
  id,
  height,
  floors,
  rings: [[
    { x: x - w / 2, z: z - d / 2 },
    { x: x + w / 2, z: z - d / 2 },
    { x: x + w / 2, z: z + d / 2 },
    { x: x - w / 2, z: z + d / 2 }
  ]]
});

test('P6C tier policy bounds lit windows while increasing density with graphics quality', () => {
  assert.deepEqual(Object.keys(NIGHT_WINDOW_TIER_POLICY), ['low', 'medium', 'high']);
  assert.equal(nightWindowTierPolicy('unknown'), NIGHT_WINDOW_TIER_POLICY.medium);
  assert.ok(NIGHT_WINDOW_TIER_POLICY.low.maxWindows < NIGHT_WINDOW_TIER_POLICY.medium.maxWindows);
  assert.ok(NIGHT_WINDOW_TIER_POLICY.medium.maxWindows < NIGHT_WINDOW_TIER_POLICY.high.maxWindows);
  assert.ok(NIGHT_WINDOW_TIER_POLICY.low.spacing > NIGHT_WINDOW_TIER_POLICY.medium.spacing);
  assert.ok(NIGHT_WINDOW_TIER_POLICY.medium.spacing > NIGHT_WINDOW_TIER_POLICY.high.spacing);
  assert.ok(NIGHT_WINDOW_TIER_POLICY.low.litRatio < NIGHT_WINDOW_TIER_POLICY.high.litRatio);
});

test('night window layout is deterministic, facade-bound, and respects hard budgets', () => {
  const buildings = Array.from({ length: 12 }, (_, i) =>
    box(`b${i}`, i * 25, i % 2 ? 18 : -18, 22, 15, 16)
  );

  for (const tier of ['low', 'medium', 'high']) {
    const a = nightWindowLayout(buildings, tier);
    const b = nightWindowLayout(buildings, tier);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0);
    assert.ok(a.length <= NIGHT_WINDOW_TIER_POLICY[tier].maxWindows);

    for (const window of a) {
      assert.ok(Number.isFinite(window.x));
      assert.ok(Number.isFinite(window.y));
      assert.ok(Number.isFinite(window.z));
      assert.ok(window.width > 0 && window.height > 0);
      assert.ok(Math.abs(Math.hypot(window.tx, window.tz) - 1) < 1e-9);
      assert.ok(Math.abs(Math.hypot(window.nx, window.nz) - 1) < 1e-9);
      assert.ok(['warm', 'cool'].includes(window.tone));
    }
  }
});

test('higher quality tiers produce at least as many lit windows on the same buildings', () => {
  const buildings = [
    box('alpha', 0, 0, 34, 18, 20),
    box('beta', 45, 0, 28, 20, 17),
    box('gamma', -40, 10, 30, 16, 14)
  ];
  const low = nightWindowLayout(buildings, 'low').length;
  const medium = nightWindowLayout(buildings, 'medium').length;
  const high = nightWindowLayout(buildings, 'high').length;

  assert.ok(low > 0);
  assert.ok(medium >= low);
  assert.ok(high >= medium);
});

test('window glow is off in day, subtle at sunset, and full at night', () => {
  assert.equal(nightWindowGlowFactor(0), 0);
  assert.equal(nightWindowGlowFactor(-1), 0);
  assert.equal(nightWindowGlowFactor(Number.NaN), 0);
  const sunset = nightWindowGlowFactor(0.18);
  assert.ok(sunset > 0 && sunset < 0.25);
  assert.equal(nightWindowGlowFactor(1), 1);
  assert.equal(nightWindowGlowFactor(5), 1);
});
