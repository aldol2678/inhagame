import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAIN_PUDDLE_BUDGET,
  RAIN_SPLASH_GROUPS,
  RAIN_SPLASH_MARKS,
  rainGroundVisibility,
  rainPuddleBudget,
  rainPuddleLayout,
  rainSplashGroups,
  rainSplashLayout,
  rainSplashMarks,
  rainSplashRadius
} from '../src/environment/rain-ground-policy.js';

const segment = (id, x, z, length = 20, width = 4, y = 0.034) => ({
  id,
  length,
  width,
  y,
  at(u, v = 0) {
    return { x: x + u, z: z + v };
  }
});

test('P6D splash and puddle budgets scale by graphics tier and stay bounded', () => {
  assert.deepEqual(RAIN_SPLASH_GROUPS, { low: 1, medium: 2, high: 3 });
  assert.deepEqual(RAIN_SPLASH_MARKS, { low: 5, medium: 8, high: 11 });
  assert.deepEqual(RAIN_PUDDLE_BUDGET, { low: 5, medium: 9, high: 14 });
  assert.equal(rainSplashGroups('unknown'), 2);
  assert.equal(rainSplashMarks('unknown'), 8);
  assert.equal(rainPuddleBudget('unknown'), 9);
  assert.ok(rainSplashRadius('low') < rainSplashRadius('medium'));
  assert.ok(rainSplashRadius('medium') < rainSplashRadius('high'));
});

test('splash layouts are deterministic and remain inside the local rain footprint', () => {
  for (const tier of ['low', 'medium', 'high']) {
    for (let group = 0; group < rainSplashGroups(tier); group++) {
      const a = rainSplashLayout(tier, group);
      const b = rainSplashLayout(tier, group);
      assert.deepEqual(a, b);
      assert.equal(a.length, rainSplashMarks(tier));
      for (const mark of a) {
        assert.ok(Math.hypot(mark.x, mark.z) <= rainSplashRadius(tier) + 1e-9);
        assert.ok(mark.radius > 0);
        assert.ok(mark.squash > 0 && mark.squash <= 1);
      }
    }
  }
});

test('puddle placement is deterministic, road-bound, and respects tier budgets', () => {
  const roads = Array.from({ length: 20 }, (_, i) =>
    segment(`road-${i}`, i * 30, i % 2 ? 10 : -10, 24, 4.2)
  );

  for (const tier of ['low', 'medium', 'high']) {
    const a = rainPuddleLayout(roads, tier);
    const b = rainPuddleLayout(roads, tier);
    assert.deepEqual(a, b);
    assert.equal(a.length, rainPuddleBudget(tier));
    for (const puddle of a) {
      assert.ok(Number.isFinite(puddle.x));
      assert.ok(Number.isFinite(puddle.y));
      assert.ok(Number.isFinite(puddle.z));
      assert.ok(puddle.radiusLong > puddle.radiusShort);
      assert.ok(Math.abs(Math.hypot(puddle.tx, puddle.tz) - 1) < 1e-9);
    }
  }
});

test('higher tiers never reduce puddle count when enough road segments exist', () => {
  const roads = Array.from({ length: 30 }, (_, i) => segment(`r-${i}`, i * 15, 0));
  const low = rainPuddleLayout(roads, 'low').length;
  const medium = rainPuddleLayout(roads, 'medium').length;
  const high = rainPuddleLayout(roads, 'high').length;
  assert.ok(low < medium);
  assert.ok(medium < high);
});

test('ground effects separate active rainfall from lingering wetness', () => {
  assert.deepEqual(rainGroundVisibility(0, 0), { splash: 0, puddle: 0 });
  const raining = rainGroundVisibility(1, 1);
  assert.equal(raining.splash, 1);
  assert.equal(raining.puddle, 1);

  const wetAfterRain = rainGroundVisibility(0, 0.5);
  assert.equal(wetAfterRain.splash, 0);
  assert.ok(wetAfterRain.puddle > 0 && wetAfterRain.puddle < 1);
});
