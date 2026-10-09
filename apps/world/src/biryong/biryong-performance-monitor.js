import {
  BIRYONG_PERFORMANCE_VERSION,
  biryongPerformanceBudget,
  biryongStructuralPerformanceSnapshot
} from "./biryong-performance-budget.js";

const percentile = (sorted, fraction) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
};

function frameStats(samples) {
  if (!samples.length) return Object.freeze({
    sampleCount: 0,
    meanMs: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
    estimatedFps: null,
    longFrameRate: null
  });
  const sorted = [...samples].sort((a, b) => a - b);
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const longFrames = samples.filter(value => value > 50).length;
  return Object.freeze({
    sampleCount: samples.length,
    meanMs,
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.at(-1),
    estimatedFps: meanMs > 0 ? 1000 / meanMs : null,
    longFrameRate: longFrames / samples.length
  });
}

export function createBiryongPerformanceMonitor({
  enabled = false,
  getActive = () => false,
  getVisible = () => true,
  getGraphicsTier = () => "medium",
  getDensityStatus = () => null,
  getLightingStatus = () => null,
  getAtmosphereStatus = () => null,
  maxSamples = 600
} = {}) {
  const capacity = Math.max(60, Math.floor(Number(maxSamples) || 600));
  if (enabled !== true) {
    return Object.freeze({
      update: () => false,
      recordFrame: () => false,
      suspend: () => false,
      reset: () => false,
      status: () => Object.freeze({
        version: BIRYONG_PERFORMANCE_VERSION,
        enabled: false,
        active: false,
        tier: getGraphicsTier(),
        frames: frameStats([]),
        structural: biryongStructuralPerformanceSnapshot(getGraphicsTier())
      })
    });
  }

  let samples = [];
  let tier = null;
  let previousRenderTimestamp = null;

  function reset() {
    samples = [];
    previousRenderTimestamp = null;
    tier = getGraphicsTier();
    return true;
  }

  function suspend() {
    previousRenderTimestamp = null;
    return true;
  }

  // Timestamped postrender observations measure rendered-frame cadence, not GPU duration.
  function recordFrame(timestampMs) {
    if (getActive() !== true || getVisible() !== true || !Number.isFinite(timestampMs)) {
      suspend();
      return false;
    }
    if (tier !== getGraphicsTier()) reset();
    const previous = previousRenderTimestamp;
    previousRenderTimestamp = timestampMs;
    if (previous === null || timestampMs <= previous) return false;
    return update((timestampMs - previous) / 1000);
  }

  // Retain the interval-ingestion API for existing callers/tests. Runtime uses recordFrame.
  function update(dt) {
    if (getActive() !== true || getVisible() !== true) { suspend(); return false; }
    const nextTier = getGraphicsTier();
    if (tier !== nextTier) {
      tier = nextTier;
      samples = [];
    }
    const ms = Math.max(0, Number(dt) * 1000);
    if (!Number.isFinite(ms) || ms <= 0) return false;
    samples.push(ms);
    if (samples.length > capacity) samples.shift();
    return true;
  }

  function status() {
    const resolvedTier = tier ?? getGraphicsTier();
    const frames = frameStats(samples);
    const budget = biryongPerformanceBudget(resolvedTier);
    return Object.freeze({
      version: BIRYONG_PERFORMANCE_VERSION,
      enabled: true,
      active: getActive() === true && getVisible() === true,
      measurement: Object.freeze({ kind: "render-frame-interval", gpuTimeMeasured: false }),
      tier: resolvedTier,
      frames,
      runtimeTarget: Object.freeze({
        p95Ms: budget.runtimeTargetP95Ms,
        met: frames.p95Ms === null ? null : frames.p95Ms <= budget.runtimeTargetP95Ms
      }),
      structural: biryongStructuralPerformanceSnapshot(resolvedTier),
      visual: Object.freeze({
        density: getDensityStatus(),
        lighting: getLightingStatus(),
        atmosphere: getAtmosphereStatus()
      })
    });
  }

  reset();
  return Object.freeze({ update, recordFrame, suspend, reset, status });
}
