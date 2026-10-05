import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSET_OPTIMIZATION_SHADOW_STATUS,
  createAssetOptimizationShadow
} from "../src/asset-optimization-shadow.js";
import { createEquipmentModelLoader } from "../src/appearance/equipment-asset-loader.js";

function entity({ renders = 1, meshes = 1, materials = 1, children = 0 } = {}) {
  const mats = Array.from({ length: materials }, (_, index) => ({ index }));
  const renderComponents = Array.from({ length: renders }, (_, renderIndex) => ({
    meshInstances: Array.from({ length: meshes }, (_, meshIndex) => ({
      material: mats[(renderIndex + meshIndex) % mats.length]
    }))
  }));
  return {
    children: Array.from({ length: children }, () => ({ children: [] })),
    findComponents: kind => kind === "render" ? renderComponents : [],
    destroy() { this.destroyed = true; }
  };
}

function asset(shape) {
  return { resource: { instantiateRenderEntity: () => entity(shape) }, unload() {} };
}

test("shadow is inert while disabled", async () => {
  let loads = 0;
  const shadow = createAssetOptimizationShadow({
    app: { assets: { loadFromUrl: () => { loads += 1; } } },
    enabled: false
  });
  assert.equal(await shadow.observeResource("/assets/induck-v3.glb", asset({}), { consumer: "character" }), null);
  assert.equal(loads, 0);
  assert.deepEqual(shadow.status().counts, { match: 0, mismatch: 0, unavailable: 0 });
});

test("matching optimized resource is advisory-only and never becomes authority", async () => {
  const optimized = asset({ renders: 2, meshes: 2, materials: 1, children: 1 });
  const shadow = createAssetOptimizationShadow({
    app: { assets: { loadFromUrl: (_url, type, callback) => {
      assert.equal(type, "container");
      callback(null, optimized);
    }, remove() {} } },
    enabled: true
  });
  const result = await shadow.observeResource(
    "/assets/induck-v3.glb",
    asset({ renders: 2, meshes: 2, materials: 1, children: 4 }),
    { consumer: "character" }
  );
  assert.equal(result.status, ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH,
    "empty-node pruning may change entity count without changing render shape");
  const status = shadow.status();
  assert.equal(status.advisoryOnly, true);
  assert.equal(status.authority, "CANONICAL_SOURCE_ONLY");
  assert.deepEqual(status.entries[0].consumers, ["character"]);
});

test("shape mismatch is recorded without rejecting the canonical consumer", async () => {
  const shadow = createAssetOptimizationShadow({
    app: { assets: { loadFromUrl: (_url, _type, callback) => callback(null, asset({ renders: 2, meshes: 1 })) } },
    enabled: true
  });
  const result = await shadow.observeResource("/assets/induck-v3.glb", asset({ renders: 1, meshes: 1 }));
  assert.equal(result.status, ASSET_OPTIMIZATION_SHADOW_STATUS.MISMATCH);
});

test("optimized load failure becomes UNAVAILABLE and does not throw", async () => {
  const shadow = createAssetOptimizationShadow({
    app: { assets: { loadFromUrl: (_url, _type, callback) => callback(new Error("shadow missing")) } },
    enabled: true
  });
  const result = await shadow.observeResource("/assets/induck-v3.glb", asset({}));
  assert.equal(result.status, ASSET_OPTIMIZATION_SHADOW_STATUS.UNAVAILABLE);
  assert.match(result.reason, /shadow missing/);
});

test("equipment loader keeps canonical entity while scheduling shadow observation", async () => {
  const calls = [];
  const observed = [];
  const canonicalAsset = asset({ renders: 1, meshes: 1, materials: 1 });
  const app = { assets: { loadFromUrl: (url, type, callback) => {
    calls.push([url, type]);
    callback(null, canonicalAsset);
  } } };
  const load = createEquipmentModelLoader({
    app,
    assetShadow: { observeResource: (url, loaded, meta) => {
      observed.push([url, loaded, meta]);
      return Promise.resolve();
    } }
  });
  const model = await load("equipment.back.induck_backpack.v1");
  assert.equal(model.name, "Equipment_Model_equipment.back.induck_backpack.v1");
  assert.deepEqual(calls, [["/assets/induck-backpack-v1.glb", "container"]]);
  assert.equal(observed[0][0], "/assets/induck-backpack-v1.glb");
  assert.equal(observed[0][1], canonicalAsset);
  assert.deepEqual(observed[0][2], { consumer: "equipment" });
});

test("source integrations only observe after canonical load and keep canonical authority", () => {
  const character = readFileSync(new URL("../src/character-model.js", import.meta.url), "utf8");
  const context = readFileSync(new URL("../src/runtime-adapter/playcanvas-context.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(character, /assetShadow\?\.observeResource\?\.\(url, asset, \{ consumer: "character" \}\)/);
  assert.match(context, /assetShadow\?\.observeResource\?\.\(uri, asset, \{ consumer: "runtime-adapter" \}\)/);
  assert.match(main, /assetShadow: assetOptimizationShadow/);
  assert.match(main, /CANONICAL_SOURCE_ONLY|assetOptimizationShadow/);
});
