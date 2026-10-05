import test from "node:test";
import assert from "node:assert/strict";
import { AssetResolver } from "../src/runtime-adapter/asset-resolver.js";
import {
  createEditorAssetResolver,
  editorAssetUri,
  importEditorModel,
  revokeEditorAssetUrls
} from "../src/editor/editor-model-import.js";

function namedBlob(name, bytes, type = "application/octet-stream") {
  const blob = new Blob([bytes], { type });
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

function glbBytes() {
  const bytes = new Uint8Array(20);
  bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0]);
  return bytes;
}

function store() {
  const records = new Map();
  return {
    records,
    async writeAsset(worldId, assetId, record) { records.set(`${worldId}::${assetId}`, record); },
    async readAsset(worldId, assetId) { return records.get(`${worldId}::${assetId}`) ?? null; }
  };
}

test("editor model import stores GLB in browser-local asset storage", async () => {
  const db = store();
  const result = await importEditorModel({
    file: namedBlob("student.glb", glbBytes(), "model/gltf-binary"),
    worldId: "world.test",
    assetId: "asset.model.001",
    store: db
  });
  assert.equal(result.uri, editorAssetUri("asset.model.001"));
  assert.equal(result.sourceFormat, "glb");
  assert.equal(db.records.get("world.test::asset.model.001").blob.size, 20);
});

test("FBX import sends raw source to converter and stores returned GLB", async () => {
  const db = store();
  let request = null;
  const result = await importEditorModel({
    file: namedBlob("student.fbx", new Uint8Array([1, 2, 3])),
    worldId: "world.test",
    assetId: "asset.model.002",
    store: db,
    fetcher: async (url, init) => {
      request = { url, init };
      return new Response(new Blob([glbBytes()], { type: "model/gltf-binary" }), { status: 200 });
    }
  });
  assert.equal(result.sourceFormat, "fbx");
  assert.match(request.url, /^\/api\/model-convert\?filename=student\.fbx$/);
  assert.equal(request.init.headers["X-Model-Filename"], "student.fbx");
  assert.equal(db.records.get("world.test::asset.model.002").sourceFormat, "fbx");
});

test("async editor URI resolution still deduplicates AssetResolver loads", async () => {
  const db = store();
  await db.writeAsset("world.test", "asset.model.001", {
    blob: new Blob([glbBytes()], { type: "model/gltf-binary" })
  });
  const objectUrls = new Set();
  const resolveAssetUri = createEditorAssetResolver({ store: db, worldId: "world.test", objectUrls });
  const calls = [];
  const resolver = new AssetResolver([
    { id: "asset.model.001", type: "model", uri: editorAssetUri("asset.model.001") }
  ], {
    resolveAssetUri,
    loadAsset: async uri => { calls.push(uri); return { uri }; }
  });
  const [a, b] = await Promise.all([resolver.resolve("asset.model.001"), resolver.resolve("asset.model.001")]);
  assert.equal(a.uri, b.uri);
  assert.equal(calls.length, 1);
  revokeEditorAssetUrls(objectUrls);
});
