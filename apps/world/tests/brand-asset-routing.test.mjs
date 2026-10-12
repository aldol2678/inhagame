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

test("production proxies brand assets including private Annyongi", () => {
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
  assert.ok(serverSource.includes('reqPath === "/worldforge"'));
  assert.ok(serverSource.includes('reqPath = "/studio/index.html"'));
});

test("public repository records per-asset provenance without mislabeling Annyongi as QA", () => {
  const provenance = JSON.parse(readFileSync(new URL("../../../ASSET_PROVENANCE.json", import.meta.url), "utf8"));
  for (const name of assets) {
    const asset = provenance.assets.find(item => item.path === `apps/world/assets/${name}`);
    assert.ok(asset, name);
    if (name === "annyongi-flight-v1.glb") {
      assert.match(asset.provenance, /official Annyongi mascot design/);
      assert.equal(asset.approvalStatus, 'design-review-pending');
    } else assert.match(asset.provenance, /Independent axis-aligned QA box|Independent QA geometry/i, name);
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

test("Annyongi source and optimized URLs use the existing private brand service", () => {
  for (const url of ['/assets/annyongi-flight-v1.glb', '/.generated/assets-optimized/annyongi-flight-v1.glb']) {
    const intercept=config.routes.find(r=>r.src && new RegExp('^'+r.src+'$').test(url));
    assert.ok(intercept,url);
    assert.ok(intercept.dest.startsWith('/api/brand-asset?asset=annyongi-flight-v1.glb'));
    assert.equal(intercept.dest.includes('variant=optimized'), url.startsWith('/.generated/'));
  }
  const build=readFileSync(new URL('../build-recast-shadow.sh',import.meta.url),'utf8');
  assert.match(build,/optimize-world-assets.mjs --strict/);
  assert.match(build,/check_characters.mjs/);
});


test("Annyongi alone receives a fixed upstream asset revision", async () => {
  const vm = await import('node:vm');
  const source=readFileSync(new URL('../api/brand-asset.js',import.meta.url),'utf8');
  const urls=[];
  const context={module:{exports:{}},process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}},URL,AbortSignal,Buffer,fetch:async url=>{urls.push(url);return {ok:true,headers:new Headers()};}};
  vm.runInNewContext(source,context);
  for(const asset of assets) for(const variant of ['canonical','optimized']) {
    const res={setHeader(){},status(code){assert.equal(code,200);return this;},end(){}};
    await context.module.exports({method:'HEAD',url:`/api/brand-asset?asset=${asset}&variant=${variant}&revision=untrusted`},res);
    const upstream=new URL(urls.at(-1));
    assert.equal(upstream.searchParams.get('asset'),asset);
    assert.equal(upstream.searchParams.get('revision'),asset==='annyongi-flight-v1.glb'?'5cc0bc54905da5b87314b81691c229bc583ad1980794239634008cd3f0d834fb':null);
  }
});
