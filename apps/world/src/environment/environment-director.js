import {
  DEFAULT_ENVIRONMENT_TIME,
  environmentPreset,
  resolveEnvironmentTime
} from './environment-presets.js';
import {
  DEFAULT_ENVIRONMENT_WEATHER,
  environmentWeatherPreset,
  resolveEnvironmentWeather
} from './environment-weather.js';

const clamp01 = value => Math.min(1, Math.max(0, value));

function mutableFrame(source) {
  return {
    sunColor: [...source.sunColor],
    sunIntensity: source.sunIntensity,
    sunEuler: [...source.sunEuler],
    ambientColor: [...source.ambientColor],
    exposure: source.exposure,
    clearColor: [...source.clearColor],
    shadowIntensity: source.shadowIntensity,
    artificialLightFactor: source.artificialLightFactor
  };
}

function mutableFogFrame(source) {
  return {
    fogStart: source.fogStart,
    fogEnd: source.fogEnd,
    fogColorMix: source.fogColorMix,
    fogTint: [...source.fogTint],
    rainIntensity: source.rainIntensity,
    wetness: source.wetness
  };
}

function copyTuple(out, source) {
  for (let i = 0; i < out.length; i++) out[i] = source[i];
}

function copyFrame(out, source) {
  copyTuple(out.sunColor, source.sunColor);
  out.sunIntensity = source.sunIntensity;
  copyTuple(out.sunEuler, source.sunEuler);
  copyTuple(out.ambientColor, source.ambientColor);
  out.exposure = source.exposure;
  copyTuple(out.clearColor, source.clearColor);
  out.shadowIntensity = source.shadowIntensity;
  out.artificialLightFactor = source.artificialLightFactor;
}

function copyFogFrame(out, source) {
  out.fogStart = source.fogStart;
  out.fogEnd = source.fogEnd;
  out.fogColorMix = source.fogColorMix;
  copyTuple(out.fogTint, source.fogTint);
  out.rainIntensity = source.rainIntensity;
  out.wetness = source.wetness;
}

function mixTuple(out, from, to, t) {
  for (let i = 0; i < out.length; i++) out[i] = from[i] + (to[i] - from[i]) * t;
}

function mixFrame(out, from, to, t) {
  mixTuple(out.sunColor, from.sunColor, to.sunColor, t);
  out.sunIntensity = from.sunIntensity + (to.sunIntensity - from.sunIntensity) * t;
  mixTuple(out.sunEuler, from.sunEuler, to.sunEuler, t);
  mixTuple(out.ambientColor, from.ambientColor, to.ambientColor, t);
  out.exposure = from.exposure + (to.exposure - from.exposure) * t;
  mixTuple(out.clearColor, from.clearColor, to.clearColor, t);
  out.shadowIntensity = from.shadowIntensity + (to.shadowIntensity - from.shadowIntensity) * t;
  out.artificialLightFactor = from.artificialLightFactor + (to.artificialLightFactor - from.artificialLightFactor) * t;
}

function mixFogFrame(out, from, to, t) {
  out.fogStart = from.fogStart + (to.fogStart - from.fogStart) * t;
  out.fogEnd = from.fogEnd + (to.fogEnd - from.fogEnd) * t;
  out.fogColorMix = from.fogColorMix + (to.fogColorMix - from.fogColorMix) * t;
  mixTuple(out.fogTint, from.fogTint, to.fogTint, t);
  out.rainIntensity = from.rainIntensity + (to.rainIntensity - from.rainIntensity) * t;
  out.wetness = from.wetness + (to.wetness - from.wetness) * t;
}

function setColor(target, tuple) {
  target?.set?.(tuple[0], tuple[1], tuple[2]);
}

function mixFogColor(out, clearColor, fogTint, mix) {
  for (let i = 0; i < out.length; i++)
    out[i] = clearColor[i] + (fogTint[i] - clearColor[i]) * mix;
}

function applyFrame({ scene, lightEntity, camera }, frame, fogFrame, fogType, fogColor) {
  setColor(scene?.ambientLight, frame.ambientColor);
  if (scene) scene.exposure = frame.exposure;

  const light = lightEntity?.light;
  setColor(light?.color, frame.sunColor);
  if (light) {
    light.intensity = frame.sunIntensity;
    light.shadowIntensity = frame.shadowIntensity;
  }
  lightEntity?.setEulerAngles?.(...frame.sunEuler);

  setColor(camera?.camera?.clearColor, frame.clearColor);

  const fog = scene?.fog;
  if (fog) {
    mixFogColor(fogColor, frame.clearColor, fogFrame.fogTint, fogFrame.fogColorMix);
    fog.type = fogType;
    setColor(fog.color, fogColor);
    fog.start = fogFrame.fogStart;
    fog.end = fogFrame.fogEnd;
    // P1 intentionally uses linear fog only; density remains inert for future EXP/EXP2 weather.
    fog.density = 0;
  }
}

