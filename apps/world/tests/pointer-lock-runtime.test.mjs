import test from "node:test";
import assert from "node:assert/strict";
import {
  INPUT_FOCUS_POLICY,
  createInputFocusManager
} from "../src/input/input-focus-manager.js";
import { bindPointerLockRuntime } from "../src/input/pointer-lock-runtime.js";

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter(item => item !== fn));
    },
    dispatch(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    }
  }, extra);
}

function rig({ finePointer = true, requestThrows = false } = {}) {
  const manager = createInputFocusManager();
  const statusChanges = [];
  const documentLike = eventTarget({
    pointerLockElement: null,
    exitCount: 0,
    exitPointerLock() {
      this.exitCount += 1;
      this.pointerLockElement = null;
      this.dispatch("pointerlockchange");
    }
  });
  const windowTarget = eventTarget({
    matchMedia: () => ({ matches: finePointer })
  });
  const canvas = eventTarget({
    requestCount: 0,
    requestPointerLock() {
      this.requestCount += 1;
      if (requestThrows) throw new Error("denied");
      documentLike.pointerLockElement = this;
      documentLike.dispatch("pointerlockchange");
    }
  });
  const orbit = {
    active: false,
    looks: [],
    setPointerLockActive(value) { this.active = value === true; },
    pointerLook(x, y) { this.looks.push([x, y]); return true; }
  };
  const runtime = bindPointerLockRuntime({
    manager, canvas, orbit, documentLike, windowTarget,
    onStatusChange: status => statusChanges.push(status)
  });
  return { manager, documentLike, windowTarget, canvas, orbit, runtime, statusChanges };
}

test("runtime publishes status transitions for guidance without requesting lock on bind", () => {
  const r = rig();
  assert.ok(r.statusChanges.length >= 1);
  assert.equal(r.statusChanges.at(-1).awaitingGesture, true);
  assert.equal(r.canvas.requestCount, 0);

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.ok(r.statusChanges.some(status => status.pending === true));
  assert.equal(r.statusChanges.at(-1).locked, true);
});

test("fine-pointer gameplay waits for a user gesture, locks, and routes movement deltas", () => {
  const r = rig();

  assert.equal(r.runtime.status().supported, true);
  assert.equal(r.runtime.status().desired, true);
  assert.equal(r.runtime.status().locked, false);
  assert.equal(r.runtime.status().awaitingGesture, true);
  assert.equal(r.canvas.requestCount, 0, "binding never auto-requests Pointer Lock");

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 1);
  assert.equal(r.runtime.status().locked, true);
  assert.equal(r.orbit.active, true);

  r.documentLike.dispatch("mousemove", { movementX: 17, movementY: -9 });
  assert.deepEqual(r.orbit.looks, [[17, -9]]);
});

test("Chat/UI desire releases lock and GAMEPLAY restoration waits for the next canvas click", () => {
  const r = rig();
  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.runtime.status().locked, true);

  const chat = r.manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
  assert.equal(r.documentLike.exitCount, 1);
  assert.equal(r.runtime.status().locked, false);
  assert.equal(r.runtime.status().desired, false);
  assert.equal(r.orbit.active, false);

  r.manager.release(chat);
  assert.equal(r.runtime.status().desired, true);
  assert.equal(r.runtime.status().awaitingGesture, true);
  assert.equal(r.canvas.requestCount, 1, "focus restoration does not create a forbidden auto-retry");

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 2);
  assert.equal(r.runtime.status().locked, true);
});

test("Esc-style browser unlock never immediately reacquires Pointer Lock", () => {
  const r = rig();
  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 1);

  r.documentLike.pointerLockElement = null;
  r.documentLike.dispatch("pointerlockchange");
  assert.equal(r.runtime.status().locked, false);
  assert.equal(r.runtime.status().desired, true);
  assert.equal(r.canvas.requestCount, 1, "pointerlockchange does not loop requestPointerLock");

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 2, "next explicit gameplay click reacquires");
});

test("Pointer Lock failure degrades to fallback without an automatic request loop", () => {
  const r = rig({ requestThrows: true });

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 1);
  assert.equal(r.runtime.status().locked, false);
  assert.equal(r.runtime.status().pending, false);
  assert.equal(r.runtime.status().errors, 1);

  r.documentLike.dispatch("pointerlockerror");
  assert.equal(r.canvas.requestCount, 1, "error notification itself never retries");

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 2, "only a new user gesture retries");
});

test("successful retry clears the active error state while preserving diagnostics count", () => {
  let fail = true;
  const r = rig();
  r.canvas.requestPointerLock = function requestPointerLock() {
    this.requestCount += 1;
    if (fail) throw new Error("denied");
    r.documentLike.pointerLockElement = this;
    r.documentLike.dispatch("pointerlockchange");
  };

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.match(r.runtime.status().lastError, /denied/);
  assert.equal(r.runtime.status().errors, 1);

  fail = false;
  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.runtime.status().locked, true);
  assert.equal(r.runtime.status().lastError, null);
  assert.equal(r.runtime.status().errors, 1);
});

test("coarse-pointer/mobile path never invokes the Pointer Lock API", () => {
  const r = rig({ finePointer: false });

  assert.equal(r.runtime.status().supported, false);
  assert.equal(r.runtime.status().finePointer, false);
  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  r.canvas.dispatch("pointerdown", { pointerType: "touch", button: 0 });
  r.documentLike.dispatch("mousemove", { movementX: 10, movementY: 10 });

  assert.equal(r.canvas.requestCount, 0);
  assert.deepEqual(r.orbit.looks, []);
  assert.equal(r.orbit.active, false);
});

test("window blur exits active lock and destroy removes ownership cleanly", () => {
  const r = rig();
  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });

  r.windowTarget.dispatch("blur");
  assert.equal(r.documentLike.exitCount, 1);
  assert.equal(r.runtime.status().locked, false);

  assert.equal(r.runtime.destroy(), true);
  assert.equal(r.runtime.destroy(), false);
  assert.equal(r.orbit.active, false);

  r.canvas.dispatch("pointerdown", { pointerType: "mouse", button: 0 });
  assert.equal(r.canvas.requestCount, 1, "destroyed runtime no longer listens to canvas gestures");
});
