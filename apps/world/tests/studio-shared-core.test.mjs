import test from "node:test";
import assert from "node:assert/strict";

import { createStudioDocumentHost } from "../src/studio/core/document-host.js";
import { HostedEditorAdapter } from "../src/studio/core/hosted-editor-adapter.js";
import { WorldStudioAdapter } from "../src/studio/adapters/world-adapter.js";
import { AudioStudioAdapter } from "../src/studio/adapters/audio-adapter.js";

function fakeAdapter(moduleId = "world") {
  const calls = [];
  let status = { ready: true, mounted: true, moduleId, canUndo: true, canRedo: false };
  return {
    calls,
    getStatus: () => status,
    setStatus(next) { status = { ...status, ...next }; },
    async save() { calls.push("save"); return { saved: true }; },
    async togglePreview() { calls.push("togglePreview"); return { previewOpen: true }; },
    async validate() { calls.push("validate"); return { valid: true, errors: 0, warnings: 1, firstCode: "W_TEST" }; },
    async undo() { calls.push("undo"); return { applied: true }; },
    async redo() { calls.push("redo"); return { applied: false }; },
    async getContent() {
      calls.push("getContent");
      return { moduleId, sections: [{ id: "scene", label: "SCENE", items: [] }] };
    },
    async selectContent(kind, id) {
      calls.push(`selectContent:${kind}:${id}`);
      return { selected: true, kind, id };
    },
    async getInspector() {
      calls.push("getInspector");
      return {
        moduleId,
        selection: { kind: "entity", id: "entity.test", title: "Test", subtitle: "prop" },
        fields: [{ key: "name", label: "Name", type: "text", value: "Test", editable: true }]
      };
    },
    async updateInspector(kind, id, field, value) {
      calls.push(`updateInspector:${kind}:${id}:${field}:${value}`);
      return {
        moduleId,
        selection: { kind, id, title: String(value), subtitle: "prop" },
        fields: [{ key: field, label: "Name", type: "text", value, editable: true }]
      };
    }
  };
}

test("StudioDocumentHost routes shared document commands and caches validation", async () => {
  const host = createStudioDocumentHost();
  const adapter = fakeAdapter("world");
  host.attach("world", adapter);
  host.updateStatus("world", { ready: true, mounted: true, moduleId: "world", canUndo: true, canRedo: false });

  assert.equal(host.getStatus("world").ready, true);
  assert.deepEqual(await host.save("world"), { saved: true });
  assert.deepEqual(await host.togglePreview("world"), { previewOpen: true });
  assert.deepEqual(await host.undo("world"), { applied: true });
  assert.deepEqual(await host.redo("world"), { applied: false });
  assert.equal((await host.getContent("world")).moduleId, "world");
  assert.deepEqual(await host.selectContent("world", "entity", "entity.test"), {
    selected: true, kind: "entity", id: "entity.test"
  });
  assert.equal((await host.getInspector("world")).selection.id, "entity.test");
  assert.equal(
    (await host.updateInspector("world", "entity", "entity.test", "name", "Renamed")).fields[0].value,
    "Renamed"
  );

  const validation = await host.validate("world");
  assert.equal(validation.valid, true);
  assert.equal(host.getValidation("world").firstCode, "W_TEST");
  assert.deepEqual(adapter.calls, [
    "save", "togglePreview", "undo", "redo",
    "getContent", "selectContent:entity:entity.test",
    "getInspector", "updateInspector:entity:entity.test:name:Renamed",
    "validate"
  ]);

  host.detach("world");
  assert.equal(host.getAdapter("world"), null);
  assert.equal(host.getValidation("world"), null);
  await assert.rejects(() => host.save("world"), /E_STUDIO_DOCUMENT_NOT_READY:world/);
});

test("World and Audio adapters share the HostedEditorAdapter core", () => {
  const container = { replaceChildren() {}, dataset: {} };
  const windowTarget = {
    location: { origin: "http://studio.test" },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout
  };
  const documentLike = {
    createElement() {
      return {
        setAttribute() {},
        remove() {},
        contentWindow: { postMessage() {} }
      };
    }
  };

  const world = new WorldStudioAdapter({ container, windowTarget, documentLike });
  const audio = new AudioStudioAdapter({ container, windowTarget, documentLike });
  assert.equal(world instanceof HostedEditorAdapter, true);
  assert.equal(audio instanceof HostedEditorAdapter, true);
  assert.equal(world.moduleId, "world");
  assert.equal(audio.moduleId, "audio");
  assert.equal(world.channel, "inha.studio.world/1");
  assert.equal(audio.channel, "inha.studio.audio/1");
  assert.equal(typeof world.getContent, "function");
  assert.equal(typeof world.selectContent, "function");
  assert.equal(typeof audio.getContent, "function");
  assert.equal(typeof audio.selectContent, "function");
  assert.equal(typeof world.getInspector, "function");
  assert.equal(typeof world.updateInspector, "function");
  assert.equal(typeof audio.getInspector, "function");
  assert.equal(typeof audio.updateInspector, "function");
});
