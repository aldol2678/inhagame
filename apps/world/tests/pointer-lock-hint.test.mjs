import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindPointerLockHint, pointerLockHintModel } from "../src/input/pointer-lock-hint.js";

test("Pointer Lock hint stays hidden for mobile, unsupported, UI focus and locked gameplay", () => {
  for (const status of [
    { finePointer: false, supported: false, desired: true, awaitingGesture: false },
    { finePointer: true, supported: false, desired: true, awaitingGesture: false },
    { finePointer: true, supported: true, desired: false, awaitingGesture: false },
    { finePointer: true, supported: true, desired: true, locked: true, awaitingGesture: false }
  ]) {
    assert.equal(pointerLockHintModel(status).visible, false);
  }
});

test("Pointer Lock hint guides explicit click, pending state and fallback", () => {
  assert.deepEqual(pointerLockHintModel({
    finePointer: true, supported: true, desired: true, locked: false, pending: false,
    awaitingGesture: true, lastError: null
  }), {
    visible: true, state: "READY", text: "게임 화면 클릭 · 마우스 고정  |  Esc · 해제"
  });

  assert.equal(pointerLockHintModel({
    finePointer: true, supported: true, desired: true, locked: false, pending: true,
    awaitingGesture: true, lastError: null
  }).state, "PENDING");

  const failed = pointerLockHintModel({
    finePointer: true, supported: true, desired: true, locked: false, pending: false,
    awaitingGesture: true, lastError: "denied"
  });
  assert.equal(failed.state, "FALLBACK");
  assert.match(failed.text, /드래그/);
});

test("Pointer Lock hint binding updates DOM state without taking input", () => {
  const element = { hidden: true, dataset: {}, textContent: "" };
  const hint = bindPointerLockHint(element);

  hint.update({
    finePointer: true, supported: true, desired: true, locked: false, pending: false,
    awaitingGesture: true, lastError: null
  });
  assert.equal(element.hidden, false);
  assert.equal(element.dataset.state, "READY");
  assert.match(element.textContent, /게임 화면 클릭/);

  hint.update({
    finePointer: true, supported: true, desired: true, locked: true, pending: false,
    awaitingGesture: false, lastError: null
  });
  assert.equal(element.hidden, true);
  assert.equal(element.dataset.state, "LOCKED");
  assert.equal(element.textContent, "");
});

test("missing hint element degrades to a no-op binding", () => {
  const hint = bindPointerLockHint(null);
  assert.equal(hint.status().visible, false);
  assert.equal(hint.update({ finePointer: true, supported: true, desired: true }).visible, false);
});


test("Pointer Lock guidance HUD exists and is suppressed on coarse-pointer layouts", () => {
  const html = readFileSync(new URL("../campus/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(html, /id="pointer-lock-hint"[^>]*role="status"[^>]*hidden/);
  assert.match(css, /\.pointer-lock-hint \{/);
  assert.match(css, /\.pointer-lock-hint\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.pointer-lock-hint \{ display: none !important; \} \}/);
});
