import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCameraInputSettings } from "../src/input/camera-input-settings.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

const runtime = read("../src/input/pointer-lock-runtime.js");
const hint = read("../src/input/pointer-lock-hint.js");
const orbit = read("../src/orbit-camera-controller.js");
const settings = read("../src/input/camera-input-settings.js");
const main = read("../src/main.js");
const html = read("../campus/index.html");
const css = read("../styles.css");

test("P1 acceptance: desktop Pointer Lock uses trusted gestures and never loops on lock events", () => {
  assert.match(runtime, /event\.pointerType !== "mouse" \|\| event\.button !== 0/);
  assert.match(runtime, /canvas\.requestPointerLock\(\)/);
  assert.match(runtime, /add\(documentLike, "click",[\s\S]*gestureRecoveryArmed[\s\S]*request\(\)/s);
  assert.doesNotMatch(runtime, /pointerlockchange[\s\S]{0,240}requestPointerLock\(/);
  assert.doesNotMatch(runtime, /pointerlockerror[\s\S]{0,240}requestPointerLock\(/);
  assert.match(runtime, /awaitingGesture:\s*supported && desired && !locked/);
});

test("P1 acceptance: InputFocus owns Pointer Lock release and browser blur is safe", () => {
  assert.match(runtime, /desired = state\.pointerLockDesired === true/);
  assert.match(runtime, /if \(!desired\) \{[\s\S]*exit\(\)/s);
  assert.match(runtime, /add\(windowTarget, "blur",[\s\S]*exit\(\)/s);
  assert.match(main, /bindPointerLockRuntime\(\{[\s\S]*manager:\s*inputFocus,[\s\S]*canvas,[\s\S]*orbit/s);
});

test("P1 acceptance: locked mouse movement drives camera while drag remains a fallback", () => {
  assert.match(runtime, /orbit\.pointerLook\(Number\(event\.movementX/);
  assert.match(orbit, /setPointerLockActive\(active = false\)/);
  assert.match(orbit, /if \(this\.pointerLockActive && event\.pointerType === "mouse"\) return;/);
  assert.match(orbit, /this\.yaw -= deltaX \* POINTER_LOCK_LOOK\.yaw \* this\.mouseSensitivity/);
  assert.match(orbit, /MOUSE_DRAG_LOOK/);
});

test("P1 acceptance: camera preferences are bounded, persistent and mouse-only", () => {
  assert.match(settings, /CAMERA_INPUT_STORAGE_KEY = "inha-world-camera-input-v1"/);
  for (const [input, expected] of [[-1, 0.5], [0, 0.5], [0.5, 0.5], ['1.25', 1.25], [2, 2], [99, 2], [NaN, 1], [Infinity, 1], [null, 1], ['', 1], [' ', 1], [false, 1]]) {
    assert.equal(normalizeCameraInputSettings({ sensitivity: input }).sensitivity, expected, String(input));
  }
  assert.match(settings, /invertY:\s*value\?\.invertY === true/);
  assert.match(orbit, /const sensitivity = mouse \? this\.mouseSensitivity : 1/);
  assert.match(orbit, /mouse && this\.invertMouseY \? -1 : 1/);
});

test("P1 acceptance: guidance and settings stay desktop-only without stealing input", () => {
  assert.match(html, /id="pointer-lock-hint"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /id="mouse-sensitivity"/);
  assert.match(html, /id="invert-mouse-y"/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.pointer-lock-hint \{ display: none !important; \} \}/);
  assert.match(css, /@media \(pointer: fine\) \{\s*\.desktop-camera-settings \{ display: block; \}/s);
  assert.match(hint, /state: "READY"/);
  assert.match(hint, /state: "FALLBACK"/);
  assert.match(css, /pointer-events: none;/);
});

test("P1 acceptance: debug snapshot exposes camera, Pointer Lock and guidance state", () => {
  assert.match(main, /pointerLock:\s*pointerLock\.status\(\)/);
  assert.match(main, /pointerLockHint:\s*pointerLockHint\.status\(\)/);
  assert.match(main, /cameraInput:\s*cameraInputSettings\.current/);
  assert.match(main, /camera:\s*\{ yaw: orbit\.yaw, pitch: orbit\.pitch, distance: orbit\.distance, firstPerson: orbit\.firstPerson/);
});
