import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_DEFAULTS,
  LEGACY_SETTINGS_KEYS,
  getSetting,
  normalizeSettings,
  readSettings,
  setSetting,
  updateSettings
} from "../src/settings-registry.js";

function storageWith(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

test("registry v2 materializes normalized defaults and keeps rollback mirrors", () => {
  const storage = storageWith();
  const settings = readSettings(storage);

  assert.equal(settings.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(settings.graphics.quality, "auto");
  assert.equal(settings.graphics.viewDistance, "NORMAL");
  assert.equal(settings.audio.ambient, 0.7);
  assert.equal(settings.controls.joystickSide, "left");
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)), settings);

  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.graphicsQuality), "auto");
  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.viewDistance), "NORMAL");
  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.ambientVolume), "0.7");
  assert.deepEqual(JSON.parse(storage.data.get(LEGACY_SETTINGS_KEYS.cameraInput)), {
    sensitivity: 1,
    invertY: false
  });
  assert.deepEqual(JSON.parse(storage.data.get(LEGACY_SETTINGS_KEYS.campusControls)), { side: "left" });
});

test("registry migrates all five existing v1 settings without deleting legacy values", () => {
  const storage = storageWith({
    [LEGACY_SETTINGS_KEYS.graphicsQuality]: "high",
    [LEGACY_SETTINGS_KEYS.viewDistance]: "FAR",
    [LEGACY_SETTINGS_KEYS.ambientVolume]: "0.35",
    [LEGACY_SETTINGS_KEYS.cameraInput]: JSON.stringify({ sensitivity: 1.5, invertY: true }),
    [LEGACY_SETTINGS_KEYS.campusControls]: JSON.stringify({ size: "large", side: "right", other: "keep" })
  });

  const settings = readSettings(storage);
  assert.equal(settings.graphics.quality, "high");
  assert.equal(settings.graphics.viewDistance, "FAR");
  assert.equal(settings.audio.ambient, 0.35);
  assert.equal(settings.controls.mouseSensitivity, 1.5);
  assert.equal(settings.controls.invertY, true);
  assert.equal(settings.controls.joystickSide, "right");

  const saved = JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.graphics.quality, "high");
  assert.equal(saved.controls.joystickSide, "right");

  const legacyCampus = JSON.parse(storage.data.get(LEGACY_SETTINGS_KEYS.campusControls));
  assert.equal(legacyCampus.side, "right");
  assert.equal(legacyCampus.other, "keep");
  assert.equal("size" in legacyCampus, false, "retired joystick size is not carried forward");
});

test("compatibility window reconciles a later v1 change into an existing v2 registry", () => {
  const storage = storageWith({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      ...SETTINGS_DEFAULTS,
      graphics: { ...SETTINGS_DEFAULTS.graphics, quality: "high" },
      controls: { ...SETTINGS_DEFAULTS.controls, joystickSide: "left" }
    }),
    [LEGACY_SETTINGS_KEYS.graphicsQuality]: "low",
    [LEGACY_SETTINGS_KEYS.campusControls]: JSON.stringify({ side: "right" })
  });

  const settings = readSettings(storage);
  assert.equal(settings.graphics.quality, "low");
  assert.equal(settings.controls.joystickSide, "right");
  const persisted = JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY));
  assert.equal(persisted.graphics.quality, "low");
  assert.equal(persisted.controls.joystickSide, "right");
});

