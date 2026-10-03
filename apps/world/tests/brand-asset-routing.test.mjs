import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const proxy = asset => `/api/brand-asset?asset=${asset}`;

test("production routes all restored World brand GLBs before filesystem fallback", () => {
  assert.deepEqual(config.routes, [
    { src: "/assets/induck-v3\\.glb", dest: proxy("induck-v3.glb") },
    { src: "/\\.generated/assets-optimized/induck-v3\\.glb", dest: proxy("induck-v3.glb") },
    { src: "/assets/annyongi-flight-v1\\.glb", dest: proxy("annyongi-flight-v1.glb") },
    { src: "/assets/induck-cap-v1\\.glb", dest: proxy("induck-cap-v1.glb") },
    { src: "/assets/induck-backpack-v1\\.glb", dest: proxy("induck-backpack-v1.glb") },
    { src: "/\\.generated/assets-optimized/induck-backpack-v1\\.glb", dest: proxy("induck-backpack-v1.glb") },
    { src: "/assets/induck-hoodie-v1\\.glb", dest: proxy("induck-hoodie-v1.glb") },
    { handle: "filesystem" }
  ]);
});

test("public repository retains QA provenance for restored runtime brand paths", () => {
  const provenance = JSON.parse(readFileSync(new URL("../../../ASSET_PROVENANCE.json", import.meta.url), "utf8"));
  for (const name of [
    "induck-v3.glb",
    "annyongi-flight-v1.glb",
    "induck-cap-v1.glb",
    "induck-backpack-v1.glb",
    "induck-hoodie-v1.glb"
  ]) {
    const asset = provenance.assets.find(item => item.path === `apps/world/assets/${name}`);
    assert.ok(asset, name);
    assert.match(asset.provenance, /Independent axis-aligned QA box|Independent QA geometry/i, name);
  }
});

test("brand proxy only admits the five runtime asset ids", () => {
  const source = readFileSync(new URL("../api/brand-asset.js", import.meta.url), "utf8");
  for (const name of [
    "induck-v3.glb",
    "annyongi-flight-v1.glb",
    "induck-cap-v1.glb",
    "induck-backpack-v1.glb",
    "induck-hoodie-v1.glb"
  ]) assert.match(source, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(source, /inhagame-world-brand-assets-v1/);
  assert.match(source, /model\/gltf-binary/);
});
