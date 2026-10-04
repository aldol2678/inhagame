import test from "node:test";
import assert from "node:assert/strict";
import { PlayerController } from "../src/player-controller.js";
import { CAMPUS_BIKE_ID } from "../src/mounts/campus-bike-world.js";
import { DRAGON_MOUNT_ID } from "../src/mounts/mount-kinds.js";
import { createInputFocusManager, INPUT_FOCUS_POLICY } from "../src/input/input-focus-manager.js";
import { bindInputFocusRuntime } from "../src/input/input-focus-runtime.js";

// Deterministic DOM/capture adapter for the real PlayerController. These are
// synthetic event regressions, not evidence from a physical touch device.
class Control {
  listeners = new Map();
  captures = new Set();
  style = {};
  clientWidth = 120;
  releaseCount = 0;
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ type, target: this, currentTarget: this, preventDefault() {}, ...event });
    }
  }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    this.releaseCount += 1;
    this.captures.delete(id);
    // Exercise reentrancy: some adapters dispatch capture loss immediately.
    this.dispatch("lostpointercapture", { pointerId: id });
  }
}

function rig(t) {
  const previous = Object.fromEntries(["window", "document", "HTMLElement"].map(key => [key, globalThis[key]]));
  const elements = Object.fromEntries(["joystick", "joystick-knob", "jump", "run", "descend"].map(id => [id, new Control()]));
  elements["joystick-knob"].clientWidth = 40;
  const window = new Control();
  const document = Object.assign(new Control(), {
    body: { dataset: {} }, hidden: false,
    getElementById: id => elements[id] ?? null
  });
  Object.assign(globalThis, { window, document, HTMLElement: class {} });
  t.after(() => Object.assign(globalThis, previous));
  const position = { x: 0, y: 1.15, z: -98 };
  const controller = new PlayerController({
    getLocalPosition: () => ({ ...position }),
    setLocalPosition: (x, y, z) => Object.assign(position, { x, y, z }),
    setLocalEulerAngles() {}
  });
  return { controller, position, window, document, elements, pad: elements.joystick, knob: elements["joystick-knob"] };
}

const right = pointerId => ({ pointerId, clientX: 100, clientY: 60 });
const left = pointerId => ({ pointerId, clientX: 20, clientY: 60 });
function assertReleased(r) {
  assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
  assert.equal(r.knob.style.transform, "translate(0,0)");
}

test("joystick keeps its first pointer on duplicate or foreign pointerdown", t => {
  const r = rig(t);
  r.pad.dispatch("pointerdown", right(0));
  assert.equal(r.controller.touchVector.x, 1, "pointer ID zero is a valid owner");
  r.pad.dispatch("pointerdown", left(0));
  assert.equal(r.controller.touchVector.x, 1, "duplicate down cannot restart the gesture");
  r.pad.dispatch("pointerdown", left(2));
  assert.equal(r.controller.touchVector.x, 1, "second finger cannot replace the owner");
  r.pad.dispatch("pointermove", left(2));
  assert.equal(r.controller.touchVector.x, 1);
  r.pad.dispatch("pointermove", left(0));
  assert.equal(r.controller.touchVector.x, -1);
});

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  test(`foreign ${type} cannot end the joystick owner's gesture`, t => {
    const r = rig(t);
    r.pad.dispatch("pointerdown", right(1));
    r.pad.dispatch(type, { pointerId: 2 });
    assert.deepEqual(r.controller.touchVector, { x: 1, y: 0 });
    assert.equal(r.knob.style.transform, "translate(40px,0px)");
    r.pad.dispatch("pointermove", left(1));
    assert.equal(r.controller.touchVector.x, -1);
  });

  test(`owning ${type} releases movement and ignores late move/release events`, t => {
    const r = rig(t);
    r.pad.dispatch("pointerdown", right(1));
    if (type === "lostpointercapture") r.pad.captures.delete(1);
    r.pad.dispatch(type, { pointerId: 1 });
    assertReleased(r);
    assert.equal(r.pad.hasPointerCapture(1), false);
    r.pad.dispatch("pointermove", right(1));
    assertReleased(r);
    r.pad.dispatch("pointerdown", left(2));
    assert.equal(r.controller.touchVector.x, -1);
    r.pad.dispatch(type, { pointerId: 1 });
    assert.equal(r.controller.touchVector.x, -1, "late old release cannot cancel the next gesture");
  });
}

test("pointer release clears ownership before reentrant lostpointercapture", t => {
  const r = rig(t);
  r.pad.dispatch("pointerdown", right(1));
  assert.doesNotThrow(() => r.pad.dispatch("pointerup", { pointerId: 1 }));
  assertReleased(r);
  assert.equal(r.pad.releaseCount, 1);
  r.pad.dispatch("pointercancel", { pointerId: 1 });
  assert.equal(r.pad.releaseCount, 1);
});

for (const failure of ["missing", "throws"]) {
  test(`unavailable pointer capture (${failure}) cannot strand active movement`, t => {
    const r = rig(t);
    r.pad.setPointerCapture = failure === "missing" ? undefined : () => { throw new Error("NotFoundError"); };
    assert.doesNotThrow(() => r.pad.dispatch("pointerdown", right(1)));
    assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
    r.pad.dispatch("pointermove", right(1));
    assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
    r.pad.setPointerCapture = Control.prototype.setPointerCapture;
    r.pad.dispatch("pointerdown", left(2));
    assert.equal(r.controller.touchVector.x, -1);
  });
}

