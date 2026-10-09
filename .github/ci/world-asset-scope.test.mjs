import test from "node:test";
import assert from "node:assert/strict";
import { classifyWorldAssetPaths } from "./world-asset-scope.mjs";

test("graphics-only change stays in graphics lane", () => {
  assert.deepEqual(classifyWorldAssetPaths(["apps/world/src/graphics-presets.js"]),
    { optimizer: false, graphics: true, canary: false });
});

test("canary-only API change stays in canary lane", () => {
  assert.deepEqual(classifyWorldAssetPaths(["apps/world/api/asset-canary-flag.js"]),
    { optimizer: false, graphics: false, canary: true });
});

test("optimizer inputs also exercise canary consumption", () => {
  assert.deepEqual(classifyWorldAssetPaths(["tools/world-assets/optimize-world-assets.mjs"]),
    { optimizer: true, graphics: false, canary: true });
  assert.deepEqual(classifyWorldAssetPaths(["apps/world/src/character-model.js"]),
    { optimizer: true, graphics: false, canary: true });
});

test("shared browser harness changes run every lane", () => {
  assert.deepEqual(classifyWorldAssetPaths(["apps/world/tests/browser/harness.mjs"]),
    { optimizer: true, graphics: true, canary: true });
});

test("mixed changes union their required lanes", () => {
  assert.deepEqual(classifyWorldAssetPaths([
    "apps/world/src/graphics-presets.js",
    "apps/world/src/asset-canary-telemetry.js"
  ]), { optimizer: false, graphics: true, canary: true });
});

test("workflow and classifier changes run full verification", () => {
  for (const path of [
    ".github/workflows/world-asset-optimizer.yml",
    ".github/ci/world-asset-scope.mjs",
    ".github/ci/world-asset-scope.test.mjs"
  ]) {
    assert.deepEqual(classifyWorldAssetPaths([path]),
      { optimizer: true, graphics: true, canary: true });
  }
});

test("unknown paths fail open rather than silently skipping QA", () => {
  assert.deepEqual(classifyWorldAssetPaths(["future/new-trigger.file"]),
    { optimizer: true, graphics: true, canary: true });
});
