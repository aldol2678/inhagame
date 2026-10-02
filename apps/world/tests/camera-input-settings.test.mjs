import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMERA_INPUT_STORAGE_KEY,
  DEFAULT_CAMERA_INPUT_SETTINGS,
  bindCameraInputSettings,
  normalizeCameraInputSettings,
  readCameraInputSettings
} from "../src/input/camera-input-settings.js";

function control(initial = {}) {
  const listeners = new Map();
  return {
    value: "",
    checked: false,
    ...initial,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn));
    },
    dispatch(type) {
      for (const fn of listeners.get(type) ?? []) fn({ target: this });
    }
  };
}

function storageWith(raw = null) {
  const data = new Map();
  if (raw !== null) data.set(CAMERA_INPUT_STORAGE_KEY, raw);
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    data
  };
}

test("camera input settings normalize invalid values and clamp sensitivity", () => {
  assert.deepEqual(normalizeCameraInputSettings(), DEFAULT_CAMERA_INPUT_SETTINGS);
  assert.deepEqual(normalizeCameraInputSettings({ sensitivity: 99, invertY: true }), { sensitivity: 2, invertY: true });
  assert.deepEqual(normalizeCameraInputSettings({ sensitivity: 0.01, invertY: false }), { sensitivity: 0.5, invertY: false });
  assert.deepEqual(normalizeCameraInputSettings({ sensitivity: "1.25", invertY: 1 }), { sensitivity: 1.25, invertY: false });
});

test("saved camera input settings apply to OrbitCameraController and controls", () => {
  const storage = storageWith(JSON.stringify({ sensitivity: 1.5, invertY: true }));
  const sensitivitySelect = control();
  const invertCheckbox = control();
  const status = { textContent: "" };
  const applied = [];
  const orbit = { setMouseLookSettings(value) { applied.push({ ...value }); } };

  const binding = bindCameraInputSettings({ orbit, sensitivitySelect, invertCheckbox, status, storage });

  assert.equal(sensitivitySelect.value, "1.5");
  assert.equal(invertCheckbox.checked, true);
  assert.deepEqual(binding.current, { sensitivity: 1.5, invertY: true });
  assert.deepEqual(applied, [{ sensitivity: 1.5, invertY: true }]);
});

test("camera input setting changes persist together and update status", () => {
  const storage = storageWith();
  const sensitivitySelect = control({ value: "1" });
  const invertCheckbox = control({ checked: false });
  const status = { textContent: "" };
  const applied = [];
  const orbit = { setMouseLookSettings(value) { applied.push({ ...value }); } };

  const binding = bindCameraInputSettings({ orbit, sensitivitySelect, invertCheckbox, status, storage });
  sensitivitySelect.value = "1.25";
  sensitivitySelect.dispatch("change");
  invertCheckbox.checked = true;
  invertCheckbox.dispatch("change");

  assert.deepEqual(binding.current, { sensitivity: 1.25, invertY: true });
  assert.match(status.textContent, /저장/);
  assert.deepEqual(JSON.parse(storage.data.get(CAMERA_INPUT_STORAGE_KEY)), { sensitivity: 1.25, invertY: true });
  assert.deepEqual(applied.at(-1), { sensitivity: 1.25, invertY: true });
});

test("malformed storage safely falls back to defaults", () => {
  const storage = storageWith("{bad json");
  assert.deepEqual(readCameraInputSettings(storage), DEFAULT_CAMERA_INPUT_SETTINGS);
});


test("desktop camera settings UI is present and hidden on coarse-pointer layouts", () => {
  const html = readFileSync(new URL("../campus/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(html, /id="mouse-sensitivity"/);
  assert.match(html, /id="invert-mouse-y"/);
  assert.match(html, /게임 화면을 클릭하면 마우스가 고정됩니다/);
  assert.match(html, /<kbd>마우스 이동<\/kbd>/);
  assert.match(html, /<kbd>Esc<\/kbd><\/span><strong>마우스 고정 해제<\/strong>/);
  assert.match(css, /\.desktop-camera-settings \{ display: none;/);
  assert.match(css, /@media \(pointer: fine\) \{\s*\.desktop-camera-settings \{ display: block; \}/s);
});
