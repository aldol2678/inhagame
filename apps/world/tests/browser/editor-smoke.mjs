// World Editor browser smoke (P0 merge gate). The Editor page, its Runtime Preview and the opt-in
// `/campus/?editorWorld=1` overlay load their PlayCanvas code in the browser only (the overlay via a
// dynamic import), so neither the Node suites nor boot-smoke.mjs execute them. One headless run:
//
//   1. /editor/ boots, imports the committed P0_BLOCK_01 world.json through the file input, saves the
//      project (checked by reading IndexedDB directly) and reopens it after a reload: 6 entities.
//   2. Runtime Preview reaches `ready · 6 entities` with 0 diagnostics; five close/open cycles leave
//      event listeners and DOM nodes flat.
//   3. Gizmo drag: Ctrl/Cmd+Z during an active drag neither cancels the drag nor undoes an earlier
//      edit; the drag commits on pointerup and Undo then reverts exactly that drag.
//   4. /campus/?editorWorld=1 overlays the saved world (ready, 6 entities, 0 diagnostics) under the
//      campus coordinate frame while the normal World still boots and the player moves.
//
// Any page error, console error or failed same-origin request fails the run. Offline, see harness.mjs.
//
//   node apps/world/tests/browser/editor-smoke.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const fixturePath = fileURLToPath(new URL("../../src/editor/fixtures/p0-block-01.world.json", import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const ENTITIES = fixture.entities.length;
const PREVIEW_CYCLES = 5;

const started = Date.now();
const smoke = await startSmoke({ viewport: { width: 1440, height: 900 } });
const race = (fatalError, promise) => Promise.race([promise, fatalError]);

