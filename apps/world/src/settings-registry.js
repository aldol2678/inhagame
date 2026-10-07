export const SETTINGS_STORAGE_KEY = "inhagame-device-settings-v2";
export const SETTINGS_SCHEMA_VERSION = 2;

export const LEGACY_SETTINGS_KEYS = Object.freeze({
  graphicsQuality: "inha-world-graphics-quality-v1",
  viewDistance: "inhagame-campus-view-distance-v1",
  ambientVolume: "inha-world-audio-volume-v1",
  cameraInput: "inha-world-camera-input-v1",
  campusControls: "inhagame-campus-settings-v1"
});

export const SETTINGS_DEFAULTS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  graphics: Object.freeze({
    quality: "auto",
    viewDistance: "NORMAL",
    frameLimit: "auto",
    renderScale: "auto",
    shadows: "auto",
    showFps: false
  }),
  audio: Object.freeze({
    master: 1,
    music: 0.7,
    ambient: 0.7,
    effects: 0.8,
    ui: 0.7
  }),
  controls: Object.freeze({
    joystickSide: "left",
    mobileCameraSensitivity: 1,
    mouseSensitivity: 1,
    invertY: false,
    sprintMode: "hold",
    defaultPerspective: "third"
  }),
  hud: Object.freeze({
    minimap: true,
    quest: true,
    progression: true,
    nameplates: true,
    regionalHints: true,
    scale: 1
  }),
  accessibility: Object.freeze({
    uiScale: 1,
    textScale: 1,
    reduceMotion: false,
    cameraShake: "normal",
    highContrast: false
  })
});

const KNOWN_PATHS = new Set([
  "graphics.quality", "graphics.viewDistance", "graphics.frameLimit", "graphics.renderScale",
  "graphics.shadows", "graphics.showFps",
  "audio.master", "audio.music", "audio.ambient", "audio.effects", "audio.ui",
  "controls.joystickSide", "controls.mobileCameraSensitivity", "controls.mouseSensitivity",
  "controls.invertY", "controls.sprintMode", "controls.defaultPerspective",
  "hud.minimap", "hud.quest", "hud.progression", "hud.nameplates", "hud.regionalHints", "hud.scale",
  "accessibility.uiScale", "accessibility.textScale", "accessibility.reduceMotion",
  "accessibility.cameraShake", "accessibility.highContrast"
]);

const plainObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const finite = (value, fallback, min = -Infinity, max = Infinity) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, min, max) : fallback;
};
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;

function cloneDefaults() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    graphics: { ...SETTINGS_DEFAULTS.graphics },
    audio: { ...SETTINGS_DEFAULTS.audio },
    controls: { ...SETTINGS_DEFAULTS.controls },
    hud: { ...SETTINGS_DEFAULTS.hud },
    accessibility: { ...SETTINGS_DEFAULTS.accessibility }
  };
}

