import test from "node:test";
import assert from "node:assert/strict";
import { REPRESENTATIVE_ASSETS, runGltfTransformPoc } from "./gltf-transform-poc.mjs";

test("glTF Transform reads, transforms, writes and re-reads a representative world asset", async () => {
  const result = await runGltfTransformPoc(REPRESENTATIVE_ASSETS[0]);
  assert.ok(result.inputBytes > 0);
  assert.ok(result.outputBytes > 0);
  assert.equal(result.roundTripReadable, true);
  assert.equal(result.sceneCountPreserved, true);
  assert.equal(result.afterTransform.scenes, result.afterRoundTrip.scenes);
});
