import test from "node:test";
import assert from "node:assert/strict";

import { createStudioAssetRegistry } from "../src/studio/core/asset-registry.js";

test("StudioAssetRegistry federates module-owned assets without merging storage", () => {
  const registry = createStudioAssetRegistry();

  registry.replaceModuleAssets("world", [
    { id: "asset.tree", assetType: "model", label: "Tree", detail: "model · /tree.glb" },
    { id: "asset.road", assetType: "model", label: "Road", detail: "model · /road.glb" }
  ]);
  registry.replaceModuleAssets("audio", [
    { id: "music.campus", assetType: "audio", label: "Campus Theme", detail: "campus.wav · 1:00" }
  ]);

  const snapshot = registry.snapshot();
  assert.equal(snapshot.total, 3);
  assert.deepEqual(snapshot.indexedModules, ["audio", "world"]);
  assert.deepEqual(snapshot.counts, { audio: 1, model: 2 });

  assert.deepEqual(
    registry.list({ type: "audio" }).map(asset => asset.key),
    ["audio:music.campus"]
  );
  assert.equal(registry.list({ moduleId: "world" }).length, 2);
  assert.deepEqual(
    registry.list({ query: "road" }).map(asset => asset.key),
    ["world:asset.road"]
  );
  assert.equal(registry.get("world:asset.tree").moduleId, "world");
});

test("StudioAssetRegistry replaces one module index without erasing other modules", () => {
  const registry = createStudioAssetRegistry();
  registry.replaceModuleAssets("world", [
    { id: "asset.a", assetType: "model", label: "A" }
  ]);
  registry.replaceModuleAssets("audio", [
    { id: "music.a", assetType: "audio", label: "Audio A" }
  ]);

  registry.replaceModuleAssets("world", [
    { id: "asset.b", assetType: "model", label: "B" }
  ]);

  assert.equal(registry.get("world:asset.a"), null);
  assert.equal(registry.get("world:asset.b").label, "B");
  assert.equal(registry.get("audio:music.a").label, "Audio A");
  assert.equal(registry.hasIndexed("world"), true);
  assert.equal(registry.hasIndexed("audio"), true);
});