export function normalizeSettings(value = {}) {
  const source = plainObject(value) ? value : {};
  const graphics = plainObject(source.graphics) ? source.graphics : {};
  const audio = plainObject(source.audio) ? source.audio : {};
  const controls = plainObject(source.controls) ? source.controls : {};
  const hud = plainObject(source.hud) ? source.hud : {};
  const accessibility = plainObject(source.accessibility) ? source.accessibility : {};
  const frameLimit = graphics.frameLimit === "auto"
    ? "auto"
    : pick(Number(graphics.frameLimit), [30, 45, 60, 90, 120], SETTINGS_DEFAULTS.graphics.frameLimit);
  const renderScale = graphics.renderScale === "auto"
    ? "auto"
    : pick(Number(graphics.renderScale), [0.7, 0.85, 1], SETTINGS_DEFAULTS.graphics.renderScale);

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    graphics: {
      quality: pick(graphics.quality, ["auto", "low", "medium", "high"], SETTINGS_DEFAULTS.graphics.quality),
      viewDistance: pick(graphics.viewDistance, ["SHORT", "NORMAL", "FAR", "MAX"], SETTINGS_DEFAULTS.graphics.viewDistance),
      frameLimit,
      renderScale,
      shadows: pick(graphics.shadows, ["auto", "off", "low", "medium", "high"], SETTINGS_DEFAULTS.graphics.shadows),
      showFps: bool(graphics.showFps, SETTINGS_DEFAULTS.graphics.showFps)
    },
    audio: {
      master: finite(audio.master, SETTINGS_DEFAULTS.audio.master, 0, 1),
      music: finite(audio.music, SETTINGS_DEFAULTS.audio.music, 0, 1),
      ambient: finite(audio.ambient, SETTINGS_DEFAULTS.audio.ambient, 0, 1),
      effects: finite(audio.effects, SETTINGS_DEFAULTS.audio.effects, 0, 1),
      ui: finite(audio.ui, SETTINGS_DEFAULTS.audio.ui, 0, 1)
    },
    controls: {
      joystickSide: pick(controls.joystickSide, ["left", "right"], SETTINGS_DEFAULTS.controls.joystickSide),
      mobileCameraSensitivity: finite(controls.mobileCameraSensitivity, SETTINGS_DEFAULTS.controls.mobileCameraSensitivity, 0.5, 2),
      mouseSensitivity: finite(controls.mouseSensitivity, SETTINGS_DEFAULTS.controls.mouseSensitivity, 0.5, 2),
      invertY: bool(controls.invertY, SETTINGS_DEFAULTS.controls.invertY),
      sprintMode: pick(controls.sprintMode, ["hold", "toggle"], SETTINGS_DEFAULTS.controls.sprintMode),
      defaultPerspective: pick(controls.defaultPerspective, ["third", "first"], SETTINGS_DEFAULTS.controls.defaultPerspective)
    },
    hud: {
      minimap: bool(hud.minimap, SETTINGS_DEFAULTS.hud.minimap),
      quest: bool(hud.quest, SETTINGS_DEFAULTS.hud.quest),
      progression: bool(hud.progression, SETTINGS_DEFAULTS.hud.progression),
      nameplates: bool(hud.nameplates, SETTINGS_DEFAULTS.hud.nameplates),
      regionalHints: bool(hud.regionalHints, SETTINGS_DEFAULTS.hud.regionalHints),
      scale: finite(hud.scale, SETTINGS_DEFAULTS.hud.scale, 0.8, 1.2)
    },
    accessibility: {
      uiScale: finite(accessibility.uiScale, SETTINGS_DEFAULTS.accessibility.uiScale, 0.8, 1.2),
      textScale: finite(accessibility.textScale, SETTINGS_DEFAULTS.accessibility.textScale, 0.8, 1.3),
      reduceMotion: bool(accessibility.reduceMotion, SETTINGS_DEFAULTS.accessibility.reduceMotion),
      cameraShake: pick(accessibility.cameraShake, ["normal", "reduced", "off"], SETTINGS_DEFAULTS.accessibility.cameraShake),
      highContrast: bool(accessibility.highContrast, SETTINGS_DEFAULTS.accessibility.highContrast)
    }
  };
}

function safeGet(storage, key) {
  try { return storage?.getItem?.(key) ?? null; }
  catch { return null; }
}

function parseObject(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return plainObject(value) ? value : null;
  } catch { return null; }
}

