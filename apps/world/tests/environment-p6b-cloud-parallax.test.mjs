import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_CLOUD_ALTITUDE,
  SKY_CLOUD_LAYER_POLICY,
  SKY_CLOUD_PATCH_BUDGET,
  skyCloudLayerCount,
  skyCloudLayerLayout,
  skyCloudLayerPolicy,
  skyCloudLayout
} from '../src/environment/sky-visual-policy.js';

test('P6B keeps total patch budgets flat while scaling active cloud layers by graphics tier', () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(SKY_CLOUD_LAYER_POLICY).map(tier => [
      tier,
      skyCloudLayerPolicy(tier).reduce((sum, layer) => sum + layer.patchCount, 0)
    ])),
    SKY_CLOUD_PATCH_BUDGET
  );
  assert.equal(skyCloudLayerCount('low'), 1);
  assert.equal(skyCloudLayerCount('medium'), 2);
  assert.equal(skyCloudLayerCount('high'), 3);
  assert.equal(skyCloudLayerCount('unknown'), 2);
});

test('layers rise in altitude while drift slows and follow rate increases with distance', () => {
  for (const tier of ['medium', 'high']) {
    const layers = skyCloudLayerPolicy(tier);
    for (let i = 1; i < layers.length; i++) {
      const lower = layers[i - 1];
      const upper = layers[i];
      assert.ok(upper.altitudeMin > lower.altitudeMin);
      assert.ok(upper.altitudeMax > lower.altitudeMax);
      assert.ok(upper.driftDegPerSec < lower.driftDegPerSec);
      assert.ok(upper.opacityScale < lower.opacityScale);
      assert.ok(upper.followRate > lower.followRate);
      assert.ok(upper.radius > lower.radius);
    }
  }
});

test('each layer layout is deterministic, bounded, and matches its patch allocation', () => {
  for (const tier of ['low', 'medium', 'high']) {
    const policies = skyCloudLayerPolicy(tier);
    policies.forEach((layer, index) => {
      const a = skyCloudLayerLayout(tier, index);
      const b = skyCloudLayerLayout(tier, index);
      assert.deepEqual(a, b);
      assert.equal(a.length, layer.patchCount);
      for (const patch of a) {
        assert.ok(Math.hypot(patch.x, patch.z) <= layer.radius + 1e-9);
        assert.ok(patch.y >= layer.altitudeMin && patch.y <= layer.altitudeMax);
        assert.ok(patch.y >= SKY_CLOUD_ALTITUDE.min && patch.y <= SKY_CLOUD_ALTITUDE.max);
        assert.ok(patch.width > 0);
        assert.ok(patch.depth > 0);
      }
    });
  }
});

test('legacy flattened cloud layout still reports the same total patch count', () => {
  for (const tier of ['low', 'medium', 'high']) {
    const layout = skyCloudLayout(tier);
    assert.equal(layout.length, SKY_CLOUD_PATCH_BUDGET[tier]);
    assert.equal(
      layout.length,
      skyCloudLayerPolicy(tier).reduce((sum, layer) => sum + layer.patchCount, 0)
    );
  }
});
