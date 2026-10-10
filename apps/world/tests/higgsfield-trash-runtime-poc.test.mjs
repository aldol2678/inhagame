import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const assetUrl = new URL("../assets/higgsfield-trash-bin-poc.glb", import.meta.url);
const moduleUrl = new URL("../src/higgsfield-trash-runtime-poc.js", import.meta.url);
const mainUrl = new URL("../src/main.js", import.meta.url);

test("Higgsfield trash POC keeps the verified rev2 GLB byte-for-byte", async () => {
  const bytes = await readFile(assetUrl);
  assert.equal((await stat(assetUrl)).size, 58044);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "23c28e95704e43548fed9afaefe90ca95f7667dec48c5955bf0682300dbd6008");
});

test("Higgsfield trash POC is local/preview opt-in and preserves production by default", async () => {
  const [moduleSource, mainSource] = await Promise.all([
    readFile(moduleUrl, "utf8"),
    readFile(mainUrl, "utf8")
  ]);
  assert.match(moduleSource, /projectId: "58e1c25d-4df7-48b2-ae6b-12a25b65f56e"/);
  assert.match(moduleSource, /revision: 2/);
  assert.match(moduleSource, /sourceTriangles: 720/);
  assert.match(moduleSource, /1 \/ METERS_PER_WORLD_UNIT/);
  assert.ok(moduleSource.includes('hostname.endsWith(".vercel.app")'));
  assert.match(moduleSource, /get\("assetPoc"\) === "higgsfield-trash"/);
  assert.match(mainSource, /previewHost && startupParams\.get\("assetPoc"\) === "higgsfield-trash"/);
  assert.match(mainSource, /import\("\.\/higgsfield-trash-runtime-poc\.js"\)/);
});
