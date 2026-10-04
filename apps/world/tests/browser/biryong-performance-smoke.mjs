import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";
import {
  BIRYONG_MOBILE_VIEWPORT_CI_BUDGET,
  assessBiryongCiFrameSample,
  biryongStructuralPerformanceSnapshot
} from "../../src/biryong/biryong-performance-budget.js";

const TIERS = ["low", "medium", "high"];
const WARMUP_FRAMES = 45;
const SAMPLE_FRAMES = 150;

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
  });
}

async function setTier(page, tier) {
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

async function bootScenario(smoke, query) {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear${query}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS
  });
  await waitWorld(page);
  await enterBiryong(page);
  return page;
}

const smoke = await startSmoke();
const receipt = {
  schema: "biryong-visual-performance-ci-v1",
  measurementClass: "CI_BROWSER_SURROGATE",
  exactHead: process.env.GITHUB_SHA ?? null,
  realDevice: false,
  thermalMeasured: false,
  batteryMeasured: false,
  gpuDriverRepresentative: false,
  note: "Headless CI catches catastrophic regressions. It does not replace Android/PC real-device profiling.",
  desktop: {},
  mobileViewport: null
};

try {
  const baselinePage = await bootScenario(smoke, "");
  const visualPage = await bootScenario(smoke, "&biryongVisual=p0e");

  const renderers = await Promise.all([
    baselinePage.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer),
    visualPage.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer)
  ]);
  receipt.renderer = { baseline: renderers[0], visual: renderers[1] };

  for (const tier of TIERS) {
    await setTier(baselinePage, tier);
    const baseline = await measureFrames(baselinePage);

    await setTier(visualPage, tier);
    await visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.reset());
    const visual = await measureFrames(visualPage);
    await visualPage.waitForFunction(
      count => window.__INHAGAME_BIRYONG_PERFORMANCE__?.status?.().frames?.sampleCount >= count,
      100,
      { timeout: TIMEOUT_MS }
    );

    const monitor = await visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.status());
    const structural = biryongStructuralPerformanceSnapshot(tier);
    const assessment = assessBiryongCiFrameSample({ tier, baseline, visual });

    assert.equal(structural.withinBudget, true, `${tier} structural budget`);
    assert.equal(monitor.enabled, true);
    assert.equal(monitor.active, true);
    assert.equal(monitor.tier, tier);
    assert.equal(monitor.structural.withinBudget, true);
    assert.equal(assessment.withinCiSurrogateBudget, true,
      `${tier} CI surrogate regression: ${assessment.violations.join(", ")}`);

    receipt.desktop[tier] = {
      structural,
      baseline: {
        ...baseline,
        meanMs: round(baseline.meanMs),
        p50Ms: round(baseline.p50Ms),
        p95Ms: round(baseline.p95Ms),
        p99Ms: round(baseline.p99Ms),
        maxMs: round(baseline.maxMs),
        estimatedFps: round(baseline.estimatedFps, 2),
        longFrameRate: round(baseline.longFrameRate, 4)
      },
      visual: {
        ...visual,
        meanMs: round(visual.meanMs),
        p50Ms: round(visual.p50Ms),
        p95Ms: round(visual.p95Ms),
        p99Ms: round(visual.p99Ms),
        maxMs: round(visual.maxMs),
        estimatedFps: round(visual.estimatedFps, 2),
        longFrameRate: round(visual.longFrameRate, 4)
      },
      p95Ratio: round(assessment.p95Ratio, 3),
      ciSurrogatePass: true,
      monitor: {
        frames: monitor.frames,
        runtimeTarget: monitor.runtimeTarget
      }
    };
  }

  await visualPage.setViewportSize({ width: 390, height: 844 });
  await setTier(visualPage, "low");
  await visualPage.evaluate(() => window.__INHAGAME_BIRYONG_PERFORMANCE__.reset());
  const mobileVisual = await measureFrames(visualPage);
  const desktopLow = receipt.desktop.low.visual;
  const mobileAssessment = assessBiryongCiFrameSample({
    tier: "low",
    baseline: desktopLow,
    visual: mobileVisual,
    mobileViewport: true
  });
  assert.equal(mobileAssessment.withinCiSurrogateBudget, true,
    `mobile viewport surrogate: ${mobileAssessment.violations.join(", ")}`);

  receipt.mobileViewport = {
    kind: "390x844 viewport surrogate on the same CI browser, not a physical phone",
    tier: BIRYONG_MOBILE_VIEWPORT_CI_BUDGET.tier,
    visual: {
      ...mobileVisual,
      meanMs: round(mobileVisual.meanMs),
      p50Ms: round(mobileVisual.p50Ms),
      p95Ms: round(mobileVisual.p95Ms),
      p99Ms: round(mobileVisual.p99Ms),
      maxMs: round(mobileVisual.maxMs),
      estimatedFps: round(mobileVisual.estimatedFps, 2),
      longFrameRate: round(mobileVisual.longFrameRate, 4)
    },
    p95VsDesktopLow: round(
      mobileVisual.p95Ms / Math.max(0.001, receipt.desktop.low.visual.p95Ms),
      3
    ),
    ciSurrogatePass: true
  };

  console.log("BIRYONG_PERFORMANCE_RECEIPT");
  console.log(JSON.stringify(receipt, null, 2));

  if (process.env.BIRYONG_PERF_RECEIPT) {
    await writeFile(process.env.BIRYONG_PERF_RECEIPT, JSON.stringify(receipt, null, 2));
  }

  assert.deepEqual(smoke.problems, []);
} finally {
  await smoke.close();
}
