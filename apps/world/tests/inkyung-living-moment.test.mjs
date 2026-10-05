import test from "node:test";
import assert from "node:assert/strict";
import {
  createInkyungLivingMoment,
  INKYUNG_LIVING_ZONE_ID,
  INKYUNG_LIVING_MOMENT_STORAGE_KEY
} from "../src/inkyung-living-moment.js";

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data
  };
}

function elements() {
  const listeners = new Map();
  const toggleElement = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, handler) { listeners.set(type, handler); },
    click() { listeners.get("click")?.(); }
  };
  const countElement = { textContent: "" };
  return {
    root: {
      hidden: true,
      dataset: {},
      querySelector(selector) {
        if (selector === "#inkyung-living-toggle") return toggleElement;
        if (selector === "#inkyung-living-count") return countElement;
        return null;
      }
    },
    actionsElement: { textContent: "" },
    toggleElement,
    countElement
  };
}

test("C15.3 living guide appears only inside Inkyung and keeps a solo-safe two-action baseline", () => {
  const storage = memoryStorage();
  const ui = elements();
  const guide = createInkyungLivingMoment({ ...ui, storage });

  assert.equal(guide.status().visible, false);
  guide.setZone(INKYUNG_LIVING_ZONE_ID);
  assert.equal(ui.root.hidden, false);
  assert.deepEqual(guide.status().suggestions, ["duck", "seat"]);
  assert.match(ui.actionsElement.textContent, /오리 살펴보기/);
  assert.match(ui.actionsElement.textContent, /벤치에 앉기/);
  assert.doesNotMatch(ui.actionsElement.textContent, /NPC/);

  guide.setZone("AREA_MAIN_HALL");
  assert.equal(ui.root.hidden, true);
});

test("C15.3 adds NPC discovery only when the runtime is available", () => {
  const ui = elements();
  const guide = createInkyungLivingMoment({ ...ui, storage: memoryStorage() });
  guide.setZone(INKYUNG_LIVING_ZONE_ID);
  guide.setNpcAvailable(true);

  assert.deepEqual(guide.status().suggestions, ["duck", "seat", "npc"]);
  assert.match(ui.actionsElement.textContent, /NPC와 대화/);

  guide.setNpcAvailable(false);
  assert.deepEqual(guide.status().suggestions, ["duck", "seat"]);
});

test("C15.3 one meaningful Inkyung interaction completes the one-time guide", () => {
  const storage = memoryStorage();
  const ui = elements();
  const guide = createInkyungLivingMoment({ ...ui, storage });
  guide.setZone(INKYUNG_LIVING_ZONE_ID);

  assert.equal(guide.recordAction("guestbook"), false, "unrelated actions do not complete the guide");
  assert.equal(guide.recordAction("seat"), true);
  assert.equal(guide.status().completed, true);
  assert.equal(ui.root.hidden, true);
  assert.equal(storage.data.get(INKYUNG_LIVING_MOMENT_STORAGE_KEY), "done");

  const reloadedUi = elements();
  const reloaded = createInkyungLivingMoment({ ...reloadedUi, storage });
  reloaded.setZone(INKYUNG_LIVING_ZONE_ID);
  assert.equal(reloaded.status().completed, true);
  assert.equal(reloadedUi.root.hidden, true, "completed guide does not nag on later visits");
});

test("C15.3 lobby/room suppression hides the guide without completing it", () => {
  const ui = elements();
  const guide = createInkyungLivingMoment({ ...ui, storage: memoryStorage() });
  guide.setZone(INKYUNG_LIVING_ZONE_ID);
  guide.setSuppressed(true);
  assert.equal(ui.root.hidden, true);
  assert.equal(guide.status().completed, false);
  guide.setSuppressed(false);
  assert.equal(ui.root.hidden, false);
});


test("C15.3 mobile guide auto-collapses into a small reopen chip", () => {
  const ui = elements();
  let scheduled = null;
  const guide = createInkyungLivingMoment({
    ...ui,
    storage: memoryStorage(),
    autoCollapseMs: 4200,
    setTimeoutFn(handler, delay) {
      scheduled = { handler, delay };
      return 1;
    },
    clearTimeoutFn() {}
  });

  guide.setZone(INKYUNG_LIVING_ZONE_ID);
  assert.equal(guide.status().collapsed, false);
  assert.equal(ui.root.dataset.mode, "EXPANDED");
  assert.equal(ui.toggleElement.attributes["aria-expanded"], "true");
  assert.equal(ui.countElement.textContent, "2");
  assert.equal(scheduled?.delay, 4200);

  scheduled.handler();
  assert.equal(guide.status().collapsed, true);
  assert.equal(ui.root.dataset.mode, "COLLAPSED");
  assert.equal(ui.toggleElement.attributes["aria-expanded"], "false");

  ui.toggleElement.click();
  assert.equal(guide.status().collapsed, false);
  assert.equal(ui.root.dataset.mode, "EXPANDED");

  guide.setNpcAvailable(true);
  assert.equal(ui.countElement.textContent, "3");
});
