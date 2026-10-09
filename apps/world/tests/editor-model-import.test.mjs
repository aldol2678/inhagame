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

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_BYTES = 25 * 1024 * 1024;

function glbBytes(chunks = [{ type: JSON_CHUNK, data: new TextEncoder().encode('{"asset":{"version":"2.0"}} ') }]) {
  const bytes = new Uint8Array(12 + chunks.reduce((size, chunk) => size + 8 + chunk.data.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  let offset = 12;
  for (const { type, data } of chunks) {
    view.setUint32(offset, data.length, true);
    view.setUint32(offset + 4, type, true);
    bytes.set(data, offset + 8);
    offset += 8 + data.length;
  }
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
  assert.equal(db.records.get("world.test::asset.model.001").blob.size, glbBytes().length);
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

// These tests exercise importEditorModel itself; only network and persistence are replaced.
function importHarness(overrides = {}) {
  const calls = { fetch: 0, write: 0 };
  const options = {
    file: namedBlob("model.glb", glbBytes()), worldId: "world.test", assetId: "asset.test",
    store: { async writeAsset() { calls.write++; } },
    fetcher: async () => { calls.fetch++; return new Response(glbBytes()); },
    ...overrides
  };
  return { calls, options };
}

for (const assetId of ["bad/id", "bad id", "", null, undefined, 123, {}, ["asset.valid"], Symbol("asset")]) {
  for (const extension of ["glb", "fbx"]) {
    test(`invalid asset ID ${String(assetId)} rejects ${extension} before fetching or writing`, async () => {
      const { calls, options } = importHarness({ assetId, file: namedBlob(`model.${extension}`, glbBytes()) });
      await assert.rejects(importEditorModel(options), /E_(EDITOR_ASSET_ID_INVALID|MODEL_IMPORT_CONTEXT_REQUIRED)/);
      assert.deepEqual(calls, { fetch: 0, write: 0 });
    });
  }
}

for (const overrides of [{ worldId: " " }, { worldId: 1 }, { worldId: {} }, { store: {} }, { store: { writeAsset: true } }, { fetcher: null }]) {
  test(`invalid context rejects before FBX conversion: ${JSON.stringify(overrides)}`, async () => {
    const { calls, options } = importHarness({ file: namedBlob("model.fbx", [1]), ...overrides });
    await assert.rejects(importEditorModel(options), /E_MODEL_IMPORT_CONTEXT_REQUIRED/);
    assert.deepEqual(calls, { fetch: 0, write: 0 });
  });
}

function mutateGlb(offset, value) {
  const bytes = glbBytes();
  new DataView(bytes.buffer).setUint32(offset, value, true);
  return bytes;
}
const jsonChunk = { type: JSON_CHUNK, data: new TextEncoder().encode('{"asset":{"version":"2.0"}} ') };
const binChunk = { type: BIN_CHUNK, data: new Uint8Array(4) };
const unknownChunk = { type: 0x12345678, data: new Uint8Array(4) };
const malformed = [
  ["magic", mutateGlb(0, 0)], ["version", mutateGlb(4, 1)],
  ["declared short length", mutateGlb(8, 20)], ["declared long length", mutateGlb(8, 1000)],
  ["missing chunks", glbBytes([])], ["truncated chunk header", glbBytes().slice(0, 16)],
  ["truncated data", glbBytes().slice(0, -1)], ["chunk overflow", mutateGlb(12, 0xffffffff)],
  ["unaligned chunk", glbBytes([{ type: JSON_CHUNK, data: new TextEncoder().encode('{} ') }])],
  ["BIN before JSON", glbBytes([binChunk, jsonChunk])], ["duplicate JSON", glbBytes([jsonChunk, jsonChunk])],
  ["duplicate BIN", glbBytes([jsonChunk, binChunk, binChunk])],
  ["BIN after unknown", glbBytes([jsonChunk, unknownChunk, binChunk])],
  ["invalid JSON", glbBytes([{ type: JSON_CHUNK, data: new TextEncoder().encode('nope') }])],
  ["JSON primitive", glbBytes([{ type: JSON_CHUNK, data: new TextEncoder().encode('null') }])],
  ["JSON array", glbBytes([{ type: JSON_CHUNK, data: new TextEncoder().encode('[]  ') }])],
  ["invalid UTF8", glbBytes([{ type: JSON_CHUNK, data: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }])]
];
for (const [label, bytes] of malformed) {
  for (const extension of ["glb", "fbx"]) {
    test(`rejects ${label} in ${extension} before storage`, async () => {
      const { calls, options } = importHarness({ file: namedBlob(`model.${extension}`, bytes) });
      options.fetcher = async () => { calls.fetch++; return new Response(bytes); };
      await assert.rejects(importEditorModel(options), extension === "glb" ? /E_MODEL_GLB_INVALID/ : /E_MODEL_CONVERT_INVALID_GLB/);
      assert.equal(calls.write, 0);
      assert.equal(calls.fetch, extension === "fbx" ? 1 : 0);
    });
  }
}

for (const chunks of [[jsonChunk], [jsonChunk, binChunk], [jsonChunk, unknownChunk], [jsonChunk, binChunk, unknownChunk, unknownChunk]]) {
  test(`accepts valid GLB layout with ${chunks.length} chunks, including unknown extensions`, async () => {
    const db = store();
    const bytes = glbBytes(chunks);
    const { options } = importHarness({ file: namedBlob("model.glb", bytes), store: db });
    const result = await importEditorModel(options);
    const saved = db.records.get("world.test::asset.test");
    assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), bytes);
    assert.equal(saved.mimeType, "model/gltf-binary");
    assert.equal(result.size, bytes.length);
  });
}

test("rejects oversized converted GLB without storing it", async () => {
  const { calls, options } = importHarness({ file: namedBlob("model.fbx", [1]) });
  options.fetcher = async () => { calls.fetch++; return new Response(new Blob([glbBytes(), new Uint8Array(MAX_BYTES)])); };
  await assert.rejects(importEditorModel(options), /E_MODEL_CONVERT_TOO_LARGE/);
  assert.deepEqual(calls, { fetch: 1, write: 0 });
});

test("rejects oversized input before conversion", async () => {
  const { calls, options } = importHarness({ file: namedBlob("model.fbx", new Uint8Array(MAX_BYTES + 1)) });
  await assert.rejects(importEditorModel(options), /E_MODEL_FILE_TOO_LARGE/);
  assert.deepEqual(calls, { fetch: 0, write: 0 });
});

for (const response of [new Response('{"error":"CONVERSION_REJECTED"}', { status: 422 }), new Response("bad gateway", { status: 502 })]) {
  test(`conversion failure ${response.status} does not write storage`, async () => {
    const { calls, options } = importHarness({ file: namedBlob("model.fbx", [1]) });
    options.fetcher = async () => { calls.fetch++; return response; };
    await assert.rejects(importEditorModel(options), /CONVERSION_REJECTED|E_MODEL_CONVERT_FAILED:502/);
    assert.deepEqual(calls, { fetch: 1, write: 0 });
  });
}

test("network rejection does not write storage", async () => {
  const { calls, options } = importHarness({ file: namedBlob("model.fbx", [1]) });
  options.fetcher = async () => { calls.fetch++; throw new Error("network offline"); };
  await assert.rejects(importEditorModel(options), /network offline/);
  assert.deepEqual(calls, { fetch: 1, write: 0 });
});

for (const name of [42, {}, ""]) {
  test(`invalid file name ${String(name)} has a stable error without side effects`, async () => {
    const { calls, options } = importHarness({ file: namedBlob(name, glbBytes()) });
    await assert.rejects(importEditorModel(options), /E_MODEL_FILE_REQUIRED/);
    assert.deepEqual(calls, { fetch: 0, write: 0 });
  });
}

test("resolver rejects corrupt stored GLB, clears pending, and permits a repaired record", async () => {
  const db = store();
  const id = "asset.test";
  await db.writeAsset("world.test", id, { blob: new Blob([mutateGlb(4, 1)]) });
  const objectUrls = new Set();
  const resolve = createEditorAssetResolver({ store: db, worldId: "world.test", objectUrls });
  const asset = { id, uri: editorAssetUri(id) };
  await assert.rejects(resolve(asset), /R_EDITOR_ASSET_INVALID:asset.test/);
  assert.equal(objectUrls.size, 0);
  await db.writeAsset("world.test", id, { blob: new Blob([glbBytes()]) });
  const url = await resolve(asset);
  assert.match(url, /^blob:/);
  assert.equal(objectUrls.size, 1);
  assert.equal(await resolve(asset), url);
  revokeEditorAssetUrls(objectUrls);
  assert.equal(objectUrls.size, 0);
});

test("allows converted GLB exactly at the size limit", async () => {
  const bytes = glbBytes([jsonChunk, { type: BIN_CHUNK, data: new Uint8Array(MAX_BYTES - glbBytes().length - 8) }]);
  const { calls, options } = importHarness({ file: namedBlob("model.fbx", [1]) });
  options.fetcher = async () => { calls.fetch++; return new Response(bytes); };
  const result = await importEditorModel(options);
  assert.equal(result.size, MAX_BYTES);
  assert.deepEqual(calls, { fetch: 1, write: 1 });
});