function overlayLegacy(storage, value) {
  const next = normalizeSettings(value);
  let found = false;

  const quality = safeGet(storage, LEGACY_SETTINGS_KEYS.graphicsQuality);
  if (["auto", "low", "medium", "high"].includes(quality)) {
    next.graphics.quality = quality;
    found = true;
  }

  const viewDistance = safeGet(storage, LEGACY_SETTINGS_KEYS.viewDistance);
  if (["SHORT", "NORMAL", "FAR", "MAX"].includes(viewDistance)) {
    next.graphics.viewDistance = viewDistance;
    found = true;
  }

  const volumeRaw = safeGet(storage, LEGACY_SETTINGS_KEYS.ambientVolume);
  if (volumeRaw !== null) {
    const volume = Number(volumeRaw);
    if (Number.isFinite(volume)) {
      next.audio.ambient = clamp(volume, 0, 1);
      found = true;
    }
  }

  const camera = parseObject(safeGet(storage, LEGACY_SETTINGS_KEYS.cameraInput));
  if (camera) {
    if (Number.isFinite(Number(camera.sensitivity))) {
      next.controls.mouseSensitivity = clamp(Number(camera.sensitivity), 0.5, 2);
      found = true;
    }
    if (typeof camera.invertY === "boolean") {
      next.controls.invertY = camera.invertY;
      found = true;
    }
  }

  const campus = parseObject(safeGet(storage, LEGACY_SETTINGS_KEYS.campusControls));
  if (campus && ["left", "right"].includes(campus.side)) {
    next.controls.joystickSide = campus.side;
    found = true;
  }

  return { settings: normalizeSettings(next), found };
}

function mirrorLegacy(storage, settings) {
  try { storage?.setItem?.(LEGACY_SETTINGS_KEYS.graphicsQuality, settings.graphics.quality); } catch {}
  try { storage?.setItem?.(LEGACY_SETTINGS_KEYS.viewDistance, settings.graphics.viewDistance); } catch {}
  try { storage?.setItem?.(LEGACY_SETTINGS_KEYS.ambientVolume, String(settings.audio.ambient)); } catch {}
  try {
    storage?.setItem?.(LEGACY_SETTINGS_KEYS.cameraInput, JSON.stringify({
      sensitivity: settings.controls.mouseSensitivity,
      invertY: settings.controls.invertY
    }));
  } catch {}
  try {
    const previous = parseObject(safeGet(storage, LEGACY_SETTINGS_KEYS.campusControls)) || {};
    delete previous.size;
    storage?.setItem?.(LEGACY_SETTINGS_KEYS.campusControls, JSON.stringify({
      ...previous,
      side: settings.controls.joystickSide
    }));
  } catch {}
}

export function writeSettings(storage, value, { mirrorLegacyKeys = true } = {}) {
  if (!storage?.setItem) return false;
  const normalized = normalizeSettings(value);
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    return false;
  }
  if (mirrorLegacyKeys) mirrorLegacy(storage, normalized);
  return true;
}

export function readSettings(storage, { persistMigration = true, reconcileLegacy = true } = {}) {
  const raw = safeGet(storage, SETTINGS_STORAGE_KEY);
  const parsed = parseObject(raw);
  let settings = normalizeSettings(parsed || cloneDefaults());

  if (reconcileLegacy) settings = overlayLegacy(storage, settings).settings;

  if (persistMigration && storage?.setItem) {
    const serialized = JSON.stringify(settings);
    if (raw !== serialized) {
      try { storage.setItem(SETTINGS_STORAGE_KEY, serialized); } catch {}
      mirrorLegacy(storage, settings);
    }
  }
  return settings;
}

function readPath(settings, path) {
  return path.split(".").reduce((value, key) => plainObject(value) ? value[key] : undefined, settings);
}

function writePath(settings, path, value) {
  const [section, field] = path.split(".");
  if (!KNOWN_PATHS.has(path) || !plainObject(settings[section])) return false;
  settings[section][field] = value;
  return true;
}

export function getSetting(storage, path) {
  if (!KNOWN_PATHS.has(path)) return undefined;
  return readPath(readSettings(storage), path);
}

export function updateSettings(storage, updates = {}) {
  if (!plainObject(updates) || !storage?.setItem) return false;
  const settings = readSettings(storage);
  let changed = false;
  for (const [path, value] of Object.entries(updates)) {
    if (writePath(settings, path, value)) changed = true;
  }
  return changed && writeSettings(storage, settings);
}

export function setSetting(storage, path, value) {
  return updateSettings(storage, { [path]: value });
}