test("registry setters update v2 atomically and mirror current v1 adapters", () => {
  const storage = storageWith();
  assert.equal(setSetting(storage, "graphics.quality", "medium"), true);
  assert.equal(updateSettings(storage, {
    "graphics.viewDistance": "MAX",
    "audio.ambient": 0.35,
    "controls.mouseSensitivity": 1.25,
    "controls.invertY": true,
    "controls.joystickSide": "right"
  }), true);

  assert.equal(getSetting(storage, "graphics.quality"), "medium");
  assert.equal(getSetting(storage, "graphics.viewDistance"), "MAX");
  assert.equal(getSetting(storage, "audio.ambient"), 0.35);
  assert.equal(getSetting(storage, "controls.mouseSensitivity"), 1.25);
  assert.equal(getSetting(storage, "controls.invertY"), true);
  assert.equal(getSetting(storage, "controls.joystickSide"), "right");

  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.graphicsQuality), "medium");
  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.viewDistance), "MAX");
  assert.equal(storage.data.get(LEGACY_SETTINGS_KEYS.ambientVolume), "0.35");
  assert.deepEqual(JSON.parse(storage.data.get(LEGACY_SETTINGS_KEYS.cameraInput)), {
    sensitivity: 1.25,
    invertY: true
  });
  assert.equal(JSON.parse(storage.data.get(LEGACY_SETTINGS_KEYS.campusControls)).side, "right");
});

test("normalization rejects unknown values, clamps numeric ranges and drops unknown structure", () => {
  const settings = normalizeSettings({
    schemaVersion: 999,
    graphics: { quality: "__proto__", viewDistance: "SPACE", frameLimit: 999, showFps: "yes" },
    audio: { master: 5, ambient: -2 },
    controls: { joystickSide: "center", mouseSensitivity: 99, invertY: 1 },
    accessibility: { textScale: 99, cameraShake: "wild" },
    surprise: { enabled: true }
  });

  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.graphics.quality, "auto");
  assert.equal(settings.graphics.viewDistance, "NORMAL");
  assert.equal(settings.graphics.frameLimit, "auto");
  assert.equal(settings.graphics.showFps, false);
  assert.equal(settings.audio.master, 1);
  assert.equal(settings.audio.ambient, 0);
  assert.equal(settings.controls.joystickSide, "left");
  assert.equal(settings.controls.mouseSensitivity, 2);
  assert.equal(settings.controls.invertY, false);
  assert.equal(settings.accessibility.textScale, 1.3);
  assert.equal(settings.accessibility.cameraShake, "normal");
  assert.equal("surprise" in settings, false);
  assert.equal(setSetting(storageWith(), "__proto__.polluted", true), false);
});

test("unavailable storage falls back to defaults without throwing", () => {
  const denied = {
    getItem() { throw Error("denied"); },
    setItem() { throw Error("denied"); }
  };
  assert.doesNotThrow(() => readSettings(denied));
  assert.equal(readSettings(denied).graphics.quality, "auto");
  assert.equal(setSetting(undefined, "graphics.quality", "low"), false);
});

const numericFields = [
  ['audio', 'master'], ['audio', 'music'], ['audio', 'ambient'], ['audio', 'effects'], ['audio', 'ui'],
  ['controls', 'mobileCameraSensitivity'], ['controls', 'mouseSensitivity'],
  ['hud', 'scale'], ['accessibility', 'uiScale'], ['accessibility', 'textScale'],
  ['graphics', 'frameLimit'], ['graphics', 'renderScale']
];
const invalidNumbers = [null, undefined, '', ' \t\n ', false, true, [], [1], [30], {}, { valueOf: () => 1 }, NaN, Infinity, -Infinity, 'Infinity', 'NaN', '0,7', '1,000', '30fps'];

test('corrupt numeric fields use defaults without coercing other types', () => {
  for (const value of invalidNumbers) {
    for (const [section, field] of numericFields) {
      const result = normalizeSettings({ [section]: { [field]: value } });
      assert.equal(result[section][field], SETTINGS_DEFAULTS[section][field], `${section}.${field}: ${String(value)}`);
    }
  }
});

