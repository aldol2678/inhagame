import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INPUT_FOCUS_CLASS,
  INPUT_FOCUS_POLICY,
  INPUT_MINIMAP,
  createInputFocusManager
} from "../src/input/input-focus-manager.js";
import { bindInputFocusRuntime } from "../src/input/input-focus-runtime.js";
import { PlayerController } from "../src/player-controller.js";
import { hasBlockingMiniMapOverlay } from "../src/minimap/minimap-controller.js";

function fakeControl() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    style: {},
    clientWidth: 120,
    setAttribute() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ currentTarget: this, ...event });
    }
  };
}

function realControllerRig() {
  const listeners = new Map();
  const elements = Object.fromEntries([
    "joystick", "joystick-knob", "jump", "run", "descend"
  ].map(id => [id, fakeControl()]));
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement
  };
  globalThis.window = {
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    }
  };
  globalThis.document = {
    body: { dataset: {} },
    getElementById(id) { return elements[id] ?? null; }
  };
  globalThis.HTMLElement = class { closest() { return null; } };

  const pos = { x: 0, y: 1.15, z: 0 };
  const entity = {
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition(x, y, z) { Object.assign(pos, { x, y, z }); },
    setLocalEulerAngles() {}
  };
  const controller = new PlayerController(entity);

  return {
    controller,
    elements,
    dispatchWindow(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    cleanup() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.HTMLElement = previous.HTMLElement;
    }
  };
}

test("P0 acceptance: Chat claim clears held movement immediately and blocks gameplay capabilities", () => {
  const r = realControllerRig();
  try {
    r.controller.keys.add("KeyW");
    r.controller.jumpQueued = true;
    r.controller.ascendHeld = true;
    r.controller.descendHeld = true;
    r.controller.touchSprint = true;
    r.controller.touchVector.x = 0.7;
    r.controller.touchVector.y = -0.4;

    const manager = createInputFocusManager();
    const orbit = { enabled: null, setInputEnabled(value) { this.enabled = value; } };
    bindInputFocusRuntime({ manager, controller: r.controller, orbit });

    const chat = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
    assert.equal(r.controller.inputEnabled, false);
    assert.equal(orbit.enabled, false);
    assert.deepEqual([...r.controller.keys], []);
    assert.equal(r.controller.jumpQueued, false);
    assert.equal(r.controller.ascendHeld, false);
    assert.equal(r.controller.descendHeld, false);
    assert.equal(r.controller.touchSprint, false);
    assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
    assert.equal(manager.can("WORLD_ACTION"), false);
    assert.equal(manager.can("GAMEPLAY_SHORTCUT"), false);
    assert.equal(manager.snapshot().miniMap, INPUT_MINIMAP.KEEP);
    assert.equal(manager.snapshot().pointerLockDesired, false);
    assert.equal(hasBlockingMiniMapOverlay({ chat: true }), false);

    manager.release(chat);
    assert.equal(r.controller.inputEnabled, true);
    assert.equal(orbit.enabled, true);
  } finally {
    r.cleanup();
  }
});

test("P0 acceptance: modal handoff never exposes a GAMEPLAY frame", () => {
  const manager = createInputFocusManager();
  const seen = [];
  manager.subscribe(state => seen.push({
    focusClass: state.focusClass,
    movement: state.movement,
    camera: state.camera,
    worldAction: state.worldAction,
    owners: [...state.topOwners]
  }));

  const inventory = manager.claim("inventory", INPUT_FOCUS_POLICY.BLOCKING_UI);
  const shop = manager.claim("shop", INPUT_FOCUS_POLICY.BLOCKING_UI);
  manager.release(inventory);

  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.BLOCKING_UI);
  assert.deepEqual(manager.snapshot().topOwners, ["shop"]);
  assert.equal(manager.can("MOVE"), false);
  assert.equal(manager.can("CAMERA"), false);
  assert.equal(manager.can("WORLD_ACTION"), false);
  assert.ok(seen.every(state =>
    state.focusClass !== INPUT_FOCUS_CLASS.GAMEPLAY &&
    state.movement === false &&
    state.camera === false &&
    state.worldAction === false
  ));

  manager.release(shop);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
});

test("P0 acceptance: SYSTEM_LOCK outranks and survives lower-priority UI release", () => {
  const manager = createInputFocusManager();
  const panel = manager.claim("profile", INPUT_FOCUS_POLICY.BLOCKING_UI);
  const system = manager.claim("lobby-transition", INPUT_FOCUS_POLICY.SYSTEM_LOCK);

  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.SYSTEM_LOCK);
  assert.deepEqual(manager.snapshot().topOwners, ["lobby-transition"]);
  assert.equal(manager.snapshot().miniMap, INPUT_MINIMAP.HIDE);
  assert.equal(manager.snapshot().pointerLockDesired, false);

  manager.release(panel);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.SYSTEM_LOCK);
  assert.equal(manager.can("MOVE"), false);
  assert.equal(manager.can("CAMERA"), false);

  manager.release(system);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
  assert.equal(manager.snapshot().pointerLockDesired, true);
});

test("P0 acceptance: window blur clears held keyboard and touch movement", () => {
  const r = realControllerRig();
  try {
    r.controller.keys.add("KeyW");
    r.controller.keys.add("ShiftLeft");
    r.controller.ascendHeld = true;
    r.controller.descendHeld = true;
    r.controller.touchSprint = true;
    r.controller.touchVector.x = 0.5;
    r.controller.touchVector.y = -0.8;

    r.dispatchWindow("blur");

    assert.deepEqual([...r.controller.keys], []);
    assert.equal(r.controller.ascendHeld, false);
    assert.equal(r.controller.descendHeld, false);
    assert.equal(r.controller.touchSprint, false);
    assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
  } finally {
    r.cleanup();
  }
});

test("P0 acceptance: pointer-lock desire is a stable policy contract for P1", () => {
  assert.equal(INPUT_FOCUS_POLICY.GAMEPLAY.pointerLockDesired, true);
  assert.equal(INPUT_FOCUS_POLICY.CHAT.pointerLockDesired, false);
  assert.equal(INPUT_FOCUS_POLICY.BLOCKING_UI.pointerLockDesired, false);
  assert.equal(INPUT_FOCUS_POLICY.SYSTEM_LOCK.pointerLockDesired, false);
});

test("P0 acceptance: IME Enter protection and central shortcut wiring remain present", () => {
  const chat = readFileSync(new URL("../src/online/chat-panel.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const player = readFileSync(new URL("../src/player-controller.js", import.meta.url), "utf8");
  const orbit = readFileSync(new URL("../src/orbit-camera-controller.js", import.meta.url), "utf8");

  assert.match(chat, /event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(main, /const worldActionsSuspended = \(\) => !inputFocus\.can\("WORLD_ACTION"\);/);
  assert.match(main, /canUseGameplayShortcut:\s*\(\)\s*=>\s*inputFocus\.can\("GAMEPLAY_SHORTCUT"\)/);
  assert.doesNotMatch(player, /profile-panel|view-settings|keyboard-shortcuts-panel/);
  assert.doesNotMatch(orbit, /profile-panel|view-settings|keyboard-shortcuts-panel/);
});
