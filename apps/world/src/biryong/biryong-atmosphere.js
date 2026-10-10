import {
  BIRYONG_ATMOSPHERE_PROFILE_VERSION,
  biryongAtmosphereProfile
} from "./biryong-atmosphere-policy.js";

function setColor(target, tuple) {
  target?.set?.(tuple[0], tuple[1], tuple[2]);
}

function applyBaseline(scene, camera, canvas, base, toneMapping, canvasFilter) {
  const fog = scene?.fog;
  if (fog) {
    fog.type = base.fogType;
    fog.start = base.fogStart;
    fog.end = base.fogEnd;
    fog.density = 0;
    setColor(fog.color, base.fogColor);
  }
  setColor(camera?.camera?.clearColor, base.clearColor);
  if (camera?.camera && toneMapping !== undefined) camera.camera.toneMapping = toneMapping;
  if (canvas?.style) canvas.style.filter = canvasFilter;
}

function applyProfile(scene, camera, canvas, profile, toneMappingNeutral, toneMappingCinematic) {
  const fog = scene?.fog;
  if (fog) {
    fog.type = profile.fogType;
    fog.start = profile.fogStart;
    fog.end = profile.fogEnd;
    fog.density = 0;
    setColor(fog.color, profile.fogColor);
  }
  setColor(camera?.camera?.clearColor, profile.clearColor);
  if (camera?.camera) {
    camera.camera.toneMapping = profile.toneMapping === "cinematic"
      ? toneMappingCinematic
      : toneMappingNeutral;
  }
  if (canvas?.style) canvas.style.filter = profile.canvasFilter;
}

export function createBiryongAtmosphere({
  scene,
  camera,
  canvas,
  environment,
  getActive = () => false,
  getGraphicsTier = () => "medium",
  enabled = false,
  toneMappingNeutral,
  toneMappingCinematic
} = {}) {
  if (!scene || !camera || typeof environment?.copyVisualAtmosphereState !== "function") {
    throw new TypeError("Biryong atmosphere dependencies required");
  }

  let initialToneMapping = camera.camera?.toneMapping;
  let initialCanvasFilter = canvas?.style?.filter ?? "";
  const base = {
    targetTime: "DAY",
    targetWeather: "CLEAR",
    artificialLightFactor: 0,
    clearColor: [0.52, 0.71, 0.84],
    fogType: "none",
    fogStart: 650,
    fogEnd: 700,
    fogColor: [0.52, 0.71, 0.84]
  };

  if (enabled !== true) {
    return Object.freeze({
      update: () => false,
      destroy: () => {},
      status: () => Object.freeze({
        version: BIRYONG_ATMOSPHERE_PROFILE_VERSION,
        enabled: false,
        active: false,
        tier: getGraphicsTier(),
        profile: null,
        screenSpaceBloom: false
      })
    });
  }

  let active = false;
  let destroyed = false;
  let lastProfile = null;
  const readBase = () => environment.copyVisualAtmosphereState(base);

  function update() {
    if (destroyed) return false;
    const shouldApply = getActive() === true;
    if (!shouldApply) {
      if (!active) return false;
      readBase();
      applyBaseline(scene, camera, canvas, base, initialToneMapping, initialCanvasFilter);
      active = false;
      lastProfile = null;
      return true;
    }

    if (!active) {
      initialToneMapping = camera.camera?.toneMapping;
      initialCanvasFilter = canvas?.style?.filter ?? "";
    }
    readBase();
    lastProfile = biryongAtmosphereProfile(base, getGraphicsTier());
    applyProfile(scene, camera, canvas, lastProfile, toneMappingNeutral, toneMappingCinematic);
    active = true;
    return true;
  }

  function status() {
    return Object.freeze({
      version: BIRYONG_ATMOSPHERE_PROFILE_VERSION,
      enabled: !destroyed,
      active,
      tier: lastProfile?.tier ?? getGraphicsTier(),
      screenSpaceBloom: false,
      profile: lastProfile ? Object.freeze({
        targetTime: lastProfile.targetTime,
        targetWeather: lastProfile.targetWeather,
        fogStart: lastProfile.fogStart,
        fogEnd: lastProfile.fogEnd,
        fogColor: Object.freeze([...lastProfile.fogColor]),
        clearColor: Object.freeze([...lastProfile.clearColor]),
        toneMapping: lastProfile.toneMapping,
        canvasFilter: lastProfile.canvasFilter
      }) : null
    });
  }

  function destroy() {
    if (destroyed) return;
    if (active) {
      readBase();
      applyBaseline(scene, camera, canvas, base, initialToneMapping, initialCanvasFilter);
    }
    active = false;
    lastProfile = null;
    destroyed = true;
  }

  return Object.freeze({ update, status, destroy });
}
