import { getSetting, setSetting, readSettings, updateSettings, SETTINGS_DEFAULTS } from './settings-registry.js';
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

export function createGraphicsPresetController({ app, device, light, storage, viewport,
  document: doc = globalThis.document, window: win = globalThis.window, fpsElement = doc?.getElementById('graphics-fps'),
  now = () => performance.now() }) {
  if (!storage) { try { storage = globalThis.localStorage; } catch { /* Session-only setting. */ } }
  const auto = selectAutoGraphics(viewport);
  let details = readSettings(storage).graphics;
  let preference = details.quality;
  let tier = preference === 'auto' ? auto.tier : preference;
  let profile = GRAPHICS_PRESETS[tier];
  const policyCache = new WeakMap();
  const originalAutoRender = app.autoRender;
  let nextFrame = null, sampleStart = null, renderedFrames = 0, fps = null, destroyed = false;
  const resetTiming = () => { nextFrame = null; sampleStart = null; renderedFrames = 0; fps = null;
    if (fpsElement) fpsElement.textContent = '— FPS'; };
  // Keep simulation/input on every engine update. Only GPU rendering is paced.
  const update = () => {
    if (doc?.hidden) { app.autoRender = false; app.renderNextFrame = false; return; }
    app.autoRender = details.frameLimit === 'auto';
    if (app.autoRender) return;
    const time = now(), interval = 1000 / details.frameLimit;
    if (nextFrame === null || time + 0.01 >= nextFrame) {
      app.renderNextFrame = true;
      nextFrame = nextFrame === null || time - nextFrame > interval
        ? time + interval : nextFrame + interval;
    }
  };
  const postrender = () => {
    if (!details.showFps) return;
    const time = now();
    if (sampleStart === null) { sampleStart = time; return; }
    renderedFrames++;
    if (time - sampleStart >= 1000) {
      fps = Math.round(renderedFrames * 1000 / (time - sampleStart));
      if (fpsElement) fpsElement.textContent = `${fps} FPS`;
      sampleStart = time; renderedFrames = 0;
    }
  };
  app.on?.('update', update);
  app.on?.('postrender', postrender);
  doc?.addEventListener('visibilitychange', resetTiming);
  win?.addEventListener('pageshow', resetTiming);
  const apply = () => {
    profile = GRAPHICS_PRESETS[tier];
    device.maxPixelRatio = details.renderScale === 'auto' ? profile.maxPixelRatio
      : Math.min(Math.max(1, viewport.dpr || 1), 2) * details.renderScale;
    app.resizeCanvas();
    const shadow = GRAPHICS_PRESETS[details.shadows] || profile;
    light.castShadows = details.shadows === 'auto' ? profile.castShadows : details.shadows !== 'off';
    light.shadowResolution = shadow.shadowResolution;
    light.shadowDistance = shadow.shadowDistance;
    app.autoRender = details.frameLimit === 'auto';
    app.renderNextFrame = false;
    if (fpsElement) fpsElement.hidden = !details.showFps;
    resetTiming();
    console.info(`Graphics: ${preference.toUpperCase()} → ${tier.toUpperCase()} (${preference === 'auto' ? auto.reason : 'user override'})`);
  };
  apply();
  return {
    get preference() { return preference; },
    get tier() { return tier; },
    get profile() { return profile; },
    get autoReason() { return auto.reason; },
    setDetail(key, value) {
      const allowed = { frameLimit: ['auto', 30, 45, 60, 90, 120], renderScale: ['auto', 0.7, 0.85, 1],
        shadows: ['auto', 'off', 'low', 'medium', 'high'], showFps: [true, false] };
      if (destroyed || !Object.hasOwn(allowed, key) || !allowed[key].includes(value)) return false;
      details = { ...details, [key]: value };
      apply();
      return setSetting(storage, `graphics.${key}`, value);
    },
    reset() {
      if (destroyed) return false;
      // The separate view-distance choice and other settings remain untouched.
      const { viewDistance: _viewDistance, ...defaults } = SETTINGS_DEFAULTS.graphics;
      details = { ...details, ...defaults };
      preference = details.quality; tier = auto.tier;
      apply();
      return updateSettings(storage, Object.fromEntries(Object.entries(defaults).map(([key,value]) => [`graphics.${key}`, value])));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      app.off?.('update', update); app.off?.('postrender', postrender);
      doc?.removeEventListener('visibilitychange', resetTiming);
      win?.removeEventListener('pageshow', resetTiming);
      app.autoRender = originalAutoRender; app.renderNextFrame = true;
      if (fpsElement) fpsElement.hidden = true;
    },
    setPreference(value) {
      if (destroyed || !Object.hasOwn(GRAPHICS_QUALITY_LABELS, value)) return false;
      preference = value;
      details = { ...details, quality: value };
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
      return { frameLimit: details.frameLimit, renderScale: details.renderScale, shadows: details.shadows,
        showFps: details.showFps, fps, preference, tier, autoReason: preference === 'auto' ? auto.reason : null,
        maxPixelRatio: device.maxPixelRatio, castShadows: light.castShadows,
        shadowResolution: light.shadowResolution, shadowDistance: light.shadowDistance };
    }
  };
}
