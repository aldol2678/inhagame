import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const assets = [
  "induck-v3.glb",
  "annyongi-flight-v1.glb",
  "induck-cap-v1.glb",
  "induck-backpack-v1.glb",
  "induck-hoodie-v1.glb"
];
const proxy = (asset, variant = null) =>
  `/api/brand-asset?asset=${asset}${variant ? `&variant=${variant}` : ""}`;

test("production routes canonical and optimized variants for every runtime brand GLB", () => {
  const expected = [];
  for (const asset of assets) {
    const escaped = asset.replaceAll(".", "\\.");
    expected.push({ src: `/assets/${escaped}`, dest: proxy(asset) });
    expected.push({
      src: `/\\.generated/assets-optimized/${escaped}`,
      dest: proxy(asset, "optimized")
    });
  }
  expected.push({
    src: "/assets/audio/biryong-tower-01\\.mp3",
    dest: "/api/brand-media?asset=biryong-tower-01.mp3"
  });
  expected.push({ handle: "filesystem" });
  const brandRoutes = config.routes.filter(route =>
    route.handle === "filesystem" ||
    String(route.dest || "").startsWith("/api/brand-asset") ||
    String(route.dest || "").startsWith("/api/brand-media")
  );
  assert.deepEqual(brandRoutes, expected);
});

test("WorldForge editor route precedes the filesystem fallback", () => {
  const worldforge = config.routes.find(route => route.src === "/worldforge/?");
  assert.deepEqual(worldforge, { src: "/worldforge/?", dest: "/studio/index.html" });

  const worldforgeIndex = config.routes.indexOf(worldforge);
  const filesystemIndex = config.routes.findIndex(route => route.handle === "filesystem");
  assert.ok(worldforgeIndex >= 0 && filesystemIndex > worldforgeIndex);

  const serverSource = readFileSync(new URL("../dev-server.mjs", import.meta.url), "utf8");
  assert.match(serverSource, /reqPath === "\\/worldforge"/);
  assert.match(serverSource, /reqPath = "\\/studio\\/index\\.html"/);
});

test("public repository retains QA provenance for restored runtime brand paths", () => {
  const provenance = JSON.parse(readFileSync(new URL("../../../ASSET_PROVENANCE.json", import.meta.url), "utf8"));
  for (const name of assets) {
    const asset = provenance.assets.find(item => item.path === `apps/world/assets/${name}`);
    assert.ok(asset, name);
    assert.match(asset.provenance, /Independent axis-aligned QA box|Independent QA geometry/i, name);
  }
});

test("brand proxy admits five runtime ids and has separate canonical/optimized upstreams", () => {
  const source = readFileSync(new URL("../api/brand-asset.js", import.meta.url), "utf8");
  for (const name of assets) assert.match(source, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(source, /inhagame-world-brand-assets-v1/);
  assert.match(source, /inhagame-world-brand-assets-optimized-v1/);
  assert.match(source, /variant === 'optimized'/);
  assert.match(source, /X-INHAGAME-Brand-Variant/);
  assert.match(source, /model\/gltf-binary/);
});

test("optimized edge function pins glTF Transform and preserves character pivots", () => {
  const source = readFileSync(
    new URL("../../../supabase/functions/inhagame-world-brand-assets-optimized-v1/index.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /esm\.sh\/@gltf-transform\/core@4\.5\.1/);
  assert.match(source, /esm\.sh\/@gltf-transform\/functions@4\.5\.1/);
  assert.match(source, /exports=dedup,prune/);
  assert.doesNotMatch(source, /from ["']npm:@gltf-transform\/functions/);
  assert.doesNotMatch(source, /sharp/);
  assert.match(source, /prune\(\{ keepLeaves: true \}\)/);
  for (const pivot of ["DuckWing_L","DuckWing_R","DuckLeg_L","DuckLeg_R","DragonWing_L","DragonWing_R"]) {
    assert.match(source, new RegExp(pivot));
  }
  assert.match(source, /output\.byteLength < source\.byteLength/);
});
