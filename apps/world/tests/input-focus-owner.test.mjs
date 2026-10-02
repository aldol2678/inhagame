import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_FOCUS_POLICY,
  createInputFocusManager
} from "../src/input/input-focus-manager.js";
import { createInputFocusOwner } from "../src/input/input-focus-owner.js";

test("owner acquires exactly one claim until released", () => {
  const manager = createInputFocusManager();
  const owner = createInputFocusOwner({
    manager,
    ownerId: "full-map",
    policy: INPUT_FOCUS_POLICY.BLOCKING_UI
  });

  assert.equal(owner.active, false);
  assert.equal(owner.acquire(), true);
  assert.equal(owner.active, true);
  assert.equal(manager.size, 1);
  assert.equal(owner.acquire(), false);
  assert.equal(manager.size, 1);

  assert.equal(owner.release(), true);
  assert.equal(owner.active, false);
  assert.equal(manager.size, 0);
  assert.equal(owner.release(), false);
});

test("two blocking owners overlap without restoring gameplay between them", () => {
  const manager = createInputFocusManager();
  const hud = createInputFocusOwner({
    manager,
    ownerId: "hud-menu",
    policy: INPUT_FOCUS_POLICY.BLOCKING_UI
  });
  const help = createInputFocusOwner({
    manager,
    ownerId: "keyboard-help",
    policy: INPUT_FOCUS_POLICY.BLOCKING_UI
  });

  hud.acquire();
  help.acquire();
  assert.equal(manager.size, 2);
  assert.equal(manager.can("MOVE"), false);
  assert.deepEqual(manager.snapshot().topOwners, ["hud-menu", "keyboard-help"]);

  hud.release();
  assert.equal(manager.size, 1);
  assert.equal(manager.can("MOVE"), false, "remaining blocking owner keeps gameplay locked");

  help.release();
  assert.equal(manager.can("MOVE"), true);
});

test("owner validates manager, id and policy", () => {
  const manager = createInputFocusManager();
  assert.throws(() => createInputFocusOwner({}), /manager/);
  assert.throws(() => createInputFocusOwner({
    manager, ownerId: "", policy: INPUT_FOCUS_POLICY.BLOCKING_UI
  }), /ownerId/);
  assert.throws(() => createInputFocusOwner({
    manager, ownerId: "x", policy: null
  }), /policy/);
});
