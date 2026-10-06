import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NIGHT_STAR_BUDGET,
  NIGHT_STAR_RADIUS,
  nightStarBudget,
  nightStarLayout,
  nightStarVisibility
} from '../src/environment/night-star-policy.js';

test('night star budget scales by graphics tier and stays inside the atmosphere dome', () => {
  assert.deepEqual(NIGHT_STAR_BUDGET, { low: 72, medium: 132, high: 216 });
  assert.equal(nightStarBudget('unknown'), NIGHT_STAR_BUDGET.medium);
  assert.ok(NIGHT_STAR_RADIUS > 500 && NIGHT_STAR_RADIUS < 640);
});

test('night star layout is deterministic and constrained to the upper hemisphere', () => {
  for (const tier of ['low', 'medium', 'high']) {
    const first = nightStarLayout(tier);
    const second = nightStarLayout(tier);
    assert.deepEqual(first, second);
    assert.equal(first.length, NIGHT_STAR_BUDGET[tier]);
    for (const star of first) {
      const length = Math.hypot(star.x, star.y, star.z);
      assert.ok(Math.abs(length - 1) < 1e-9);
      assert.ok(star.y >= 0.08);
      assert.ok(star.size > 0);
    }
  }
});

test('stars stay hidden through day and sunset, then respond to cloud and precipitation', () => {
  assert.equal(nightStarVisibility({ artificialLightFactor: 0 }), 0);
  assert.equal(nightStarVisibility({ artificialLightFactor: 0.18 }), 0);
  const clearNight = nightStarVisibility({ artificialLightFactor: 1, cloudCover: 0.24 });
  const cloudyNight = nightStarVisibility({ artificialLightFactor: 1, cloudCover: 0.8 });
  const rainNight = nightStarVisibility({ artificialLightFactor: 1, cloudCover: 0.8, rainIntensity: 1 });
  assert.ok(clearNight > 0.7);
  assert.ok(cloudyNight < clearNight);
  assert.ok(rainNight < cloudyNight);
});
