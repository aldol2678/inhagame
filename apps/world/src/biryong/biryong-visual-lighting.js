import {
  BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION,
  biryongVisualLightingProfile
} from "./biryong-visual-lighting-policy.js";

function setColor(target, tuple) {
  target?.set?.(tuple[0], tuple[1], tuple[2]);
}

function applyBaseline(scene, lightEntity, base) {
  const ambientScale = Number.isFinite(base.ambientLightScale) ? base.ambientLightScale : 1;
  scene?.ambientLight?.set?.(
    base.ambientColor[0] * ambientScale,
    base.ambientColor[1] * ambientScale,
    base.ambientColor[2] * ambientScale
  );
  if (scene) scene.exposure = base.exposure;

  const light = lightEntity?.light;
  setColor(light?.color, base.sunColor);
  if (light) {
    light.intensity = base.sunIntensity * (Number.isFinite(base.sunLightScale) ? base.sunLightScale : 1);
    light.shadowIntensity = base.shadowIntensity;
  }
  lightEntity?.setEulerAngles?.(...base.sunEuler);
}

function applyProfile(scene, lightEntity, profile) {
  scene?.ambientLight?.set?.(...profile.ambientColor);
  if (scene) scene.exposure = profile.exposure;

  const light = lightEntity?.light;
  setColor(light?.color, profile.sunColor);
  if (light) {
    light.intensity = profile.sunIntensity;
    light.shadowIntensity = profile.shadowIntensity;
  }
  lightEntity?.setEulerAngles?.(...profile.sunEuler);
}

export function createBiryongVisualLighting({
  scene,
  lightEntity,
  environment,
  getActive = () => false,
  getGraphicsTier = () => "medium",
  enabled = false
} = {}) {
  if (!scene || !lightEntity || typeof environment?.copyVisualLightingState !== "function") {
    throw new TypeError("Biryong visual lighting dependencies required");
  }

  const base = {
    sunColor: [1, 0.94, 0.81],
    sunIntensity: 1.15,
    sunEuler: [55, 30, 0],
    ambientColor: [0.48, 0.54, 0.61],
    exposure: 1.05,
    shadowIntensity: 0.48,
    artificialLightFactor: 0,
    sunLightScale: 1,
    ambientLightScale: 1
  };

  let enabledState = enabled === true;
  let active = false;
  let lastProfile = null;

  const readBase = () => environment.copyVisualLightingState(base);

  function update() {
    const shouldApply = enabledState && getActive() === true;
    if (!shouldApply) {
      if (!active) return false;
      readBase();
      applyBaseline(scene, lightEntity, base);
      active = false;
      lastProfile = null;
      return true;
    }

    readBase();
    lastProfile = biryongVisualLightingProfile(base, getGraphicsTier());
    applyProfile(scene, lightEntity, lastProfile);
    active = true;
    return true;
  }

  function setEnabled(value) {
    const next = value === true;
    if (next === enabledState) return enabledState;
    enabledState = next;
    update();
    return enabledState;
  }

  function status() {
    return Object.freeze({
      version: BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION,
      enabled: enabledState,
      active,
      tier: lastProfile?.tier ?? getGraphicsTier(),
      profile: lastProfile ? Object.freeze({
        daylight: lastProfile.daylight,
        ambientColor: Object.freeze([...lastProfile.ambientColor]),
        exposure: lastProfile.exposure,
        sunIntensity: lastProfile.sunIntensity,
        shadowIntensity: lastProfile.shadowIntensity,
        sunEuler: Object.freeze([...lastProfile.sunEuler])
      }) : null
    });
  }

  function destroy() {
    if (active) {
      readBase();
      applyBaseline(scene, lightEntity, base);
    }
    active = false;
    lastProfile = null;
    enabledState = false;
  }

  return Object.freeze({ update, setEnabled, status, destroy });
}
