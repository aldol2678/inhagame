import test from "node:test";
import assert from "node:assert/strict";
import {
  BIRYONG_ENVIRONMENT_BASE,
  BIRYONG_ENVIRONMENT_DENSITY_VERSION,
  BIRYONG_ENVIRONMENT_HIGH,
  BIRYONG_ENVIRONMENT_MEDIUM,
  biryongEnvironmentDensityPolicy
} from "../src/biryong/biryong-environment-density-policy.js";

test("P0-C density grows monotonically across graphics tiers", () => {
  const low = biryongEnvironmentDensityPolicy("low");
  const medium = biryongEnvironmentDensityPolicy("medium");
  const high = biryongEnvironmentDensityPolicy("high");

  assert.equal(low.version, BIRYONG_ENVIRONMENT_DENSITY_VERSION);
  assert.ok(low.counts.total < medium.counts.total);
  assert.ok(medium.counts.total < high.counts.total);
  assert.equal(low.counts.total, BIRYONG_ENVIRONMENT_BASE.length);
  assert.equal(medium.counts.total, BIRYONG_ENVIRONMENT_BASE.length + BIRYONG_ENVIRONMENT_MEDIUM.length);
  assert.equal(high.counts.total,
    BIRYONG_ENVIRONMENT_BASE.length + BIRYONG_ENVIRONMENT_MEDIUM.length + BIRYONG_ENVIRONMENT_HIGH.length);
});

test("P0-C decoration preserves the central walkable corridor", () => {
  const placements = biryongEnvironmentDensityPolicy("high").placements;
  for (const item of placements) {
    assert.ok(Math.abs(item.x) >= 8, `${item.kind} at x=${item.x} intrudes into the central corridor`);
    assert.ok(item.x >= -65 && item.x <= 65);
    assert.ok(item.z >= -20 && item.z <= 135);
    assert.ok(item.scale > 0 && item.scale <= 1.2);
  }
});

test("P0-C uses only visual non-gameplay prop kinds", () => {
  const allowed = new Set(["tree", "shrub", "rock", "lantern", "marker"]);
  for (const item of biryongEnvironmentDensityPolicy("high").placements)
    assert.ok(allowed.has(item.kind), `unexpected density kind: ${item.kind}`);
});

test("unknown tier safely falls back to medium density", () => {
  const fallback = biryongEnvironmentDensityPolicy("ultra");
  assert.equal(fallback.tier, "medium");
  assert.equal(fallback.counts.total,
    BIRYONG_ENVIRONMENT_BASE.length + BIRYONG_ENVIRONMENT_MEDIUM.length);
});
