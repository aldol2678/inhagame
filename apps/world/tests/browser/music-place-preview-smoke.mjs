// Music Editor P1.1c 3D Place Preview browser smoke.
// Isolated from the full Music Editor authoring smoke so slow GPU-less rendering is easy to diagnose.
import assert from "node:assert/strict";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const started = Date.now();
const smoke = await startSmoke({ viewport: { width: 1440, height: 900 } });
const race = (fatal, promise) => Promise.race([promise, fatal]);

try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  const initial = "프로젝트 저장소 연결 중…";

  await page.goto(`${smoke.origin}/editor/music/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await race(fatal, page.waitForFunction(text =>
    (document.getElementById("music-file-status")?.textContent ?? text) !== text,
  initial, { timeout: TIMEOUT_MS }));

  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-production-status")?.textContent ?? "").includes("Production loaded"),
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#music-production-clone").isEnabled(), true);
  assert.equal(await page.locator('#music-place-audition-source option[value="production"]').isEnabled(), true);
  assert.equal(await page.locator("#music-place-preview-select").inputValue(), "PLACE_BIRYONG_TOWER");
  await page.locator("#music-place-preview-toggle").click();

  await race(fatal, page.waitForFunction(() => {
    const state = document.getElementById("music-place-preview-state")?.textContent;
    return state === "ready" || state === "degraded";
  }, null, { timeout: 20_000 }));

  const state = await page.locator("#music-place-preview-state").textContent();
  const status = await page.locator("#music-place-preview-status").textContent();
  assert.equal(state, "ready", `place preview failed: ${status}`);
  assert.equal(await page.locator("#music-place-preview-shell").isVisible(), true);
  assert.match(status, /PLACE_BIRYONG_TOWER/);
  assert.match(status, /chunks/);

  const canvas = await page.locator("#music-place-preview-canvas").evaluate(node => [node.width, node.height]);
  assert.ok(canvas[0] > 0 && canvas[1] > 0, "place preview has a drawing buffer");

  await page.locator("#music-place-audition-source").selectOption("production");
  await page.locator("#music-place-audition").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-preview-context")?.textContent === "running" &&
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("Biryong Tower Explore"),
  null, { timeout: TIMEOUT_MS }));
  assert.match(await page.locator("#music-production-status").textContent(), /PRODUCTION/);
  assert.match(await page.locator("#music-preview-target").textContent(), /PLACE_BIRYONG_TOWER/);

  await page.locator("#music-production-clone").click();
  await race(fatal, page.waitForFunction(() =>
    (document.getElementById("music-project-name")?.value ?? "").includes("Draft") &&
    document.getElementById("music-asset-count")?.textContent === "1 assets" &&
    document.getElementById("music-cue-count")?.textContent === "1" &&
    document.getElementById("music-binding-count")?.textContent === "1",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#music-place-audition-source").inputValue(), "draft");

  await page.locator("#music-place-audition").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-preview-context")?.textContent === "running" &&
    (document.getElementById("music-preview-cue")?.textContent ?? "").includes("Biryong Tower Explore"),
  null, { timeout: TIMEOUT_MS }));
  assert.match(await page.locator("#music-production-status").textContent(), /DRAFT/);

  await page.locator("#music-place-preview-toggle").click();
  await race(fatal, page.waitForFunction(() =>
    document.getElementById("music-place-preview-state")?.textContent === "idle",
  null, { timeout: TIMEOUT_MS }));
  assert.equal(await page.locator("#music-place-preview-shell").isHidden(), true);

  assert.deepEqual(smoke.problems, [], "no page errors, console errors or failed same-origin requests");
  console.log(`music place preview smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error("music place preview smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  throw error;
} finally {
  await smoke.close();
}
