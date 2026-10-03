import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_CANARY_AUTHORITY,
  ASSET_CANARY_OUTCOME,
  assetCanarySelected,
  createAssetAuthorityCanary
} from "../src/asset-authority-canary.js";

function entity(name = "entity") {
  return {
    name,
    children: [],
    destroyed: false,
    destroy() { this.destroyed = true; }
  };
}

function asset(name = "asset") {
  return { resource: { instantiateRenderEntity: () => entity(name) }, unload() {} };
}

function selectedKey(percent = 25) {
  for (let index = 0; index < 100000; index += 1) {
    const key = `subject-${index}`;
    if (assetCanarySelected(key, percent)) return key;
  }
  throw new Error("fixture cohort key not found");
}

const app = () => ({ assets: { loadFromUrl() {}, remove() {} } });

test("canary percentages are limited to 0/1/5/25", () => {
  assert.equal(assetCanarySelected("control", 0), false);
  assert.throws(() => assetCanarySelected("x", 100), /E_ASSET_CANARY_PERCENTAGE/);
});

test("control cohort always keeps canonical authority", async () => {
  const shadow = {
    optimizedUrlFor: () => "/optimized.glb",
    observeResource: async () => { throw new Error("control must not preflight"); }
  };
  const canary = createAssetAuthorityCanary({ app: app(), shadow, enabled: true, percentage: 0 });
  const prepared = await canary.prepare("/canonical.glb", asset("canonical"), {
    subjectKey: "control",
    consumer: "test"
  });
  assert.equal(prepared.receipt.authority, ASSET_CANARY_AUTHORITY.CANONICAL);
  assert.equal(prepared.receipt.outcome, ASSET_CANARY_OUTCOME.CONTROL);
  assert.equal(prepared.activeEntity.name, "canonical");
});

test("selected cohort may use optimized authority only after MATCH preflight", async () => {
  const key = selectedKey();
  const shadow = {
    optimizedUrlFor: () => "/optimized.glb",
    observeResource: async () => ({ status: "MATCH" })
  };
  const canary = createAssetAuthorityCanary({
    app: app(),
    shadow,
    enabled: true,
    percentage: 25,
    optimizedLoader: async () => asset("optimized")
  });
  const prepared = await canary.prepare("/canonical.glb", asset("canonical"), {
    subjectKey: key,
    consumer: "test"
  });
  assert.equal(prepared.receipt.authority, ASSET_CANARY_AUTHORITY.OPTIMIZED_CANARY);
  assert.equal(prepared.receipt.outcome, ASSET_CANARY_OUTCOME.CANARY_ACTIVE);
  assert.equal(prepared.activeEntity.name, "optimized");
});

test("mismatch preflight fails closed to canonical", async () => {
  const key = selectedKey();
  const shadow = {
    optimizedUrlFor: () => "/optimized.glb",
    observeResource: async () => ({ status: "MISMATCH" })
  };
  const canary = createAssetAuthorityCanary({ app: app(), shadow, enabled: true, percentage: 25 });
  const prepared = await canary.prepare("/canonical.glb", asset("canonical"), {
    subjectKey: key,
    consumer: "test"
  });
  assert.equal(prepared.receipt.authority, ASSET_CANARY_AUTHORITY.CANONICAL);
  assert.equal(prepared.receipt.outcome, ASSET_CANARY_OUTCOME.ROLLED_BACK_PREFLIGHT);
  assert.equal(prepared.activeEntity.name, "canonical");
});

test("optimized load failure fails closed to canonical", async () => {
  const key = selectedKey();
  const shadow = {
    optimizedUrlFor: () => "/optimized.glb",
    observeResource: async () => ({ status: "MATCH" })
  };
  const canary = createAssetAuthorityCanary({
    app: app(),
    shadow,
    enabled: true,
    percentage: 25,
    optimizedLoader: async () => { throw new Error("synthetic load failure"); }
  });
  const prepared = await canary.prepare("/canonical.glb", asset("canonical"), {
    subjectKey: key,
    consumer: "test"
  });
  assert.equal(prepared.receipt.authority, ASSET_CANARY_AUTHORITY.CANONICAL);
  assert.equal(prepared.receipt.outcome, ASSET_CANARY_OUTCOME.ROLLED_BACK_LOAD_FAILURE);
  assert.match(prepared.receipt.reason, /synthetic load failure/);
});

test("manual rollback destroys optimized canary and restores canonical authority", async () => {
  const key = selectedKey();
  const shadow = {
    optimizedUrlFor: () => "/optimized.glb",
    observeResource: async () => ({ status: "MATCH" })
  };
  const canary = createAssetAuthorityCanary({
    app: app(),
    shadow,
    enabled: true,
    percentage: 25,
    optimizedLoader: async () => asset("optimized")
  });
  const prepared = await canary.prepare("/canonical.glb", asset("canonical"), {
    subjectKey: key,
    consumer: "test"
  });
  const optimized = prepared.optimizedEntity;
  const rollback = prepared.rollback("SYNTHETIC_CANARY_ABORT");
  assert.equal(optimized.destroyed, true);
  assert.equal(prepared.activeEntity.name, "canonical");
  assert.equal(rollback.authority, ASSET_CANARY_AUTHORITY.CANONICAL);
  assert.equal(rollback.outcome, ASSET_CANARY_OUTCOME.ROLLED_BACK_MANUAL);
  assert.equal(canary.status().counts.rolledBack, 1);
});
