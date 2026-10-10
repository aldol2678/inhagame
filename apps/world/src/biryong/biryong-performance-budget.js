import { biryongEnvironmentDensityPolicy } from "./biryong-environment-density-policy.js";

export const BIRYONG_PERFORMANCE_VERSION = "biryong.visual.performance.p0e.v1";

const KIND_RENDER_MESHES = Object.freeze({
  tree: 2,
  shrub: 1,
  rock: 1,
  lantern: 2,
  marker: 2
});

const KIND_SHADOW_CASTERS = Object.freeze({
  tree: 2,
  shrub: 0,
  rock: 0,
  lantern: 1,
  marker: 1
});

export const BIRYONG_VISUAL_PERFORMANCE_BUDGET = Object.freeze({
  low: Object.freeze({
    placements: 20,
    renderMeshes: 28,
    potentialShadowCasters: 14,
    runtimeTargetP95Ms: 33.4,
    ciSurrogateP95Ms: 85,
    ciSurrogateP99Ms: 160,
    ciMaxP95Ratio: 2.75,
    ciMaxLongFrameRate: 0.35
  }),
  medium: Object.freeze({
    placements: 45,
    renderMeshes: 68,
    potentialShadowCasters: 34,
    runtimeTargetP95Ms: 33.4,
    ciSurrogateP95Ms: 100,
    ciSurrogateP99Ms: 180,
    ciMaxP95Ratio: 2.75,
    ciMaxLongFrameRate: 0.38
  }),
  high: Object.freeze({
    placements: 64,
    renderMeshes: 96,
    potentialShadowCasters: 48,
    runtimeTargetP95Ms: 33.4,
    ciSurrogateP95Ms: 120,
    ciSurrogateP99Ms: 220,
    ciMaxP95Ratio: 3.00,
    ciMaxLongFrameRate: 0.42
  })
});

export const BIRYONG_MOBILE_VIEWPORT_CI_BUDGET = Object.freeze({
  tier: "low",
  p95Ms: 120,
  p99Ms: 220,
  longFrameRate: 0.42
});

export function biryongPerformanceBudget(tier = "medium") {
  return BIRYONG_VISUAL_PERFORMANCE_BUDGET[tier] ?? BIRYONG_VISUAL_PERFORMANCE_BUDGET.medium;
}

export function biryongStructuralPerformanceSnapshot(tier = "medium") {
  const density = biryongEnvironmentDensityPolicy(tier);
  const kindCounts = {};
  let renderMeshes = 0;
  let potentialShadowCasters = 0;
  for (const item of density.placements) {
    kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
    renderMeshes += KIND_RENDER_MESHES[item.kind] ?? 0;
    potentialShadowCasters += KIND_SHADOW_CASTERS[item.kind] ?? 0;
  }
  const budget = biryongPerformanceBudget(density.tier);
  const violations = [];
  if (density.placements.length > budget.placements)
    violations.push(`placements:${density.placements.length}>${budget.placements}`);
  if (renderMeshes > budget.renderMeshes)
    violations.push(`renderMeshes:${renderMeshes}>${budget.renderMeshes}`);
  if (potentialShadowCasters > budget.potentialShadowCasters)
    violations.push(`potentialShadowCasters:${potentialShadowCasters}>${budget.potentialShadowCasters}`);

  return Object.freeze({
    version: BIRYONG_PERFORMANCE_VERSION,
    tier: density.tier,
    budget,
    placements: density.placements.length,
    kindCounts: Object.freeze({ ...kindCounts }),
    renderMeshes,
    potentialShadowCasters,
    extraRealLights: 0,
    externalTextures: 0,
    networkRequests: 0,
    screenSpacePostPasses: 0,
    withinBudget: violations.length === 0,
    violations: Object.freeze(violations)
  });
}

export function assessBiryongCiFrameSample({
  tier = "medium",
  baseline = {},
  visual = {},
  mobileViewport = false
} = {}) {
  const resolvedTier = Object.hasOwn(BIRYONG_VISUAL_PERFORMANCE_BUDGET, tier) ? tier : "medium";
  const budget = mobileViewport
    ? BIRYONG_MOBILE_VIEWPORT_CI_BUDGET
    : BIRYONG_VISUAL_PERFORMANCE_BUDGET[resolvedTier];
  const violations = [];
  const p95 = Number(visual.p95Ms);
  const p99 = Number(visual.p99Ms);
  const longFrameRate = Number(visual.longFrameRate);
  const baselineP95 = Number(baseline.p95Ms);
  const ratio = Number.isFinite(baselineP95) && baselineP95 > 0 && Number.isFinite(p95)
    ? p95 / baselineP95
    : null;

  const p95Limit = mobileViewport ? budget.p95Ms : budget.ciSurrogateP95Ms;
  const p99Limit = mobileViewport ? budget.p99Ms : budget.ciSurrogateP99Ms;
  const longLimit = mobileViewport ? budget.longFrameRate : budget.ciMaxLongFrameRate;
  if (!Number.isFinite(p95) || p95 > p95Limit) violations.push(`p95Ms:${p95}>${p95Limit}`);
  if (!Number.isFinite(p99) || p99 > p99Limit) violations.push(`p99Ms:${p99}>${p99Limit}`);
  if (!Number.isFinite(longFrameRate) || longFrameRate > longLimit)
    violations.push(`longFrameRate:${longFrameRate}>${longLimit}`);
  if (!mobileViewport && ratio !== null && ratio > budget.ciMaxP95Ratio)
    violations.push(`p95Ratio:${ratio.toFixed(3)}>${budget.ciMaxP95Ratio}`);

  return Object.freeze({
    tier: resolvedTier,
    mobileViewport,
    p95Ratio: ratio,
    withinCiSurrogateBudget: violations.length === 0,
    violations: Object.freeze(violations)
  });
}
