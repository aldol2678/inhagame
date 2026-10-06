import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorld } from "../src/editor/world-document.js";
import { validateWorld } from "../src/editor/world-schema.js";
import {
  WORLD_ASSET_IDS,
  WORLD_ASSET_REGISTRY,
  getWorldAssetRecord,
  resolveWorldAssetRecord,
  worldAssetRegistrySnapshot
} from "../src/assets/world-asset-registry.js";

test("AF-09 registry records are compatible with the existing World Schema assets[] contract", () => {
  const world = createEmptyWorld({ worldId: "world.af09.registry", name: "AF-09 Registry Contract" });
  world.assets = worldAssetRegistrySnapshot();
  const result = validateWorld(world);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.every(item => item.code === "W_ASSET_UNUSED"));
});

test("AF-09 registry owns identity, provenance, rights and QA for accepted R2 assets", () => {
  assert.equal(WORLD_ASSET_REGISTRY.length, 3);
  assert.equal(new Set(WORLD_ASSET_REGISTRY.map(asset => asset.id)).size, 3);
  for (const id of Object.values(WORLD_ASSET_IDS)) {
    const asset = getWorldAssetRecord(id);
    assert.ok(asset);
    assert.equal(asset.type, "audio");
    assert.equal(asset.metadata.provenance.originType, "ai-generated");
    assert.equal(asset.metadata.rights.status, "verified");
    assert.equal(asset.metadata.rights.commercialUse, true);
    assert.equal(asset.metadata.qa.status, "owner-accepted");
    assert.equal(asset.metadata.qa.intelligibleSpeechObserved, false);
    assert.equal(asset.metadata.technical.loop, true);
  }
});

test("AF-09 resolver fails closed when type/rights/QA gates do not match", () => {
  const id = WORLD_ASSET_IDS.INKYUNG_WATER_SHORE;
  assert.ok(resolveWorldAssetRecord(id, {
    type: "audio", requireVerifiedRights: true, requireOwnerAcceptedQa: true
  }));
  assert.equal(resolveWorldAssetRecord(id, { type: "model" }), null);
  assert.equal(resolveWorldAssetRecord("asset.missing"), null);
});
