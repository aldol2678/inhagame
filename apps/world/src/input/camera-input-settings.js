import { getSetting, updateSettings } from '../settings-registry.js';

export const CAMERA_INPUT_STORAGE_KEY = "inha-world-camera-input-v1";
export const DEFAULT_CAMERA_INPUT_SETTINGS = Object.freeze({
  sensitivity: 1,
  invertY: false
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeCameraInputSettings(value = {}) {
  const sensitivity = Number(value?.sensitivity);
  return Object.freeze({
    sensitivity: Number.isFinite(sensitivity) ? clamp(sensitivity, 0.5, 2) : DEFAULT_CAMERA_INPUT_SETTINGS.sensitivity,
    invertY: value?.invertY === true
  });
}

export function readCameraInputSettings(storage = null) {
  return normalizeCameraInputSettings({
    sensitivity: getSetting(storage, 'controls.mouseSensitivity'),
    invertY: getSetting(storage, 'controls.invertY')
  });
}

export function saveCameraInputSettings(storage, settings) {
  const normalized = normalizeCameraInputSettings(settings);
  return updateSettings(storage, {
    'controls.mouseSensitivity': normalized.sensitivity,
    'controls.invertY': normalized.invertY
  });
}

export function bindCameraInputSettings({
  orbit,
  sensitivitySelect,
  invertCheckbox,
  status = null,
  storage = null
} = {}) {
  if (!orbit?.setMouseLookSettings) {
    throw new TypeError("Camera input settings require OrbitCameraController.setMouseLookSettings()");
  }
  if (!sensitivitySelect || !invertCheckbox) {
    throw new TypeError("Camera input settings require sensitivity and invert-Y controls");
  }

  let activeStorage = storage;
  if (!activeStorage) {
    try { activeStorage = globalThis.localStorage; } catch { /* Session-only camera settings. */ }
  }

  let current = readCameraInputSettings(activeStorage);

  function apply(next, { persist = false } = {}) {
    current = normalizeCameraInputSettings(next);
    sensitivitySelect.value = String(current.sensitivity);
    invertCheckbox.checked = current.invertY;
    orbit.setMouseLookSettings(current);

    if (persist) {
      const saved = saveCameraInputSettings(activeStorage, current);
      if (status) {
        status.textContent = saved
          ? "이 기기에 저장했어요."
          : "현재 화면에만 적용했어요. 저장할 수 없습니다.";
      }
    }
    return current;
  }

  const onSensitivity = () => {
    apply({ sensitivity: Number(sensitivitySelect.value), invertY: invertCheckbox.checked }, { persist: true });
  };
  const onInvert = () => {
    apply({ sensitivity: Number(sensitivitySelect.value), invertY: invertCheckbox.checked }, { persist: true });
  };

  sensitivitySelect.addEventListener("change", onSensitivity);
  invertCheckbox.addEventListener("change", onInvert);
  apply(current);

  return Object.freeze({
    get current() { return current; },
    destroy() {
      sensitivitySelect.removeEventListener?.("change", onSensitivity);
      invertCheckbox.removeEventListener?.("change", onInvert);
    }
  });
}
