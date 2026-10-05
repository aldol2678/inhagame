import test from "node:test";
import assert from "node:assert/strict";
import { createGuestbookInteraction, distance2D } from "../src/guestbook/guestbook-interaction.js";
import { metersToWorld } from "../src/world-scale.js";

class FakeDoc {
  constructor() { this.handlers = new Map(); }
  addEventListener(type, fn) { this.handlers.set(type, fn); }
  removeEventListener(type, fn) { if (this.handlers.get(type) === fn) this.handlers.delete(type); }
  key(event) { this.handlers.get("keydown")?.(event); }
}

test("3 metres maps to the guestbook interaction radius", () => {
  assert.equal(metersToWorld(3), 1.5);
  assert.equal(distance2D({ x: 0, z: 0 }, { x: 0.9, z: 1.2 }), 1.5);
});

test("guestbook action is range gated and locked while signed out", () => {
  const doc = new FakeDoc();
  let available = false;
  const interaction = createGuestbookInteraction({
    anchor: { x: 0, z: 0 }, radius: 1.5, getAvailable: () => available, doc
  });
  assert.equal(interaction.observe({ x: 2, z: 0 }), null);
  const locked = interaction.observe({ x: 1.5, z: 0 });
  assert.equal(locked.disabled, true);
  assert.equal(locked.icon, "🔒");
  assert.equal(interaction.handlesUseKey(), false);
  available = true;
  const ready = interaction.observe({ x: 1.49, z: 0 });
  assert.equal(ready.disabled, false);
  assert.equal(ready.shortcut, "F");
  assert.equal(interaction.handlesUseKey(), true);
});

test("the guestbook owns no key: F and touch reach it only through the interaction slot action", () => {
  const doc = new FakeDoc();
  let opens = 0;
  const interaction = createGuestbookInteraction({
    anchor: { x: 0, z: 0 }, radius: 1.5, getAvailable: () => true,
    openPanel: () => { opens += 1; }, doc
  });
  assert.equal(doc.handlers.has("keydown"), false, "no keyboard listener of its own");
  const action = interaction.observe({ x: 1, z: 0 });
  assert.equal(action.trigger(), true, "the slot action (F key or mobile button) opens the panel");
  assert.equal(opens, 1);
  for (const code of ["KeyE", "KeyF", "KeyM"]) doc.key({ code, repeat: false, target: null });
  assert.equal(opens, 1, "E stays emotion-only; F is dispatched by the World's interaction slot");
  interaction.observe({ x: 1, z: 0 }, { blocked: true });
  assert.equal(interaction.handlesUseKey(), false);
  assert.equal(interaction.open(), false, "blocked (mounted/indoors) never opens");
  interaction.destroy();
});
