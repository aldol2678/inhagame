import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const smoke = await startSmoke({ viewport: { width: 512, height: 512 } });

function byUrl(status, url) {
  return status.entries.find(entry => entry.canonicalUrl === url);
}

try {
  const normal = await smoke.context.newPage();
  const normalFatal = smoke.watch(normal);
  await normal.goto(`${smoke.origin}/tests/browser/asset-optimization-shadow-harness.html`,
    { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await Promise.race([
    normal.waitForFunction(() => window.__ASSET_SHADOW_HARNESS__?.ready !== undefined,
      null, { timeout: TIMEOUT_MS }),
    normalFatal
  ]);

  const normalState = await normal.evaluate(() => window.__ASSET_SHADOW_HARNESS__);
  assert.equal(normalState.ready, true, normalState.error);
  assert.equal(normalState.renderer, "WebGL2");
  assert.deepEqual(normalState.canonicalAttached, {
    character: true,
    backpack: true,
    building: true
  });
  assert.equal(normalState.status.enabled, false);
  assert.deepEqual(normalState.status.counts, { match: 0, mismatch: 0, unavailable: 0 });
  await normal.close();

  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/tests/browser/asset-optimization-shadow-harness.html?shadow=1`,
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
  assert.deepEqual(state.canonicalAttached, {
    character: true,
    backpack: true,
    building: true
  }, "all canonical assets remain the actual scene consumers");

  assert.equal(state.status.enabled, true);
  assert.equal(state.status.advisoryOnly, true);
  assert.equal(state.status.authority, "CANONICAL_SOURCE_ONLY");
  assert.deepEqual(state.status.counts, { match: 3, mismatch: 0, unavailable: 0 });

  const duck = byUrl(state.status, "/assets/induck-v3.glb");
  const backpack = byUrl(state.status, "/assets/induck-backpack-v1.glb");
  const building = byUrl(state.status, "/assets/p0-qa-building.glb");

  assert.ok(duck, "character shadow record exists");
  assert.ok(backpack, "equipment shadow record exists");
  assert.ok(building, "runtime-adapter shadow record exists");

  for (const entry of [duck, backpack, building]) {
    assert.equal(entry.status, "MATCH");
    assert.equal(entry.reason, null);
    assert.equal(entry.canonical.renderComponents, entry.optimized.renderComponents);
    assert.equal(entry.canonical.meshInstances, entry.optimized.meshInstances);
    assert.equal(entry.canonical.materials, entry.optimized.materials);
  }

  assert.deepEqual(duck.consumers, ["character-harness"]);
  assert.deepEqual(backpack.consumers, ["equipment"]);
  assert.deepEqual(building.consumers, ["runtime-adapter"]);

  assert.equal(duck.optimizedUrl, "/.generated/assets-optimized/induck-v3.glb");
  assert.equal(backpack.optimizedUrl, "/.generated/assets-optimized/induck-backpack-v1.glb");
  assert.equal(building.optimizedUrl, "/.generated/assets-optimized/p0-qa-building.glb");

  assert.deepEqual(smoke.problems, []);
  console.log("asset optimization shadow consumers 3/3: PASS", JSON.stringify(state.status));
} finally {
  await smoke.close();
}