test("capture loss during setPointerCapture cannot restore a cancelled gesture", t => {
  const r = rig(t);
  r.pad.setPointerCapture = id => r.pad.dispatch("lostpointercapture", { pointerId: id });
  r.pad.dispatch("pointerdown", right(1));
  assertReleased(r);
  r.pad.dispatch("pointermove", right(1));
  assertReleased(r);
});

test("capture release errors cannot prevent reset or a new gesture", t => {
  const r = rig(t);
  r.pad.dispatch("pointerdown", right(1));
  r.pad.releasePointerCapture = () => { throw new Error("NotFoundError"); };
  assert.doesNotThrow(() => r.pad.dispatch("pointercancel", { pointerId: 1 }));
  assertReleased(r);
  r.pad.dispatch("pointerdown", left(2));
  assert.equal(r.controller.touchVector.x, -1);
});

test("blocking input focus releases capture/knob and cannot resume an old finger after closing", t => {
  const r = rig(t);
  const manager = createInputFocusManager();
  const binding = bindInputFocusRuntime({ manager, controller: r.controller, orbit: { setInputEnabled() {} } });
  t.after(() => binding.destroy());
  r.pad.dispatch("pointerdown", right(1));
  const panel = manager.claim("touch-test-panel", INPUT_FOCUS_POLICY.BLOCKING_UI);
  assertReleased(r);
  assert.equal(r.pad.hasPointerCapture(1), false);
  r.pad.dispatch("pointermove", right(1));
  r.pad.dispatch("pointerdown", right(2));
  assertReleased(r);
  manager.release(panel);
  r.pad.dispatch("pointermove", right(1));
  r.pad.dispatch("pointermove", right(2));
  assertReleased(r);
  r.pad.dispatch("pointerdown", left(3));
  assert.equal(r.controller.touchVector.x, -1);
});

for (const lifecycle of ["blur", "hidden", "pagehide", "persisted-pagehide"]) {
  test(`${lifecycle} releases held input and invalidates the old joystick owner`, t => {
    const r = rig(t);
    r.pad.dispatch("pointerdown", right(1));
    r.elements.jump.dispatch("pointerdown", { pointerId: 2 });
    r.elements.descend.dispatch("pointerdown", { pointerId: 3 });
    r.elements.run.dispatch("pointerdown", { pointerId: 4, button: 0 });
    r.controller.keys.add("KeyW");
    if (lifecycle === "hidden") {
      r.document.hidden = true;
      r.document.dispatch("visibilitychange");
    } else {
      r.window.dispatch(lifecycle.includes("pagehide") ? "pagehide" : lifecycle, { persisted: lifecycle === "persisted-pagehide" });
    }
    assertReleased(r);
    assert.equal(r.pad.hasPointerCapture(1), false);
    assert.equal(r.controller.jumpQueued, false);
    assert.equal(r.controller.ascendHeld, false);
    assert.equal(r.controller.descendHeld, false);
    assert.equal(r.controller.touchSprint, false);
    assert.equal(r.controller.keys.size, 0);
    r.document.hidden = false;
    r.document.dispatch("visibilitychange");
    r.pad.dispatch("pointermove", right(1));
    assertReleased(r);
    r.pad.dispatch("pointerdown", left(5));
    assert.equal(r.controller.touchVector.x, -1);
  });
}

test("visible visibilitychange does not interrupt an active joystick", t => {
  const r = rig(t);
  r.pad.dispatch("pointerdown", right(1));
  r.document.dispatch("visibilitychange");
  assert.equal(r.controller.touchVector.x, 1);
});

test("joystick and jump remain independent with two fingers", t => {
  const r = rig(t);
  r.pad.dispatch("pointerdown", right(1));
  r.elements.jump.dispatch("pointerdown", { pointerId: 2 });
  assert.equal(r.controller.ascendHeld, true);
  assert.equal(r.controller.jumpQueued, true);
  assert.equal(r.controller.touchVector.x, 1);
  r.elements.jump.dispatch("pointerup", { pointerId: 2 });
  r.pad.dispatch("pointerup", { pointerId: 2 });
  assert.equal(r.controller.ascendHeld, false);
  assert.equal(r.controller.touchVector.x, 1);
  r.elements.jump.dispatch("pointerdown", { pointerId: 3 });
  r.pad.dispatch("pointercancel", { pointerId: 1 });
  assertReleased(r);
  assert.equal(r.controller.ascendHeld, true, "joystick cancellation cannot release the other finger's jump");
  r.elements.jump.dispatch("pointerup", { pointerId: 3 });
  assert.equal(r.controller.ascendHeld, false);
});

for (const mountId of [null, CAMPUS_BIKE_ID, DRAGON_MOUNT_ID]) {
  test(`capture loss stops actual ${mountId ?? "walk"} movement through PlayerController.update`, t => {
    const r = rig(t);
    if (mountId) {
      r.controller.mounted = true;
      r.controller.mountId = mountId;
    }
    if (mountId === DRAGON_MOUNT_ID) {
      r.position.y = 5;
      r.controller.grounded = false;
    }
    r.pad.dispatch("pointerdown", right(1));
    const startX = r.position.x;
    r.controller.update(1 / 60, 0);
    assert.ok(r.position.x > startX);
    r.pad.captures.delete(1);
    r.pad.dispatch("lostpointercapture", { pointerId: 1 });
    const stoppedX = r.position.x;
    r.controller.update(1 / 60, 0);
    assert.equal(r.position.x, stoppedX);
    assert.equal(r.controller.moving, false);
  });
}
