import { getSetting, setSetting } from './settings-registry.js';
export const GRAPHICS_QUALITY_KEY = 'inha-world-graphics-quality-v1';
export const GRAPHICS_QUALITY_LABELS = Object.freeze({
  auto: '자동', low: '낮음', medium: '보통', high: '높음'
});

// maxPixelRatio caps the PlayCanvas drawing buffer independently of CSS/HUD pixels.
// The detail scales affect only visual chunk layers; residency and campus BASE stay
// under the user's separate view-distance setting.
export const GRAPHICS_PRESETS = Object.freeze({
  low: Object.freeze({ maxPixelRatio: 0.8, castShadows: false, shadowResolution: 512, shadowDistance: 50, detailScale: 0.7, nearScale: 0.75 }),
  medium: Object.freeze({ maxPixelRatio: 1.25, castShadows: true, shadowResolution: 1024, shadowDistance: 75, detailScale: 1, nearScale: 1 }),
  high: Object.freeze({ maxPixelRatio: 2, castShadows: true, shadowResolution: 2048, shadowDistance: 100, detailScale: 1.2, nearScale: 1.15 })
});

export function readGraphicsQuality(storage) {
  const value = getSetting(storage, 'graphics.quality');
  return Object.hasOwn(GRAPHICS_QUALITY_LABELS, value) ? value : 'auto';
}

export function saveGraphicsQuality(storage, value) {
  if (!Object.hasOwn(GRAPHICS_QUALITY_LABELS, value)) return false;
  return setSetting(storage, 'graphics.quality', value);
}

export function selectAutoGraphics({ width, height, dpr, mobile, maxTextureSize }) {
  const pixels = Math.max(1, width) * Math.max(1, height) * Math.max(1, dpr) ** 2;
  if (mobile || pixels > 5_000_000 || maxTextureSize < 4096)
    return { tier: 'low', reason: mobile ? 'mobile/coarse pointer' : pixels > 5_000_000 ? 'large native viewport' : 'GPU texture limit' };
  if (pixels <= 2_500_000 && maxTextureSize >= 8192)
    return { tier: 'high', reason: 'moderate native viewport and GPU texture limit' };
  return { tier: 'medium', reason: 'balanced device capability' };
}

export function visualPolicy(viewPreset, graphicsProfile) {
  if (graphicsProfile.detailScale === 1 && graphicsProfile.nearScale === 1) return viewPreset;
  return Object.freeze({
    ...viewPreset,
    detailEnter: viewPreset.detailEnter * graphicsProfile.detailScale,
    detailExit: viewPreset.detailExit * graphicsProfile.detailScale,
    nearEnter: viewPreset.nearEnter * graphicsProfile.nearScale,
    nearExit: viewPreset.nearExit * graphicsProfile.nearScale
  });
}

export function createGraphicsPresetController({ app, device, light, storage, viewport }) {
  if (!storage) { try { storage = globalThis.localStorage; } catch { /* Session-only setting. */ } }
  const auto = selectAutoGraphics(viewport);
  let preference = readGraphicsQuality(storage);
  let tier = preference === 'auto' ? auto.tier : preference;
  let profile = GRAPHICS_PRESETS[tier];
  const policyCache = new WeakMap();
  const apply = () => {
    profile = GRAPHICS_PRESETS[tier];
    device.maxPixelRatio = profile.maxPixelRatio;
    app.resizeCanvas();
    light.castShadows = profile.castShadows;
    light.shadowResolution = profile.shadowResolution;
    light.shadowDistance = profile.shadowDistance;
    console.info(`Graphics: ${preference.toUpperCase()} → ${tier.toUpperCase()} (${preference === 'auto' ? auto.reason : 'user override'})`);
  };
  apply();
  return {
    get preference() { return preference; },
    get tier() { return tier; },
    get profile() { return profile; },
    get autoReason() { return auto.reason; },
    setPreference(value) {
      if (!Object.hasOwn(GRAPHICS_QUALITY_LABELS, value)) return false;
      preference = value;
      tier = value === 'auto' ? auto.tier : value;
      apply();
      return saveGraphicsQuality(storage, value);
    },
    visualPolicy(viewPreset) {
      let byTier = policyCache.get(viewPreset);
      if (!byTier) { byTier = new Map(); policyCache.set(viewPreset, byTier); }
      if (!byTier.has(tier)) byTier.set(tier, visualPolicy(viewPreset, profile));
      return byTier.get(tier);
    },
    status() {
      return { preference, tier, autoReason: preference === 'auto' ? auto.reason : null,
        maxPixelRatio: device.maxPixelRatio, castShadows: light.castShadows,
        shadowResolution: light.shadowResolution, shadowDistance: light.shadowDistance };
    }
  };
}
