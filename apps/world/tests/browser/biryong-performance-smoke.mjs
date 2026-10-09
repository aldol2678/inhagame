import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";
import {
  BIRYONG_MOBILE_VIEWPORT_CI_BUDGET,
  biryongStructuralPerformanceSnapshot
} from "../../src/biryong/biryong-performance-budget.js";

import { classifyBiryongSamples, boundedPerformancePhase } from "./biryong-performance-diagnostics.mjs";

const BASELINE_ONLY = process.env.BIRYONG_PERF_MODE === 'baseline-only';
const TIERS = BASELINE_ONLY && process.env.BIRYONG_PERF_TIERS === 'low' ? ['low'] : ["low", "medium", "high"];
const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 90;

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

async function waitWorld(page) {
  await page.waitForFunction(
    () => window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true,
    null,
    { timeout: TIMEOUT_MS }
  );
}

async function enterBiryong(page) {
  const entered = await page.evaluate(() => window.__INHAGAME_P0__.biryongRealm.enter());
  assert.equal(entered, true, "Biryong transition should start");
  await page.waitForFunction(
    () => window.__INHAGAME_P0__?.biryongRealm?.inBiryong === true,
    null,
    { timeout: TIMEOUT_MS }
  );
  await page.evaluate(() => {
    const player = window.__INHAGAME_P0__.player;
    const p = player.getLocalPosition();
    player.setLocalPosition(0, p.y, 75);
    const orbit = window.__INHAGAME_P0__.orbit;
    orbit.firstPerson = false;
    orbit.yaw = 0;
    orbit.pitch = Math.atan2(7.3, 18.5);
    orbit.distance = 3.5;
  });
}

