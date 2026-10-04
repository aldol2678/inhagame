import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 512, height: 512 } });
const urls = [
  "/assets/induck-v3.glb",
  "/assets/annyongi-flight-v1.glb",
  "/assets/induck-cap-v1.glb",
  "/assets/induck-backpack-v1.glb",
  "/assets/induck-hoodie-v1.glb",
  "/assets/p0-qa-building.glb"
];

const attached = {
  duck: true,
  dragon: true,
  cap: true,
  backpack: true,
  hoodie: true,
  building: true
};

const byUrl = (status, url) => status.entries.find(entry => entry.canonicalUrl === url);

try {
  const normal = await smoke.context.newPage();
  const normalFatal = smoke.watch(normal);
  await normal.goto(smoke.origin + "/tests/browser/asset-optimization-shadow-harness.html",
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    normal.waitForFunction(() => window.__ASSET_SHADOW_HARNESS__?.ready !== undefined,
      null, { timeout: TIMEOUT_MS }),
    normalFatal
  ]);
  const normalState = await normal.evaluate(() => window.__ASSET_SHADOW_HARNESS__);
  assert.equal(normalState.ready, true, normalState.error);
  assert.equal(normalState.renderer, "WebGL2");
  assert.deepEqual(normalState.canonicalAttached, attached);
  assert.deepEqual(normalState.semanticPivots, { duck: true, dragon: true });
  assert.equal(normalState.status.enabled, false);
  assert.deepEqual(normalState.status.counts, { match: 0, mismatch: 0, unavailable: 0 });
  await normal.close();

  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(smoke.origin + "/tests/browser/asset-optimization-shadow-harness.html?shadow=1",
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    page.waitForFunction(() => {
      const state = window.__ASSET_SHADOW_HARNESS__;
      return state?.ready !== undefined && state.status?.pending === 0;
    }, null, { timeout: TIMEOUT_MS }),
    fatal
  ]);

  const state = await page.evaluate(() => window.__ASSET_SHADOW_HARNESS__);
  assert.equal(state.ready, true, state.error);
  assert.equal(state.renderer, "WebGL2");
  assert.deepEqual(state.canonicalAttached, attached);
  assert.deepEqual(state.semanticPivots, { duck: true, dragon: true });
  assert.equal(state.status.enabled, true);
  assert.equal(state.status.advisoryOnly, true);
  assert.equal(state.status.authority, "CANONICAL_SOURCE_ONLY");
  assert.deepEqual(state.status.counts, { match: 6, mismatch: 0, unavailable: 0 });

  const entries = urls.map(url => byUrl(state.status, url));
  assert.ok(entries.every(Boolean), "all six shadow records exist");
  for (const entry of entries) {
    assert.equal(entry.status, "MATCH");
    assert.equal(entry.reason, null);
    assert.equal(entry.canonical.renderComponents, entry.optimized.renderComponents);
    assert.equal(entry.canonical.meshInstances, entry.optimized.meshInstances);
    assert.equal(entry.canonical.materials, entry.optimized.materials);
  }

  assert.equal(byUrl(state.status, urls[0]).canonical.entities,
    byUrl(state.status, urls[0]).optimized.entities, "duck semantic nodes survive");
  assert.equal(byUrl(state.status, urls[1]).canonical.entities,
    byUrl(state.status, urls[1]).optimized.entities, "dragon semantic nodes survive");
  assert.deepEqual(byUrl(state.status, urls[0]).consumers, ["character-duck-harness"]);
  assert.deepEqual(byUrl(state.status, urls[1]).consumers, ["character-flight-harness"]);
  for (const url of urls.slice(2, 5)) assert.deepEqual(byUrl(state.status, url).consumers, ["equipment"]);
  assert.deepEqual(byUrl(state.status, urls[5]).consumers, ["runtime-adapter"]);

  for (const url of urls) {
    const name = url.split("/").at(-1);
    assert.equal(byUrl(state.status, url).optimizedUrl, "/.generated/assets-optimized/" + name);
  }

  assert.deepEqual(smoke.problems, []);
  console.log("asset optimization shadow consumers 6/6: PASS", JSON.stringify(state.status));
} finally {
  await smoke.close();
}
