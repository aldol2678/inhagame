import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetCanarySelected } from "../src/asset-authority-canary.js";
import {
  ASSET_PRODUCTION_CANARY_PERCENTAGE,
  ASSET_PRODUCTION_CANARY_SOURCE,
  getOrCreateAssetCanarySubjectKey,
  createProductionAssetCanary
} from "../src/asset-production-canary.js";

function selectedKey() {
  for (let index = 0; index < 1_000_000; index += 1) {
    const key = `prod-subject-${index}`;
    if (assetCanarySelected(key, ASSET_PRODUCTION_CANARY_PERCENTAGE)) return key;
  }
  throw new Error("selected production fixture key not found");
}

test("production optimized asset rollout is pinned to full cohort and one local-player asset", () => {
  assert.equal(ASSET_PRODUCTION_CANARY_PERCENTAGE, 100);
  assert.equal(ASSET_PRODUCTION_CANARY_SOURCE, "/assets/induck-v3.glb");
});

test("subject key is stable in storage and does not regenerate", () => {
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  };
  let calls = 0;
  const cryptoImpl = { randomUUID: () => {
    calls += 1;
    return "12345678-1234-4234-8234-123456789abc";
  } };
  const first = getOrCreateAssetCanarySubjectKey({ storage, cryptoImpl });
  const second = getOrCreateAssetCanarySubjectKey({ storage, cryptoImpl });
  assert.equal(first, "12345678-1234-4234-8234-123456789abc");
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("storage failure disables cohort identity instead of changing buckets", () => {
  const storage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); }
  };
  assert.equal(getOrCreateAssetCanarySubjectKey({
    storage,
    cryptoImpl: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" }
  }), null);
});

test("selected production controller is full-cohort, duck-only and marked production wired", () => {
  const key = selectedKey();
  const app = { assets: { loadFromUrl() {}, remove() {} } };
  const controller = createProductionAssetCanary({ app, enabled: true, subjectKeyOverride: key });
  assert.equal(controller.selected, true);
  assert.equal(controller.canary.enabled, true);
  assert.equal(controller.canary.percentage, 100);
  assert.equal(controller.shadow.optimizedUrlFor("/assets/induck-v3.glb"),
    "/.generated/assets-optimized/induck-v3.glb");
  assert.equal(controller.shadow.optimizedUrlFor("/assets/induck-backpack-v1.glb"), null);
  assert.equal(controller.status().authority.productionWired, true);
});

test("main wires production canary only into the local character and disables it on preview hosts", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const remote = readFileSync(new URL("../src/online/remote-avatar.js", import.meta.url), "utf8");
  assert.match(main, /createProductionAssetCanary\(\{[\s\S]*?enabled: !previewHost/);
  assert.match(main, /createCharacter\(app, player, \{[\s\S]*?assetCanary: assetProductionCanary\.canary,[\s\S]*?assetCanarySubjectKey: assetProductionCanary\.subjectKey/);
  assert.match(main, /__INHAGAME_ASSET_PRODUCTION_CANARY__/);
  assert.match(main, /assetProductionCanary:/);
  assert.match(remote, /createCharacter\(app, entity\);/);
  assert.doesNotMatch(remote, /assetCanary|asset-production-canary/);
});

test("main production wiring is remote-gated, polled and fail-closed", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /createAssetCanaryRemoteControl\(\)/);
  assert.match(main, /assetCanaryRemoteControl\.start\(\)/);
  assert.match(main, /assetCanaryRemoteState === FLAG_ENABLED/);
  assert.match(main, /assetCanaryRemoteControl\.subscribe\(next =>/);
  assert.match(main, /next === FLAG_ENABLED/);
  assert.match(main, /REMOTE_KILL_/);
  assert.match(main, /assetCanaryTelemetry\.selected\(\)/);
  assert.match(main, /assetCanaryTelemetry\.active\(\)/);
  assert.match(main, /assetCanaryTelemetry\.rollback\(\)/);
  assert.match(main, /assetCanaryTelemetry\.failure\(\)/);
  assert.match(main, /assetCanaryRemoteControl\.stop\(\)/);
});
