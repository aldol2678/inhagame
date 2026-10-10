import test from "node:test";
import assert from "node:assert/strict";
import {
  BIRYONG_MOBILE_VIEWPORT_CI_BUDGET,
  BIRYONG_PERFORMANCE_VERSION,
  BIRYONG_VISUAL_PERFORMANCE_BUDGET,
  assessBiryongCiFrameSample,
  biryongStructuralPerformanceSnapshot
} from "../src/biryong/biryong-performance-budget.js";
import { createBiryongPerformanceMonitor } from "../src/biryong/biryong-performance-monitor.js";

test("P0-E structural budgets cover current P0-C density cost monotonically", () => {
  const low = biryongStructuralPerformanceSnapshot("low");
  const medium = biryongStructuralPerformanceSnapshot("medium");
  const high = biryongStructuralPerformanceSnapshot("high");

  assert.equal(low.version, BIRYONG_PERFORMANCE_VERSION);
  assert.deepEqual(
    [low.placements, medium.placements, high.placements],
    [17, 41, 60]
  );
  assert.deepEqual(
    [low.renderMeshes, medium.renderMeshes, high.renderMeshes],
    [24, 60, 88]
  );
  assert.deepEqual(
    [low.potentialShadowCasters, medium.potentialShadowCasters, high.potentialShadowCasters],
    [11, 29, 44]
  );
  for (const snapshot of [low, medium, high]) {
    assert.equal(snapshot.withinBudget, true);
    assert.deepEqual(snapshot.violations, []);
    assert.equal(snapshot.extraRealLights, 0);
    assert.equal(snapshot.externalTextures, 0);
    assert.equal(snapshot.networkRequests, 0);
    assert.equal(snapshot.screenSpacePostPasses, 0);
  }
});

test("P0-E CI frame assessment is a broad regression gate, not a real-device claim", () => {
  const pass = assessBiryongCiFrameSample({
    tier: "medium",
    baseline: { p95Ms: 20 },
    visual: { p95Ms: 36, p99Ms: 65, longFrameRate: 0.08 }
  });
  assert.equal(pass.withinCiSurrogateBudget, true);
  assert.ok(pass.p95Ratio > 1);

  const fail = assessBiryongCiFrameSample({
    tier: "high",
    baseline: { p95Ms: 16.7 },
    visual: { p95Ms: 160, p99Ms: 260, longFrameRate: 0.6 }
  });
  assert.equal(fail.withinCiSurrogateBudget, false);
  assert.ok(fail.violations.length >= 3);

  assert.equal(BIRYONG_MOBILE_VIEWPORT_CI_BUDGET.tier, "low");
  assert.ok(BIRYONG_VISUAL_PERFORMANCE_BUDGET.high.renderMeshes >= 88);
});

test("P0-E monitor resets samples when graphics tier changes", () => {
  let tier = "low";
  let active = true;
  const monitor = createBiryongPerformanceMonitor({
    enabled: true,
    getActive: () => active,
    getGraphicsTier: () => tier,
    getDensityStatus: () => ({ enabled: true }),
    getLightingStatus: () => ({ active: true }),
    getAtmosphereStatus: () => ({ active: true }),
    maxSamples: 120
  });

  for (let i = 0; i < 80; i += 1) monitor.update(1 / 60);
  assert.equal(monitor.status().frames.sampleCount, 80);
  assert.equal(monitor.status().tier, "low");
  assert.ok(monitor.status().frames.estimatedFps > 59);

  tier = "high";
  monitor.update(1 / 30);
  assert.equal(monitor.status().tier, "high");
  assert.equal(monitor.status().frames.sampleCount, 1);

  active = false;
  assert.equal(monitor.update(1 / 60), false);
  assert.equal(monitor.status().active, false);
});

test("P0-E disabled monitor remains inert", () => {
  const monitor = createBiryongPerformanceMonitor({
    enabled: false,
    getGraphicsTier: () => "medium"
  });
  assert.equal(monitor.update(1 / 60), false);
  assert.equal(monitor.reset(), false);
  assert.equal(monitor.status().enabled, false);
});

test('P0-E rendered-frame timestamps report 30 FPS even when update ticks run at 60 Hz', () => {
  const monitor = createBiryongPerformanceMonitor({ enabled: true, getActive: () => true });
  assert.equal(monitor.recordFrame(1000), false);
  for (let i = 1; i <= 60; i++) monitor.recordFrame(1000 + i * 1000 / 30);
  const status = monitor.status();
  assert.equal(status.frames.sampleCount, 60);
  assert.ok(Math.abs(status.frames.estimatedFps - 30) < 0.001);
  assert.equal(status.measurement.kind, 'render-frame-interval');
  assert.equal(status.measurement.gpuTimeMeasured, false);
});

test('P0-E timestamp anchors reset on hidden, region exit, tier change and explicit reset', () => {
  let active = true, visible = true, tier = 'low';
  const monitor = createBiryongPerformanceMonitor({ enabled: true,
    getActive: () => active, getVisible: () => visible, getGraphicsTier: () => tier });
  monitor.recordFrame(100); monitor.recordFrame(120);
  visible = false; monitor.suspend();
  visible = true; monitor.recordFrame(10000); monitor.recordFrame(10020);
  assert.equal(monitor.status().frames.maxMs, 20);
  active = false; monitor.recordFrame(10030);
  active = true; monitor.recordFrame(20000); monitor.recordFrame(20020);
  assert.equal(monitor.status().frames.maxMs, 20);
  tier = 'high'; monitor.recordFrame(30000);
  assert.equal(monitor.status().frames.sampleCount, 0);
  monitor.recordFrame(30020);
  assert.equal(monitor.status().frames.maxMs, 20);
  monitor.reset(); monitor.recordFrame(40000);
  assert.equal(monitor.status().frames.sampleCount, 0);
  monitor.recordFrame(40020);
  assert.equal(monitor.status().frames.maxMs, 20);
  visible = false; assert.equal(monitor.recordFrame(50000), false);
  visible = true; monitor.recordFrame(60000);
  assert.equal(monitor.status().frames.maxMs, 20);
});

test('P0-E malformed timestamps reset the anchor without masking valid slow renders', () => {
  const monitor = createBiryongPerformanceMonitor({ enabled: true, getActive: () => true });
  monitor.recordFrame(100); monitor.recordFrame(200);
  assert.equal(monitor.status().frames.maxMs, 100);
  monitor.recordFrame(NaN); monitor.recordFrame(10000); monitor.recordFrame(10020);
  assert.equal(monitor.status().frames.sampleCount, 2);
});


test('runtime samples postrender rather than simulation update and resets navigation anchors', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes('app.on("postrender", updateBiryongPerformance)'));
  assert.ok(!main.includes('app.on("update", updateBiryongPerformance)'));
  assert.ok(main.includes('biryongPerformance.recordFrame(performance.now())'));
  assert.match(main, /markRegion: id => \{\s*biryongPerformance.suspend\(\)/);
});