export function createEnvironmentDirector({
  scene,
  lightEntity,
  camera,
  initialTime = DEFAULT_ENVIRONMENT_TIME,
  initialWeather = DEFAULT_ENVIRONMENT_WEATHER,
  transitionSeconds = 3,
  fogTransitionSeconds = 2.5
}) {
  const initialId = resolveEnvironmentTime(initialTime);
  const initialWeatherId = resolveEnvironmentWeather(initialWeather);
  const current = mutableFrame(environmentPreset(initialId));
  const from = mutableFrame(current);
  const target = mutableFrame(current);
  const fogCurrent = mutableFogFrame(environmentWeatherPreset(initialWeatherId));
  const fogFrom = mutableFogFrame(fogCurrent);
  const fogTarget = mutableFogFrame(fogCurrent);
  const fogColor = [0, 0, 0];
  const bindings = { scene, lightEntity, camera };

  let targetTime = initialId;
  let elapsed = Math.max(0, transitionSeconds);
  let progress = 1;

  let targetWeather = initialWeatherId;
  let fogElapsed = Math.max(0, fogTransitionSeconds);
  let fogProgress = 1;
  let fogType = environmentWeatherPreset(initialWeatherId).fogType;

  applyFrame(bindings, current, fogCurrent, fogType, fogColor);

  function setTimeOfDay(value, { immediate = false } = {}) {
    targetTime = resolveEnvironmentTime(value);
    copyFrame(from, current);
    copyFrame(target, environmentPreset(targetTime));
    elapsed = 0;

    if (immediate || transitionSeconds <= 0) {
      copyFrame(current, target);
      progress = 1;
      applyFrame(bindings, current, fogCurrent, fogType, fogColor);
    } else {
      progress = 0;
    }
    return targetTime;
  }

  function setWeather(value, { immediate = false } = {}) {
    targetWeather = resolveEnvironmentWeather(value);
    const next = environmentWeatherPreset(targetWeather);
    copyFogFrame(fogFrom, fogCurrent);
    copyFogFrame(fogTarget, next);
    fogElapsed = 0;

    // Enable the linear shader path before fading fog inward. When clearing,
    // keep it enabled until the fade-out reaches the canonical CLEAR frame.
    if (next.fogType !== 'none') fogType = next.fogType;

    if (immediate || fogTransitionSeconds <= 0) {
      copyFogFrame(fogCurrent, fogTarget);
      fogProgress = 1;
      fogType = next.fogType;
      applyFrame(bindings, current, fogCurrent, fogType, fogColor);
    } else {
      fogProgress = 0;
    }
    return targetWeather;
  }

  function update(dt) {
    const safeDt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    let changed = false;

    if (progress < 1) {
      elapsed += safeDt;
      progress = clamp01(elapsed / transitionSeconds);
      if (progress >= 1) copyFrame(current, target);
      else mixFrame(current, from, target, progress);
      changed = true;
    }

    if (fogProgress < 1) {
      fogElapsed += safeDt;
      fogProgress = clamp01(fogElapsed / fogTransitionSeconds);
      if (fogProgress >= 1) {
        copyFogFrame(fogCurrent, fogTarget);
        fogType = environmentWeatherPreset(targetWeather).fogType;
      } else {
        mixFogFrame(fogCurrent, fogFrom, fogTarget, fogProgress);
      }
      changed = true;
    }

    if (changed) applyFrame(bindings, current, fogCurrent, fogType, fogColor);
    return changed;
  }

  function status() {
    return Object.freeze({
      targetTime,
      progress,
      settled: progress >= 1,
      exposure: current.exposure,
      artificialLightFactor: current.artificialLightFactor,
      targetWeather,
      weatherProgress: fogProgress,
      weatherSettled: fogProgress >= 1,
      fog: Object.freeze({
        type: fogType,
        start: fogCurrent.fogStart,
        end: fogCurrent.fogEnd,
        color: Object.freeze([...fogColor])
      }),
      rainIntensity: fogCurrent.rainIntensity,
      wetness: fogCurrent.wetness
    });
  }

  function artificialLightFactor() {
    return current.artificialLightFactor;
  }

  function rainIntensity() {
    return fogCurrent.rainIntensity;
  }

  function wetnessFactor() {
    return fogCurrent.wetness;
  }

  return Object.freeze({
    setTimeOfDay,
    setWeather,
    update,
    status,
    artificialLightFactor,
    rainIntensity,
    wetnessFactor
  });
}
