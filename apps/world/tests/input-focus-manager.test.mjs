import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_CURSOR,
  INPUT_FOCUS_CLASS,
  INPUT_FOCUS_POLICY,
  INPUT_MINIMAP,
  createInputFocusManager,
  createInputPolicy
} from "../src/input/input-focus-manager.js";

test("baseline snapshot is gameplay and all gameplay capabilities are enabled", () => {
  const manager = createInputFocusManager();
  const state = manager.snapshot();

  assert.equal(state.focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
  assert.equal(state.priority, 0);
  assert.equal(state.movement, true);
  assert.equal(state.camera, true);
  assert.equal(state.worldAction, true);
  assert.equal(state.gameplayShortcut, true);
  assert.equal(state.textInput, false);
  assert.equal(state.cursor, INPUT_CURSOR.HIDDEN);
  assert.equal(state.pointerLockDesired, true);
  assert.equal(state.miniMap, INPUT_MINIMAP.ACTIVE);
  assert.deepEqual(state.topOwners, []);
  assert.equal(state.activeClaimCount, 0);
  assert.equal(manager.can("MOVE"), true);
  assert.equal(manager.can("CAMERA"), true);
  assert.equal(manager.can("WORLD_ACTION"), true);
});

test("chat claim blocks gameplay input but keeps the minimap contract", () => {
  const manager = createInputFocusManager();
  const token = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  const state = manager.snapshot();

  assert.equal(state.focusClass, INPUT_FOCUS_CLASS.CHAT);
  assert.equal(state.movement, false);
  assert.equal(state.camera, false);
  assert.equal(state.worldAction, false);
  assert.equal(state.gameplayShortcut, false);
  assert.equal(state.textInput, true);
  assert.equal(state.cursor, INPUT_CURSOR.VISIBLE);
  assert.equal(state.pointerLockDesired, false);
  assert.equal(state.miniMap, INPUT_MINIMAP.KEEP);
  assert.deepEqual(state.topOwners, ["chat"]);
  assert.equal(state.activeClaimCount, 1);
  assert.equal(manager.release(token), true);
});

test("higher-priority system lock wins and release recalculates the next active claim", () => {
  const manager = createInputFocusManager();
  const chat = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  const system = manager.claim("lobby-transition", INPUT_FOCUS_POLICY.SYSTEM_LOCK);

  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.SYSTEM_LOCK);
  assert.deepEqual(manager.snapshot().topOwners, ["lobby-transition"]);
  assert.equal(manager.snapshot().activeClaimCount, 2);

  assert.equal(manager.release(system), true);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.CHAT);
  assert.deepEqual(manager.snapshot().topOwners, ["chat"]);

  assert.equal(manager.release(chat), true);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
  assert.deepEqual(manager.snapshot().topOwners, []);
});

test("same-priority claims combine using the more restrictive policy", () => {
  const manager = createInputFocusManager();

  const panelA = createInputPolicy(INPUT_FOCUS_CLASS.BLOCKING_UI, {
    camera: true,
    miniMap: INPUT_MINIMAP.KEEP
  });
  const panelB = createInputPolicy(INPUT_FOCUS_CLASS.BLOCKING_UI, {
    camera: false,
    textInput: true,
    miniMap: INPUT_MINIMAP.SUSPEND
  });

  manager.claim("inventory", panelA);
  manager.claim("shop", panelB);

  const state = manager.snapshot();
  assert.equal(state.focusClass, INPUT_FOCUS_CLASS.BLOCKING_UI);
  assert.equal(state.camera, false, "false wins for gameplay capability booleans");
  assert.equal(state.textInput, true, "text input remains active if either top claim needs it");
  assert.equal(state.cursor, INPUT_CURSOR.VISIBLE);
  assert.equal(state.pointerLockDesired, false);
  assert.equal(state.miniMap, INPUT_MINIMAP.SUSPEND);
  assert.deepEqual(state.topOwners, ["inventory", "shop"]);
});

test("lower-priority claims stay active without overriding the current top policy", () => {
  const manager = createInputFocusManager();
  const chat = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  const modal = manager.claim("full-map", INPUT_FOCUS_POLICY.BLOCKING_UI);

  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.BLOCKING_UI);
  assert.equal(manager.snapshot().activeClaimCount, 2);

  manager.release(modal);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.CHAT);

  manager.release(chat);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
});

test("releaseOwner clears every nested claim from the same owner without touching others", () => {
  const manager = createInputFocusManager();
  manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  manager.claim("full-map", INPUT_FOCUS_POLICY.BLOCKING_UI);

  assert.equal(manager.releaseOwner("chat"), 2);
  assert.equal(manager.size, 1);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.BLOCKING_UI);
  assert.equal(manager.releaseOwner("chat"), 0);
});

test("subscribe receives state changes and can unsubscribe", () => {
  const manager = createInputFocusManager();
  const seen = [];

  const unsubscribe = manager.subscribe(state => {
    seen.push([state.focusClass, state.activeClaimCount, state.version]);
  }, { emitCurrent: true });

  const chat = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  manager.release(chat);
  unsubscribe();
  manager.claim("menu", INPUT_FOCUS_POLICY.BLOCKING_UI);

  assert.deepEqual(seen.map(entry => entry.slice(0, 2)), [
    [INPUT_FOCUS_CLASS.GAMEPLAY, 0],
    [INPUT_FOCUS_CLASS.CHAT, 1],
    [INPUT_FOCUS_CLASS.GAMEPLAY, 0]
  ]);
  assert.ok(seen[1][2] > seen[0][2]);
  assert.ok(seen[2][2] > seen[1][2]);
});

test("clear returns to gameplay baseline in one recalculation", () => {
  const manager = createInputFocusManager();
  manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  manager.claim("system", INPUT_FOCUS_POLICY.SYSTEM_LOCK);

  assert.equal(manager.clear(), true);
  assert.equal(manager.size, 0);
  assert.equal(manager.snapshot().focusClass, INPUT_FOCUS_CLASS.GAMEPLAY);
  assert.equal(manager.clear(), false);
});

test("policy and capability validation fail fast on malformed input", () => {
  const manager = createInputFocusManager();

  assert.throws(() => manager.claim("", INPUT_FOCUS_POLICY.CHAT), /ownerId/);
  assert.throws(() => manager.claim("chat", { ...INPUT_FOCUS_POLICY.CHAT, movement: "no" }), /movement/);
  assert.throws(() => createInputPolicy("NOPE"), /Unknown input focus class/);
  assert.throws(
    () => createInputPolicy(INPUT_FOCUS_CLASS.CHAT, { extra: true }),
    /Unknown input focus policy key/
  );
  assert.throws(() => manager.can("FLY"), /Unknown input capability/);
});

test("snapshots and top owner lists are immutable", () => {
  const manager = createInputFocusManager();
  manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  const state = manager.snapshot();

  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.topOwners), true);
  assert.throws(() => state.topOwners.push("x"), TypeError);
});
