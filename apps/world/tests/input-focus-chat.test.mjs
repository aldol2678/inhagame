import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createChatPanel } from "../src/online/chat-panel.js";
import {
  INPUT_FOCUS_POLICY,
  INPUT_MINIMAP,
  createInputFocusManager
} from "../src/input/input-focus-manager.js";
import { bindInputFocusRuntime } from "../src/input/input-focus-runtime.js";

function rig() {
  const doc = createFakeDocument();
  const el = (tag) => doc.createElement(tag);
  const toggle = el("button");
  const form = el("form");
  const input = el("input");
  const feedList = el("ol");
  const hint = el("p");
  form.append(input);

  const manager = createInputFocusManager();
  const controller = {
    enabled: null,
    setInputEnabled(value) { this.enabled = value; }
  };
  const orbit = {
    enabled: null,
    setInputEnabled(value) { this.enabled = value; }
  };
  bindInputFocusRuntime({ manager, controller, orbit });

  const chat = {
    signedIn: true,
    submit: () => ({ result: "sent" })
  };

  let token = null;
  const panel = createChatPanel({
    toggle,
    form,
    input,
    feedList,
    hint,
    doc,
    getChat: () => chat,
    onOpenChange(open) {
      if (open) {
        if (!token) token = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
        return;
      }
      if (token) {
        manager.release(token);
        token = null;
      }
    }
  });

  return { manager, controller, orbit, panel, input };
}

test("opening chat acquires one CHAT claim and disables gameplay runtime", () => {
  const r = rig();

  assert.equal(r.controller.enabled, true);
  assert.equal(r.orbit.enabled, true);
  assert.equal(r.manager.size, 0);

  assert.equal(r.panel.setOpen(true), true);
  assert.equal(r.manager.size, 1);
  assert.equal(r.manager.snapshot().focusClass, "CHAT");
  assert.equal(r.manager.snapshot().miniMap, INPUT_MINIMAP.KEEP);
  assert.equal(r.controller.enabled, false);
  assert.equal(r.orbit.enabled, false);
  assert.equal(r.manager.can("WORLD_ACTION"), false);
  assert.equal(r.manager.can("GAMEPLAY_SHORTCUT"), false);

  r.panel.setOpen(true);
  assert.equal(r.manager.size, 1, "duplicate open does not leak another chat claim");
});

test("Esc/close releases the chat claim and restores gameplay", () => {
  const r = rig();

  r.panel.setOpen(true);
  r.input.dispatch("keydown", { code: "Escape", key: "Escape" });

  assert.equal(r.panel.open, false);
  assert.equal(r.manager.size, 0);
  assert.equal(r.controller.enabled, true);
  assert.equal(r.orbit.enabled, true);
  assert.equal(r.manager.can("WORLD_ACTION"), true);
  assert.equal(r.manager.can("GAMEPLAY_SHORTCUT"), true);
});

test("successful send releases ownership, blocked send keeps it", () => {
  const r = rig();
  r.panel.setOpen(true);
  r.input.value = "hello";
  assert.equal(r.panel.send(), "sent");
  assert.equal(r.manager.size, 0);

  const doc = createFakeDocument();
  const el = (tag) => doc.createElement(tag);
  const toggle = el("button");
  const form = el("form");
  const input = el("input");
  const feedList = el("ol");
  const hint = el("p");
  form.append(input);

  const manager = createInputFocusManager();
  let token = null;
  const panel = createChatPanel({
    toggle, form, input, feedList, hint, doc,
    getChat: () => ({ signedIn: true, submit: () => ({ result: "rate_limited" }) }),
    onOpenChange(open) {
      if (open && !token) token = manager.claim("chat", INPUT_FOCUS_POLICY.CHAT);
      if (!open && token) {
        manager.release(token);
        token = null;
      }
    }
  });

  panel.setOpen(true);
  input.value = "again";
  assert.equal(panel.send(), "rate_limited");
  assert.equal(panel.open, true);
  assert.equal(manager.size, 1, "failed send keeps chat input ownership");
});