async function setTier(page, tier) {
  await page.bringToFront();
  await page.evaluate(value => window.__INHAGAME_P0__.graphics.setPreference(value), tier);
  await page.waitForFunction(
    value => window.__INHAGAME_P0__?.getStatus?.().graphics?.tier === value,
    tier,
    { timeout: TIMEOUT_MS }
  );
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const step = () => {
      frames += 1;
      if (frames >= 12) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
}

async function measureFrames(page) {
  await page.bringToFront();
  return page.evaluate(({ warmupFrames, sampleFrames }) => new Promise(resolve => {
    let previous = null;
    let warmup = 0;
    const samples = [];

    const percentile = (sorted, fraction) => {
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
      return sorted[index];
    };

    const step = timestamp => {
      if (previous !== null) {
        const delta = timestamp - previous;
        if (warmup < warmupFrames) warmup += 1;
        else if (Number.isFinite(delta) && delta > 0) samples.push(delta);
      }
      previous = timestamp;
      if (samples.length < sampleFrames) return requestAnimationFrame(step);

      const sorted = [...samples].sort((a, b) => a - b);
      const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const longFrameRate = samples.filter(value => value > 50).length / samples.length;
      resolve({
        sampleCount: samples.length,
        meanMs,
        p50Ms: percentile(sorted, 0.50),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        maxMs: sorted.at(-1),
        estimatedFps: 1000 / meanMs,
        longFrameRate,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        heap: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null
      });
    };
    requestAnimationFrame(step);
  }), { warmupFrames: WARMUP_FRAMES, sampleFrames: SAMPLE_FRAMES });
}

const receipt = {
  schema: "biryong-visual-performance-ci-v2",
  measurementClass: "CI_BROWSER_SURROGATE",
  frameMeasurement: "browser-animation-frame-interval",
  monitorMeasurement: "render-frame-interval",
  gpuTimeMeasured: false,
  mode: BASELINE_ONLY ? 'baseline-only' : 'visual-comparison',
  exactHead: process.env.BIRYONG_PERF_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null,
  sourceTree: process.env.BIRYONG_PERF_SOURCE_TREE ?? null,
  samplerHead: process.env.GITHUB_SHA ?? null,
  realDevice: false, thermalMeasured: false, batteryMeasured: false, gpuDriverRepresentative: false,
  note: "Headless CI catches catastrophic regressions. It does not replace Android/PC real-device profiling.",
  cachePolicy: "Fresh page and cleared localStorage per boot; HTTP cache disabled by routed harness. Browser process/shader cache order effects are not controlled.",
  status: "RUNNING", phase: null, progress: [], baseline: {}, desktop: {}, mobileViewport: null
};
let smoke;
const fatals = new WeakMap();
async function persist() {
  if (process.env.BIRYONG_PERF_RECEIPT)
    await writeFile(process.env.BIRYONG_PERF_RECEIPT, JSON.stringify(receipt, null, 2));
}
async function phase(label, work, page = null) {
  const start = Date.now();
  receipt.phase = label;
  console.log("BIRYONG_PERF_PROGRESS", JSON.stringify({ phase: label, state: "START", at: new Date(start).toISOString() }));
  await persist();
  try {
    const result = await boundedPerformancePhase(work, { label, timeoutMs: TIMEOUT_MS, fatal: page ? fatals.get(page) : null });
    receipt.progress.push({ phase: label, state: "DONE", elapsedMs: Date.now() - start });
    console.log("BIRYONG_PERF_PROGRESS", JSON.stringify(receipt.progress.at(-1)));
    await persist();
    return result;
  } catch (error) {
    receipt.progress.push({ phase: label, state: "ERROR", elapsedMs: Date.now() - start, error: String(error) });
    await persist();
    throw error;
  }
}
async function bootScenario(label, query) {
  const page = await smoke.context.newPage();
  fatals.set(page, smoke.watch(page));
  // The previous HIGH baseline must not change the next scenario's boot preset.
  await page.addInitScript(() => localStorage.clear());
  await phase(`${label}:boot`, async () => {
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear${query}`, {
      waitUntil: "domcontentloaded", timeout: TIMEOUT_MS
    });
    await waitWorld(page);
    await enterBiryong(page);
  }, page);
  return page;
}
async function sceneSnapshot(page) {
  return page.evaluate(() => {
    const runtime = window.__INHAGAME_P0__, app = runtime.app;
    const device = app.graphicsDevice, gl = device.gl;
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const position = runtime.player.getLocalPosition();
    const graphics = runtime.graphics.status();
    const environment = window.__INHAGAME_ENVIRONMENT__.status();
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      drawingBuffer: { width: device.canvas.width, height: device.canvas.height },
      renderer: runtime.getStatus().renderer,
      driver: gl ? { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR),
        renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) } : { renderer: 'WebGPU' },
      visible: document.visibilityState, inBiryong: runtime.biryongRealm.inBiryong,
      position: [position.x, position.y, position.z],
      camera: { yaw: runtime.orbit.yaw, pitch: runtime.orbit.pitch, distance: runtime.orbit.distance, firstPerson: runtime.orbit.firstPerson },
      environment: { time: environment.targetTime, weather: environment.targetWeather },
      graphics: { tier: graphics.tier, frameLimit: graphics.frameLimit ?? 'auto', renderScale: graphics.renderScale ?? 'auto',
        shadowResolution: graphics.shadowResolution, castShadows: graphics.castShadows },
      drawCalls: app.stats?.drawCalls?.total ?? null,
      renderComponents: app.root.findComponents('render').length
    };
  });
}
function assertComparable(baseline, visual) {
  for (const key of ['viewport', 'drawingBuffer', 'renderer', 'driver', 'visible', 'inBiryong', 'camera', 'environment', 'graphics'])
    assert.deepEqual(visual[key], baseline[key], `${key}: baseline/visual comparison conditions must match`);
  assert.equal(visual.inBiryong, true);
  assert.equal(visual.visible, 'visible');
  visual.position.forEach((value, index) => assert.ok(Math.abs(value - baseline.position[index]) < 0.01, 'same player position'));
}
try {
  smoke = await startSmoke({ worldRoot: process.env.BIRYONG_PERF_WORLD_ROOT });
  const baselinePage = await bootScenario('baseline', '');
  for (const tier of TIERS) {
    await phase(`baseline:${tier}:settle`, () => setTier(baselinePage, tier), baselinePage);
    const sample = await phase(`baseline:${tier}:sample`, () => measureFrames(baselinePage), baselinePage);
    const scene = await phase(`baseline:${tier}:snapshot`, () => sceneSnapshot(baselinePage), baselinePage);
    const baselineCheck = classifyBiryongSamples({ tier, baseline: sample, visual: sample });
    receipt.baseline[tier] = { ...sample, scene, validity: {
      validForComparison: baselineCheck.baselineValid,
      outcome: baselineCheck.baselineValid ? 'VALID' : 'INCONCLUSIVE',
      violations: baselineCheck.baselineAssessment.violations
    } };
    console.log('BIRYONG_PERF_BASELINE', JSON.stringify({ tier, sample, scene }));
    await persist();
  }
  await phase('baseline:close', () => baselinePage.close());
  if (BASELINE_ONLY) {
    receipt.status = TIERS.every(tier => receipt.baseline[tier].validity.validForComparison) ? 'PASS' : 'INCONCLUSIVE';
    if (receipt.status !== 'PASS') process.exitCode = 1;
  } else {
  const visualPage = await bootScenario('visual', '&biryongVisual=p0e');
  for (const tier of TIERS) {
    const baseline = receipt.baseline[tier];
    await phase(`visual:${tier}:settle`, () => setTier(visualPage, tier), visualPage);
    await phase(`visual:${tier}:reset`, () => visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.reset()), visualPage);
    const visual = await phase(`visual:${tier}:sample`, () => measureFrames(visualPage), visualPage);
    // Save samples before any further wait/assertion, so failures keep their evidence.
    receipt.desktop[tier] = { baseline, visual, ciSurrogatePass: false };
    await persist();
    await phase(`visual:${tier}:rendered-samples`, () => visualPage.waitForFunction(
      () => window.__INHAGAME_BIRYONG_PERFORMANCE__?.status?.().frames?.sampleCount >= 60,
      null, { timeout: TIMEOUT_MS }
    ), visualPage);
    const monitor = await phase(`visual:${tier}:monitor`, () => visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.status()), visualPage);
    const scene = await phase(`visual:${tier}:snapshot`, () => sceneSnapshot(visualPage), visualPage);
    const structural = biryongStructuralPerformanceSnapshot(tier);
    const assessment = classifyBiryongSamples({ tier, baseline, visual });
    Object.assign(receipt.desktop[tier], { structural, scene, monitor, assessment,
      p95Ratio: round(assessment.visualAssessment.p95Ratio), sceneComparable: false, ciSurrogatePass: false });
    await persist();
    console.log('BIRYONG_PERF_TIER', JSON.stringify({ tier, baseline, visual, assessment }));
    assertComparable(baseline.scene, scene);
    receipt.desktop[tier].sceneComparable = true;
    assert.equal(structural.withinBudget, true, `${tier} structural budget`);
    assert.equal(monitor.enabled, true); assert.equal(monitor.active, true);
    assert.equal(monitor.tier, tier); assert.equal(monitor.structural.withinBudget, true);
    if (!assessment.passed) {
      receipt.status = assessment.outcome;
      throw new Error(`${tier} ${assessment.outcome}: ${assessment.reason ?? assessment.visualAssessment.violations.join(', ')}`);
    }
    receipt.desktop[tier].ciSurrogatePass = true;
    await persist();
  }
  await phase('mobile:viewport', () => visualPage.setViewportSize({ width: 390, height: 844 }), visualPage);
  await phase('mobile:low:settle', () => setTier(visualPage, 'low'), visualPage);
  await phase('mobile:low:reset', () => visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.reset()), visualPage);
  const mobileVisual = await phase('mobile:low:sample', () => measureFrames(visualPage), visualPage);
  const desktopLow = receipt.desktop.low.visual;
  const assessment = classifyBiryongSamples({ tier: 'low', baseline: desktopLow, visual: mobileVisual, mobileViewport: true });
  receipt.mobileViewport = {
    kind: '390x844 viewport surrogate on the same CI browser, not a physical phone',
    comparison: 'mobile ON vs desktop LOW ON; not a mobile OFF/ON comparison',
    tier: BIRYONG_MOBILE_VIEWPORT_CI_BUDGET.tier, visual: mobileVisual, assessment,
    p95VsDesktopLow: round(mobileVisual.p95Ms / Math.max(.001, desktopLow.p95Ms)),
    ciSurrogatePass: assessment.passed
  };
  if (!assessment.passed) { receipt.status = assessment.outcome; throw new Error(`mobile ${assessment.outcome}`); }
  }
  assert.deepEqual(smoke.problems, []);
  if (receipt.status === 'RUNNING') receipt.status = 'PASS';
} catch (error) {
  if (receipt.status !== 'INCONCLUSIVE') receipt.status = 'FAIL';
  receipt.error = String(error);
  process.exitCode = 1;
  console.error('BIRYONG_PERFORMANCE_ERROR', error);
} finally {
  try {
    if (smoke) await boundedPerformancePhase(() => smoke.close(), { label: 'cleanup', timeoutMs: TIMEOUT_MS });
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.cleanupError = String(error);
    process.exitCode = 1;
  }
  receipt.completedAt = new Date().toISOString();
  receipt.problems = smoke?.problems ?? [];
  await persist();
  console.log('BIRYONG_PERFORMANCE_RECEIPT');
  console.log(JSON.stringify(receipt, null, 2));
}