try {
  // ---- 1. Editor boot, import, save, reopen ----
  const page = await smoke.context.newPage();
  const fatalError = smoke.watch(page);
  const initialStatus = "프로젝트 저장소 연결 중…";
  const editorReady = () => race(fatalError, page.waitForFunction(initial =>
    (document.getElementById("editor-file-status")?.textContent ?? initial) !== initial, initialStatus, { timeout: TIMEOUT_MS }));
  const entityCount = count => race(fatalError, page.waitForFunction(expected =>
    document.getElementById("editor-entity-count")?.textContent === `${expected} entities`, count, { timeout: 15_000 }));

  await page.goto(`${smoke.origin}/editor/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await editorReady();
  await page.locator("#editor-file-input").setInputFiles(fixturePath);
  await entityCount(ENTITIES);
  await page.locator("#editor-save").click();
  // Saved = the canonical store holds this world and names it the last project (raw IndexedDB read,
  // independent of the Editor's own store module).
  const savedWorldId = () => page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open("inha-world-editor-v1");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("settings")) { db.close(); resolve(null); return; }
      const get = db.transaction("settings").objectStore("settings").get("lastWorldId");
      get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }));
  let saved = null;
  for (let i = 0; i < 100 && saved !== fixture.worldId; i++) {
    saved = await race(fatalError, savedWorldId());
    if (saved !== fixture.worldId) await page.waitForTimeout(100);
  }
  assert.equal(saved, fixture.worldId, "Save Project stored the imported world as the last project");
  await page.reload({ waitUntil: "domcontentloaded" });
  await editorReady();
  await entityCount(ENTITIES);

  // ---- 2. Runtime Preview through the shared Runtime Adapter ----
  const toggle = page.locator("#editor-preview-toggle");
  const cdp = await smoke.context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const values = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    return { listeners: values.JSEventListeners, nodes: values.Nodes };
  };
  const cycle = async () => {
    // Opening sets a "preparing" status synchronously in the Editor's click handler; a listener added
    // after it records that text. The Editor catches a failed Preview (for example a broken import of
    // the Preview or the adapter) and shows it in the status with the toggle still unpressed, so that
    // end state fails at once with the Editor's own message instead of timing out.
    await page.evaluate(() => document.getElementById("editor-preview-toggle").addEventListener("click", () => {
      window.__editorSmokePreparing = document.getElementById("editor-preview-status")?.textContent ?? "";
    }, { once: true }));
    await toggle.click();
    const outcome = await race(fatalError, page.waitForFunction(() => {
      const text = document.getElementById("editor-preview-status")?.textContent ?? "";
      const pressed = document.getElementById("editor-preview-toggle")?.getAttribute("aria-pressed") === "true";
      const report = /^\S+ · \d+ entities · /.test(text);
      if (pressed && report) return { ok: true };
      if (!pressed && !report && text && text !== window.__editorSmokePreparing) return { ok: false, text };
      return null;
    }, null, { timeout: TIMEOUT_MS }).then(handle => handle.jsonValue()));
    assert.ok(outcome.ok, `Runtime Preview failed to open: ${outcome.text}`);
    const text = (await page.locator("#editor-preview-status").textContent()).trim();
    const canvas = await page.locator("#editor-preview-canvas").evaluate(c => [c.width, c.height]);
    await toggle.click();
    await race(fatalError, page.waitForFunction(() => document.getElementById("editor-runtime-preview")?.hidden === true, null, { timeout: 15_000 }));
    return { text, canvas };
  };
  const first = await cycle();
  const [, state, count] = first.text.match(/^(\S+) · (\d+) entities · /) ?? [];
  const diagnostics = Number(first.text.match(/(\d+)\D*$/)?.[1]);
  assert.equal(state, "ready", `Runtime Preview state (${first.text})`);
  assert.equal(Number(count), ENTITIES, `Runtime Preview entities (${first.text})`);
  assert.equal(diagnostics, 0, `Runtime Preview diagnostics (${first.text})`);
  assert.ok(first.canvas[0] > 0 && first.canvas[1] > 0, "Runtime Preview canvas has a drawing buffer");
  const afterFirst = await metrics();
  let last = first;
  for (let i = 1; i < PREVIEW_CYCLES; i++) last = await cycle();
  const afterLast = await metrics();
  assert.equal(last.text, first.text, "every Preview cycle reaches the same runtime state");
  assert.ok(afterLast.listeners <= afterFirst.listeners, `Preview close/open keeps event listeners flat (${afterFirst.listeners} -> ${afterLast.listeners})`);
  assert.ok(afterLast.nodes <= afterFirst.nodes, `Preview close/open keeps DOM nodes flat (${afterFirst.nodes} -> ${afterLast.nodes})`);

  // ---- 3. Gizmo drag keeps keyboard shortcuts out of an active drag ----
  await page.locator(".editor-entity-row").first().click();
  const handle = page.locator('.editor-gizmo-handle[data-axis="x"]');
  await handle.waitFor({ timeout: 15_000 });
  const entityId = await page.locator(".editor-gizmo").getAttribute("data-entity-id");
  const marker = page.locator(`.editor-viewport-entity[data-entity-id="${entityId}"]`);
  const position = () => marker.evaluate(m => `${m.style.left},${m.style.top}`);
  const undo = page.locator("#editor-undo");
  const dragBy = async (dx, during = async () => {}) => {
    const box = await handle.boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await during();
    await page.mouse.up();
  };
  const original = await position();
  await dragBy(60);
  const firstDrag = await position();
  assert.notEqual(firstDrag, original, "gizmo drag moves the entity");
  assert.equal(await undo.isEnabled(), true, "a committed drag is undoable");
  let duringSecond;
  await dragBy(60, async () => {
    duringSecond = await position();
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await position(), duringSecond, "Ctrl/Cmd+Z during a drag leaves the drag in place");
    assert.equal(await page.locator("#editor-viewport").getAttribute("data-dragging"), "true", "the drag is still active");
  });
  const secondDrag = await position();
  assert.equal(secondDrag, duringSecond, "the second drag commits on pointerup");
  assert.notEqual(secondDrag, firstDrag, "the second drag moved the entity");
  await undo.click();
  assert.equal(await position(), firstDrag, "Undo reverts exactly the last drag");
  await page.close();

  // ---- 4. Saved world in the real campus runtime (opt-in overlay) ----
  let overlay = { editorWorld: { state: 'not run (GPU-less CI)', entities: 0 } };
  if (process.env.WORLD_SMOKE_DISABLE_WEBGPU !== '1') {
  const campus = await smoke.context.newPage();
  const campusFatal = smoke.watch(campus);
  await campus.goto(`${smoke.origin}/campus/?editorWorld=1`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await race(campusFatal, campus.waitForFunction(() => {
    const status = window.__INHAGAME_P0__?.getStatus?.();
    return status?.renderer === "UNAVAILABLE" ||
      (status?.loading?.finished === true && status.editorWorld && status.editorWorld.state !== "loading");
  }, null, { timeout: TIMEOUT_MS, polling: 100 }));
  overlay = await campus.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const status = d.getStatus();
    const roots = d.app.root.find(node => node.name?.startsWith?.("WorldDocument:"));
    return {
      renderer: status.renderer, loading: status.loading?.phase, editorWorld: status.editorWorld,
      roots: roots.map(root => ({ name: root.name, parent: root.parent?.name, children: root.children.length }))
    };
  });
  assert.equal(overlay.renderer, "WebGPU", "campus renderer");
  assert.equal(overlay.loading, "READY", "campus loading reached READY");
  assert.equal(overlay.editorWorld.state, "ready", `saved Editor World state (${overlay.editorWorld.error ?? ""})`);
  assert.equal(overlay.editorWorld.worldId, fixture.worldId, "overlay loaded the saved world");
  assert.equal(overlay.editorWorld.entities, ENTITIES, "overlay entities");
  assert.deepEqual(overlay.editorWorld.diagnostics, [], "overlay diagnostics");
  assert.deepEqual(overlay.roots, [{ name: `WorldDocument:${fixture.worldId}`, parent: "CampusCoordinateFrame", children: ENTITIES }],
    "one WorldDocument root under the campus coordinate frame");
  const before = await campus.evaluate(() => { const p = window.__INHAGAME_P0__.player.getLocalPosition(); return [p.x, p.z]; });
  await campus.locator("#application").focus();
  await campus.keyboard.down("w");
  try {
    await race(campusFatal, campus.waitForFunction(([x, z]) => {
      const p = window.__INHAGAME_P0__.player.getLocalPosition();
      return Math.hypot(p.x - x, p.z - z) > 0.5;
    }, before, { timeout: 10_000 }));
  } finally {
    await campus.keyboard.up("w");
  }
  }

  assert.deepEqual(smoke.problems, [], "no page errors, console errors or failed same-origin requests");
  console.log(JSON.stringify({ preview: first.text, listeners: [afterFirst.listeners, afterLast.listeners], nodes: [afterFirst.nodes, afterLast.nodes],
    drag: { original, firstDrag, secondDrag }, overlay: overlay.editorWorld.state }, null, 2));
  console.log(`world editor smoke: PASS in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `(preview ${first.text}; ${PREVIEW_CYCLES} cycles; overlay ${overlay.editorWorld.state} · ${overlay.editorWorld.entities} entities)`);
} catch (error) {
  console.error("world editor smoke: FAIL");
  if (smoke.problems.length) console.error(smoke.problems.map(line => `  - ${line}`).join("\n"));
  throw error;
} finally {
  await smoke.close();
}
