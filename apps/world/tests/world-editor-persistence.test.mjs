import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EditorCommands } from "../src/editor/editor-commands.js";
import { EditorState } from "../src/editor/editor-state.js";
import { createEmptyWorld, WorldDocument } from "../src/editor/world-document.js";
import { loadWorldDocument, saveWorldDocument } from "../src/editor/editor-persistence.js";
import { parseWorld, serializeWorld } from "../src/editor/world-serialization.js";

const fixture = () => JSON.parse(readFileSync(new URL("../src/editor/fixtures/schema-components.world.json", import.meta.url), "utf8"));

function memoryStore() {
  const canonical = new Map();
  return {
    canonical,
    async writeCanonicalVerified(id, text) { canonical.set(id, text); },
    async readCanonical(id) { return canonical.get(id) ?? null; }
  };
}

test("Save verifies canonical readback, clears dirty, and retains Undo", async () => {
  const document = new WorldDocument(createEmptyWorld({ worldId: "world.save" }));
  const commands = new EditorCommands(document, new EditorState());
  commands.addEntity({ id: "entity.persisted" });
  const store = memoryStore();
  const result = await saveWorldDocument(document, store);
  assert.equal(result.saved, true);
  assert.equal(document.dirty, false);
  assert.equal(commands.canUndo, true);
  assert.equal(parseWorld(store.canonical.get(document.worldId)).entities[0].id, "entity.persisted");
  commands.undo();
  assert.equal(document.dirty, true);
});

test("write failure and readback mismatch keep the document dirty", async () => {
  const document = new WorldDocument(createEmptyWorld({ worldId: "world.fail" }));
  document.markUnsaved();
  const store = memoryStore();
  store.canonical.set(document.worldId, "previous canonical");
  store.writeCanonicalVerified = async () => { throw new Error("disk full"); };
  await assert.rejects(saveWorldDocument(document, store), /disk full/);
  assert.equal(store.canonical.get(document.worldId), "previous canonical");
  assert.equal(document.dirty, true);

  store.writeCanonicalVerified = async () => {};
  await assert.rejects(saveWorldDocument(document, store), /E_WORLD_SAVE_READBACK_MISMATCH/);
  assert.equal(document.dirty, true);
});

test("an edit during asynchronous Save remains dirty", async () => {
  const document = new WorldDocument(createEmptyWorld({ worldId: "world.concurrent" }));
  document.markUnsaved();
  const store = memoryStore();
  store.writeCanonicalVerified = async (id, text) => {
    store.canonical.set(id, text);
    document.addEntity({ id: "entity.after-snapshot" });
  };
  const result = await saveWorldDocument(document, store);
  assert.equal(result.saved, false);
  assert.equal(document.dirty, true);
  assert.equal(parseWorld(store.canonical.get(document.worldId)).entities.length, 0);
});

test("Load validates before replacing the editor document", () => {
  const current = new WorldDocument(createEmptyWorld({ worldId: "world.current" }));
  current.addEntity({ id: "entity.unsaved" });
  assert.throws(() => loadWorldDocument("{broken"), /E_WORLD_JSON_PARSE/);
  const invalid = fixture();
  invalid.entities[0].transform.scale[0] = 0;
  assert.throws(() => loadWorldDocument(JSON.stringify(invalid)), /E_SCALE_INVALID/);
  assert.equal(current.getEntity("entity.unsaved").id, "entity.unsaved");
  assert.equal(current.dirty, true);

  const imported = loadWorldDocument(serializeWorld(fixture()), { unsaved: true });
  assert.equal(imported.dirty, true);
  assert.equal(imported.entityCount, fixture().entities.length);
});

test("canonical serialization normalizes order, tags, signed zero and numeric noise", () => {
  const candidate = fixture();
  candidate.entities.reverse();
  candidate.entities[0].tags = ["z", "a"];
  candidate.entities[0].transform.position[0] = -0;
  candidate.entities[0].transform.position[1] = 1.0000000000000002;
  const text = serializeWorld(candidate);
  assert.equal(serializeWorld(parseWorld(text)), text);
  assert.equal(text.includes("-0"), false);
  const entities = JSON.parse(text).entities;
  assert.deepEqual(entities.map(entity => entity.id), [...entities.map(entity => entity.id)].sort());
  assert.deepEqual(entities.find(entity => entity.id === candidate.entities[0].id).tags, ["a", "z"]);
});

test("warnings permit Save and unknown components survive readback", async () => {
  const candidate = fixture();
  candidate.entities[0].components["test.unknown"] = { note: "kept" };
  const document = new WorldDocument(candidate);
  document.markUnsaved();
  const store = memoryStore();
  const result = await saveWorldDocument(document, store);
  assert.equal(result.saved, true);
  assert.ok(result.warnings.some(item => item.code === "W_COMPONENT_UNKNOWN"));
  assert.deepEqual(loadWorldDocument(store.canonical.get(document.worldId)).getEntity(candidate.entities[0].id).components["test.unknown"], { note: "kept" });
});
