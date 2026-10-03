import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const proxy = "/api/brand-induck";

test("production routes both canonical and 100% canary Induck paths before the public fallback filesystem", () => {
  assert.deepEqual(config.routes, [
    { src: "/assets/induck-v3\\.glb", dest: proxy },
    { src: "/\\.generated/assets-optimized/induck-v3\\.glb", dest: proxy },
    { handle: "filesystem" }
  ]);
});

test("public repository keeps the brand binary excluded while runtime routing owns the production visual", () => {
  const provenance = JSON.parse(readFileSync(new URL("../../../ASSET_PROVENANCE.json", import.meta.url), "utf8"));
  const asset = provenance.assets.find(item => item.path === "apps/world/assets/induck-v3.glb");
  assert.ok(asset, "public fallback asset must remain provenance-tracked");
  assert.match(asset.provenance, /Independent axis-aligned QA box|Independent QA geometry/i);
});


test("brand proxy stays server-side and uses only Production public Supabase env", () => {
  const source = readFileSync(new URL("../api/brand-induck.js", import.meta.url), "utf8");
  assert.match(source, /process\.env\.SUPABASE_URL/);
  assert.match(source, /process\.env\.SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /inhagame-induck-brand-v1/);
  assert.match(source, /model\/gltf-binary/);
  assert.doesNotMatch(source, /Induck_ClassicSilhouette_v3|round_white_body|sb_publishable_[A-Za-z0-9_-]{10,}/);
});
