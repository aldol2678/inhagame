import test from "node:test";
import assert from "node:assert/strict";
import { INPUT_FOCUS_CLASS } from "../src/input/input-focus-manager.js";
import { WORLD_INPUT_OWNER_DEFINITIONS, createWorldInputRuntime } from "../src/input/world-input-runtime.js";

test("world input runtime owns the canonical 26 focus owners", () => {
  assert.equal(WORLD_INPUT_OWNER_DEFINITIONS.length, 26);
  assert.equal(new Set(WORLD_INPUT_OWNER_DEFINITIONS.map(([, ownerId]) => ownerId)).size, 26);
});

test("world input runtime preserves blocking and system-lock authority", () => {
  const root = { dataset: {} };
  const runtime = createWorldInputRuntime({ root });

  assert.equal(runtime.inputFocus.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
  assert.equal(runtime.shopInput.acquire(), true);
  assert.equal(runtime.inputFocus.snapshot().focusClass, INPUT_FOCUS_CLASS.BLOCKING_UI);
  assert.equal(runtime.shopInput.release(), true);

  assert.equal(runtime.lobbyWorldInput.acquire(), true);
  assert.equal(runtime.inputFocus.snapshot().focusClass, INPUT_FOCUS_CLASS.SYSTEM_LOCK);
  assert.equal(runtime.lobbyWorldInput.release(), true);
  assert.equal(runtime.inputFocus.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);

  runtime.unsubscribeHudInput();
  runtime.hudPresentation.destroy();
});
