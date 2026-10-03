import {
  DEFAULT_ENVIRONMENT_TIME,
  environmentPreset,
  resolveEnvironmentTime
} from './environment-presets.js';

const clamp01 = value => Math.min(1, Math.max(0, value));

function mutableFrame(source) {
  return {
    sunColor: [...source.sunColor],
    sunIntensity: source.sunIntensity,
    sunEuler: [...source.sunEuler],
    ambientColor: [...source.ambientColor],
    exposure: source.exposure,
    clearColor: [...source.clearColor],
    shadowIntensity: source.shadowIntensity
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
}

function setColor(target, tuple) {
  target?.set?.(tuple[0], tuple[1], tuple[2]);
}

function applyFrame({ scene, lightEntity, camera }, frame) {
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
}

export function createEnvironmentDirector({
  scene,
  lightEntity,
  camera,
  initialTime = DEFAULT_ENVIRONMENT_TIME,
  transitionSeconds = 3
}) {
  const initialId = resolveEnvironmentTime(initialTime);
  const current = mutableFrame(environmentPreset(initialId));
  const from = mutableFrame(current);
  const target = mutableFrame(current);
  const bindings = { scene, lightEntity, camera };

  let targetTime = initialId;
  let elapsed = Math.max(0, transitionSeconds);
  let progress = 1;

  applyFrame(bindings, current);

  function setTimeOfDay(value, { immediate = false } = {}) {
    targetTime = resolveEnvironmentTime(value);
    copyFrame(from, current);
    copyFrame(target, environmentPreset(targetTime));
    elapsed = 0;

    if (immediate || transitionSeconds <= 0) {
      copyFrame(current, target);
      progress = 1;
      applyFrame(bindings, current);
    } else {
      progress = 0;
    }
    return targetTime;
  }

  function update(dt) {
    if (progress >= 1) return false;
    elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    progress = clamp01(elapsed / transitionSeconds);
    if (progress >= 1) {
      // Snap the terminal frame to the canonical preset instead of leaving
      // interpolation rounding residue in colors/exposure.
      copyFrame(current, target);
      applyFrame(bindings, current);
      return true;
    }
    mixFrame(current, from, target, progress);
    applyFrame(bindings, current);
    return true;
  }

  function status() {
    return Object.freeze({
      targetTime,
      progress,
      settled: progress >= 1,
      exposure: current.exposure
    });
  }

  return Object.freeze({ setTimeOfDay, update, status });
}