test('finite numbers and legacy numeric strings retain zero, fractions and clamping', () => {
  for (const [input, audio, sensitivity, scale] of [
    [0, 0, 0.5, 0.8], ['0', 0, 0.5, 0.8], [' 0.75 ', 0.75, 0.75, 0.8],
    [1.1, 1, 1.1, 1.1], ['1e0', 1, 1, 1], [-5, 0, 0.5, 0.8], ['99', 1, 2, 1.2]
  ]) {
    const result = normalizeSettings({ audio: { ambient: input }, controls: { mouseSensitivity: input }, hud: { scale: input } });
    assert.equal(result.audio.ambient, audio);
    assert.equal(result.controls.mouseSensitivity, sensitivity);
    assert.equal(result.hud.scale, scale);
  }
  assert.equal(normalizeSettings({ graphics: { frameLimit: '60', renderScale: '0.85' } }).graphics.frameLimit, 60);
  assert.equal(normalizeSettings({ graphics: { frameLimit: '60', renderScale: '0.85' } }).graphics.renderScale, 0.85);
});

test('invalid v1 numeric values do not overwrite valid v2 settings on migration or reread', () => {
  for (const value of invalidNumbers) {
    const storage = storageWith({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ audio: { ambient: 0.35 }, controls: { mouseSensitivity: 1.5 } }),
      [LEGACY_SETTINGS_KEYS.ambientVolume]: typeof value === 'string' ? value : JSON.stringify(value),
      [LEGACY_SETTINGS_KEYS.cameraInput]: JSON.stringify({ sensitivity: value, invertY: true })
    });
    const result = readSettings(storage);
    assert.equal(result.audio.ambient, 0.35, String(value));
    assert.equal(result.controls.mouseSensitivity, 1.5, String(value));
    assert.equal(result.controls.invertY, true);
    assert.deepEqual(readSettings(storage), result);
  }
});

test('corrupt v2 and blank v1 values recover to defaults and persist a stable round trip', () => {
  const storage = storageWith({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({ audio: { master: null }, controls: { mobileCameraSensitivity: '' }, accessibility: { textScale: false } }),
    [LEGACY_SETTINGS_KEYS.ambientVolume]: '  ',
    [LEGACY_SETTINGS_KEYS.cameraInput]: JSON.stringify({ sensitivity: [] })
  });
  const settings = readSettings(storage);
  assert.deepEqual(settings, SETTINGS_DEFAULTS);
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY)), settings);
  assert.deepEqual(readSettings(storage), settings);
});

test('legacy numeric strings migrate and later valid zero mute reconciles', () => {
  const storage = storageWith({
    [LEGACY_SETTINGS_KEYS.ambientVolume]: ' 0.35 ',
    [LEGACY_SETTINGS_KEYS.cameraInput]: JSON.stringify({ sensitivity: '1.25' })
  });
  assert.equal(readSettings(storage).audio.ambient, 0.35);
  assert.equal(readSettings(storage).controls.mouseSensitivity, 1.25);
  storage.setItem(LEGACY_SETTINGS_KEYS.ambientVolume, '0');
  assert.equal(readSettings(storage).audio.ambient, 0);
  assert.equal(readSettings(storage).audio.ambient, 0);
});

test('numeric setters normalize corrupt values and preserve mute through write/read', () => {
  const storage = storageWith();
  assert.equal(updateSettings(storage, { 'audio.ambient': 0, 'controls.mouseSensitivity': '1.25', 'accessibility.textScale': false }), true);
  const result = readSettings(storage);
  assert.equal(result.audio.ambient, 0);
  assert.equal(result.controls.mouseSensitivity, 1.25);
  assert.equal(result.accessibility.textScale, 1);
  assert.deepEqual(readSettings(storage), result);
});

test('denied persistence still returns recovered settings and reports write failure', () => {
  const storage = {
    getItem(key) { return key === SETTINGS_STORAGE_KEY ? JSON.stringify({ audio: { master: null } }) : null; },
    setItem() { throw Error('denied'); }
  };
  assert.deepEqual(readSettings(storage), SETTINGS_DEFAULTS);
  assert.equal(setSetting(storage, 'audio.master', 0), false);
  assert.deepEqual(readSettings(undefined), SETTINGS_DEFAULTS);
});
