import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_FOCUS_POLICY,
  createInputFocusManager
} from "../src/input/input-focus-manager.js";
import { bindInputFocusRuntime } from "../src/input/input-focus-runtime.js";

function rig() {
  const calls = [];
  const controller = {
    enabled: null,
    setInputEnabled(value) {
      this.enabled = value;
      calls.push(["movement", value]);
    }
  };
  const orbit = {
    enabled: null,
    setInputEnabled(value) {
      this.enabled = value;
      calls.push(["camera", value]);
    }
  };
  const manager = createInputFocusManager();
  const binding = bindInputFocusRuntime({ manager, controller, orbit });
  return { manager, controller, orbit, binding, calls };
}

test("binding immediately applies gameplay baseline once", () => {
  const r = rig();
  assert.equal(r.controller.enabled, true);
  assert.equal(r.orbit.enabled, true);
  assert.deepEqual(r.calls, [["movement", true], ["camera", true]]);
});

test("chat claim disables movement and camera, release restores both", () => {
  const r = rig();
  const chat = r.manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);

  assert.equal(r.controller.enabled, false);
  assert.equal(r.orbit.enabled, false);
  assert.deepEqual(r.calls.slice(-2), [["movement", false], ["camera", false]]);

  r.manager.release(chat);
  assert.equal(r.controller.enabled, true);
  assert.equal(r.orbit.enabled, true);
  assert.deepEqual(r.calls.slice(-2), [["movement", true], ["camera", true]]);
});

test("unchanged effective capability does not rewrite adapters", () => {
  const r = rig();
  const before = r.calls.length;

  const a = r.manager.claim("a", INPUT_FOCUS_POLICY.BLOCKING_UI);
  const afterA = r.calls.length;
  r.manager.claim("b", INPUT_FOCUS_POLICY.BLOCKING_UI);

  assert.equal(afterA, before + 2);
  assert.equal(r.calls.length, afterA, "same effective movement/camera booleans are not rewritten");

  r.manager.release(a);
  assert.equal(r.calls.length, afterA, "remaining blocking claim keeps the same effective booleans");
});

test("sync re-applies only when manager state differs from last applied values", () => {
  const r = rig();
  const before = r.calls.length;
  assert.equal(r.binding.sync(), true);
  assert.equal(r.calls.length, before);

  const system = r.manager.claim("system", INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  const blocked = r.calls.length;
  assert.equal(r.binding.sync(), true);
  assert.equal(r.calls.length, blocked);

  r.manager.release(system);
  assert.equal(r.controller.enabled, true);
  assert.equal(r.orbit.enabled, true);
});

test("destroy unsubscribes and is idempotent", () => {
  const r = rig();
  const before = r.calls.length;

  assert.equal(r.binding.destroy(), true);
  assert.equal(r.binding.destroy(), false);

  r.manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  assert.equal(r.calls.length, before);
  assert.equal(r.binding.sync(), false);
});

test("binding validates its required adapters", () => {
  const manager = createInputFocusManager();
  assert.throws(() => bindInputFocusRuntime({}), /manager/);
  assert.throws(() => bindInputFocusRuntime({ manager, controller: {}, orbit: { setInputEnabled() {} } }), /PlayerController/);
  assert.throws(() => bindInputFocusRuntime({ manager, controller: { setInputEnabled() {} }, orbit: {} }), /OrbitCameraController/);
});
