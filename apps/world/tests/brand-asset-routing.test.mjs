import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const source = "https://inhagame-campus-p0-b9v6bcouy-aldol.vercel.app/assets/induck-v3.glb";

test("production routes both canonical and 100% canary Induck paths before the public fallback filesystem", () => {
  assert.deepEqual(config.routes, [
    { src: "/assets/induck-v3\\.glb", dest: source },
    { src: "/\\.generated/assets-optimized/induck-v3\\.glb", dest: source },
    { handle: "filesystem" }
  ]);
});

test("public repository keeps the brand binary excluded while runtime routing owns the production visual", () => {
  const provenance = JSON.parse(readFileSync(new URL("../../../ASSET_PROVENANCE.json", import.meta.url), "utf8"));
  const asset = provenance.assets.find(item => item.path === "apps/world/assets/induck-v3.glb");
  assert.ok(asset, "public fallback asset must remain provenance-tracked");
  assert.match(asset.provenance, /Independent axis-aligned QA box|Independent QA geometry/i);
});
