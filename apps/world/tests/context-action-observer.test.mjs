import test from "node:test";
import assert from "node:assert/strict";
import { createContextActionController } from "../src/context-action.js";

function fakeButton() {
  const listeners = new Map();
  return {
    hidden: true,
    disabled: false,
    textContent: "",
    dataset: {},
    attrs: new Map(),
    addEventListener(type, cb) { listeners.set(type, cb); },
    removeAttribute(key) { this.attrs.delete(key); delete this.dataset[key]; },
    setAttribute(key, value) { this.attrs.set(key, String(value)); },
    listeners
  };
}

test("context button owns native activation keys without replacing their default clicks", () => {
  const button = fakeButton();
  let triggered = 0;
  const slot = createContextActionController({ button });
  slot.set("puzzle", { label: "Open", trigger: () => { triggered++; } });
  slot.refresh();
  for (const [index, code] of ["Enter", "NumpadEnter", "Space"].entries()) {
    let stopped = false;
    button.listeners.get("keydown")({ code, key: code === "Space" ? " " : "Enter", repeat: true,
      stopPropagation() { stopped = true; },
      preventDefault() { assert.fail("must preserve the browser's native button click"); } });
    assert.equal(stopped, true, `${code} cannot reach the World keyboard handler`);
    assert.equal(triggered, index, "keydown does not synthesize a duplicate click");
    button.listeners.get("click")();
  }
  assert.equal(triggered, 3);
  for (const code of ["KeyF", "KeyM", "Tab", "Escape"]) {
    button.listeners.get("keydown")({ code,
      stopPropagation() { assert.fail(`${code} keeps its existing route`); } });
  }
});

test("context action observer sees only successful triggered actions", () => {
  const button = fakeButton();
  const observed = [];
  const slot = createContextActionController({
    button,
    shortcut: "F",
    coarsePointer: false,
    onTriggered: (action, result) => observed.push({ id: action.id, result })
  });

  slot.set("seat", { label: "앉기", priority: 10, trigger: () => "sat" });
  slot.refresh();
  assert.equal(slot.trigger(), true);
  assert.deepEqual(observed, [{ id: "seat", result: "sat" }]);

  button.listeners.get("click")?.({});
  assert.deepEqual(observed, [
    { id: "seat", result: "sat" },
    { id: "seat", result: "sat" }
  ], "mobile button and keyboard/direct trigger share the observer");

  slot.set("seat", { label: "앉기", priority: 10, trigger: () => false });
  slot.refresh();
  assert.equal(slot.trigger(), false);
  assert.equal(observed.length, 2, "failed trigger does not notify observers");

  slot.set("seat", { label: "앉기", priority: 10, disabled: true, trigger: () => true });
  slot.refresh();
  assert.equal(slot.trigger(), false);
  assert.equal(observed.length, 2, "disabled action does not notify observers");
});
