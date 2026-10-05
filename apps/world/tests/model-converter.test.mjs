import test from "node:test";
import assert from "node:assert/strict";
import { convertFbxBuffer } from "../model-converter/convert-model.mjs";

test("model converter rejects empty and oversized FBX before spawning Blender", async () => {
  await assert.rejects(convertFbxBuffer(Buffer.alloc(0)), /E_MODEL_FILE_REQUIRED/);
  await assert.rejects(convertFbxBuffer(Buffer.alloc(25 * 1024 * 1024 + 1)), /E_MODEL_FILE_TOO_LARGE/);
});
