// Run against a running local server or a deployment. Requires Playwright + Chrome.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation (no runtime dependency).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BUILDINGS } from './src/basic-campus.js';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const base = process.env.POND_QA_URL || "http://127.0.0.1:4187";
const output = resolve(process.env.POND_QA_OUTPUT || "pond-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.POND_QA_BROWSER || "chrome",
  headless: process.env.POND_QA_HEADED !== "1",
  args: ["--enable-unsafe-webgpu"]
});
const report = { url: base, browser: browser.version(), results: [] };

// Read actual PlayCanvas buffers/transforms, not the geometry builder's return value.
function inspectPond() {
  const d = window.__INHAGAME_P0__;
  const entities = d.app.root.find(e => e.name === "lmk_inkyung_pond");
  const e = entities[0], mi = e?.render?.meshInstances[0];
  const positions = [], indices = [];
  mi?.mesh.getPositions(positions);
  mi?.mesh.getIndices(indices);
  const bounds = a => a && ({
    minX: a.center.x - a.halfExtents.x, maxX: a.center.x + a.halfExtents.x,
    minY: a.center.y - a.halfExtents.y, maxY: a.center.y + a.halfExtents.y,
    minZ: a.center.z - a.halfExtents.z, maxZ: a.center.z + a.halfExtents.z
  });
  let upward = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(n => n * 3);
    if ((positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) -
        (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]) > 0) upward++;
  }
  const ground = e?.parent.findByName("ground")?.render.meshInstances[0];
  const mat = mi?.material;
  return {
    ...d.getStatus(), count: entities.length, guid: e?.getGuid(),
    enabled: !!(e?.enabled && e.render?.enabled), instances: e?.render?.meshInstances.length,
    visible: mi?.visible, visibleThisFrame: mi?.visibleThisFrame,
    triangles: indices.length / 3, upward, bounds: bounds(mi?.aabb), ground: bounds(ground?.aabb),
    layers: e?.render?.layers, cameraLayers: d.orbit.camera.camera.layers,
    material: mat && { specular: mat.specular.r, gloss: mat.gloss,
      rippleOffset: mat.normalMapOffset.x,
      normalMap: !!mat.normalMap, reflection: !!mat.cubeMap, opacity: mat.opacity }
  };
}

function assertPond(s, visible = true) {
  assert.equal(s.count, 1, "C03 contains exactly one pond after every rebuild");
  assert.ok(s.enabled && s.visible, "pond render component and instance enabled");
  assert.equal(s.instances, 1);
  assert.equal(s.triangles, 11, "real mesh retains canonical triangles");
  assert.equal(s.upward, 11, "actual uploaded triangle winding faces upward");
  // Render -Z is north; gameplay/canonical +Z bounds remain -4.60224..46.74761.
  for (const [key, value] of Object.entries({ minX: 103.4154, maxX: 141.2942, minZ: -46.74761, maxZ: 4.60224 })) {
    assert.ok(Math.abs(s.bounds[key] - value) < .001, `runtime ${key} matches canonical envelope`);
  }
  assert.ok(s.bounds.minY > s.ground.maxY, "water above ground");
  assert.ok(s.bounds.maxY < .09, "water keeps its low surface elevation");
  assert.ok(s.layers.some(id => s.cameraLayers.includes(id)), "camera renders water layer");
  if (visible) assert.equal(s.visibleThisFrame, true, "water is inside the actual camera frustum");
  assert.ok(s.material.specular > .01 && s.material.gloss > .5 &&
    s.material.normalMap && s.material.reflection, "water has rippled, reflective shading instead of the flat ground material");
}

try {
  for (const mode of ["desktop", "mobile", "webgl2"]) {
    const mobile = mode === "mobile";
    const webgl2 = mode === "webgl2";
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1
    });
    if (webgl2) await context.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
    // Only analytics are intercepted. Scene code, canonical data, models and shaders are real.
    await context.route("**/api/hub-event", r => r.fulfill({ status: 204 }));
    await context.route("**/api/hub-entry", r => r.fulfill({ status: 204 }));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Runtime.enable");
    const result = { mode, errors: [], states: [], telemetryIntercepted: true };
    report.results.push(result);
    page.on("pageerror", e => result.errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") result.errors.push(m.text()); });
    if (process.env.POND_QA_ACCESS_URL) await page.goto(process.env.POND_QA_ACCESS_URL);
    await page.goto(new URL("/campus/", base).href);
    await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().renderer?.startsWith("WebG"), {}, { timeout: 45000 });
    await page.waitForFunction(() => window.__INHAGAME_P0__.app.frame > 10);
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer), webgl2 ? "WebGL2" : "WebGPU");
    assert.ok(await page.evaluate(() => {
      const d = window.__INHAGAME_P0__;
      const north = d.player.getLocalPosition().clone();
      north.z += 20;
      const transform = d.player.parent.getWorldTransform();
      const centerX = d.orbit.camera.camera.worldToScreen(transform.transformPoint(north)).x;
      north.x += 10;
      return d.orbit.camera.camera.worldToScreen(transform.transformPoint(north)).x > centerX;
    }), "looking north, geographic east must appear on the right (campus must not be mirrored)");

    // Verify real keyboard/touch input, then traverse with the real controller and collisions.
    const before = await page.evaluate(() => window.__INHAGAME_P0__.player.getLocalPosition().z);
    if (mobile) {
      const r = await page.locator("#joystick").boundingBox();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x + r.width / 2, y: r.y + 10 }] });
      await page.waitForFunction(z => window.__INHAGAME_P0__.player.getLocalPosition().z > z, before);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.keyboard.down("w");
      await page.waitForFunction(z => window.__INHAGAME_P0__.player.getLocalPosition().z > z, before);
      await page.keyboard.up("w");
    }
    assert.ok(await page.evaluate(() => window.__INHAGAME_P0__.player.getLocalPosition().z) > before);
    for (const yaw of [0, Math.PI / 2]) {
      await page.evaluate(yaw => { window.__INHAGAME_P0__.orbit.yaw = yaw; }, yaw);
      const start = await page.evaluate(() => {
        const p = window.__INHAGAME_P0__.player.getLocalPosition();
        return { x: p.x, z: p.z };
      });
      await page.keyboard.down("d");
      await page.waitForTimeout(250);
      await page.keyboard.up("d");
      assert.ok(await page.evaluate(({ start, yaw }) => {
        const p = window.__INHAGAME_P0__.player.getLocalPosition();
        return (p.x - start.x) * Math.cos(yaw) + (p.z - start.z) * Math.sin(yaw) > .1;
      }, { start, yaw }), "right input follows the camera in the corrected coordinate frame");
    }
    await page.keyboard.press("m");
    await page.keyboard.down("Space");
    await page.waitForFunction(() => window.__INHAGAME_P0__.player.getLocalPosition().y > 2);
    await page.keyboard.up("Space");
    await page.keyboard.press("m");
    await page.waitForFunction(() => !window.__INHAGAME_P0__.getStatus().mounted);
    assert.ok(await page.evaluate(() => Math.abs(window.__INHAGAME_P0__.player.getLocalPosition().y - 1.15) < .001),
      "mount ascent and landing preserve campus coordinates");

    async function walk(x, z) {
      await page.evaluate(({ x, z }) => {
        const d = window.__INHAGAME_P0__;
        d.orbit.yaw = 0;
        let arrived = false;
        for (let i = 0; i < 5000; i++) {
          const p = d.player.getLocalPosition(), dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
          if (len < .04) { arrived = true; break; }
          d.controller.touchVector = { x: dx / len, y: -dz / len };
          d.app.fire("update", Math.min(.04, len / d.controller.walkSpeed));
        }
        d.controller.touchVector = { x: 0, y: 0 };
        d.streaming.update(1, d.player.getLocalPosition());
        if (!arrived) throw Error(`Blocked route to ${x},${z} from ${d.player.getLocalPosition()}`);
      }, { x, z });
      await page.waitForTimeout(300);
    }
    async function capture(label, yaw = 0, overview = false) {
      await page.evaluate(({ yaw, overview }) => {
        const d = window.__INHAGAME_P0__;
        d.orbit.yaw = yaw;
        // Both values are within normal user-controlled camera limits (12..36, .12..1.2).
        d.orbit.distance = overview ? 36 : Math.hypot(7.3, 18.5);
        d.orbit.pitch = overview ? .85 : Math.atan2(7.3, 18.5);
      }, { yaw, overview });
      await page.waitForTimeout(400);
      const state = await page.evaluate(inspectPond);
      result.states.push({ label, ...state });
      await page.screenshot({ path: resolve(output, `${mode}-${label}.png`) });
      assertPond(state);
      return state;
    }
    async function basicView(label, yaw, distance = 36) {
      await page.evaluate(({yaw,distance})=>Object.assign(window.__INHAGAME_P0__.orbit,{yaw,pitch:.28,distance}),{yaw,distance});
      await page.waitForTimeout(400);
      const buildings=await page.evaluate(()=>['bldg_01','bldg_jungseok'].map(id=>{
        const all=window.__INHAGAME_P0__.app.root.find(e=>e.name===id),e=all[0],mi=e?.render?.meshInstances[0],p=[],indices=[];
        mi?.mesh.getPositions(p);mi?.mesh.getIndices(indices);
        const a=mi?.aabb;
        return {id,count:all.length,enabled:!!(e?.enabled&&e.render?.enabled),triangles:indices.length/3,finite:p.every(Number.isFinite),bounds:a&&{minX:a.center.x-a.halfExtents.x,maxX:a.center.x+a.halfExtents.x,minZ:a.center.z-a.halfExtents.z,maxZ:a.center.z+a.halfExtents.z}};
      }));
      for(const b of buildings) {
        const source=BUILDINGS.find(s=>s.id===b.id),pts=source.vertices;
        assert.equal(b.count,1);assert.ok(b.enabled&&b.finite&&b.triangles>0);
        for(const [key,value]of Object.entries({minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minZ:-Math.max(...pts.map(p=>p.z)),maxZ:-Math.min(...pts.map(p=>p.z))}))assert.ok(Math.abs(b.bounds[key]-value)<.001,`${b.id} real GPU ${key}`);
      }
      result.states.push({label,buildings});
      await page.screenshot({path:resolve(output,`${mode}-${label}.png`)});
    }
    await walk(0, -76);
    assert.match(await page.locator("#tour-bearing").textContent(), /^↗/, "Main Hall is northeast, on the right");
    await basicView('gate-view',-.51);
    await walk(14,-46);
    await walk(36,-12);
    await walk(49.481, -4.715);
    await basicView('hall-entrance',-.51,30);
    await walk(36,-12);
    await walk(0,-34);
    await basicView('library',.95);
    await walk(36,-12);
    await walk(49.481,-4.715);
    await walk(60, -18);
    await walk(90, -18);
    await walk(130.3574, -2.1004);
    const first = await capture("pond");
    await page.waitForTimeout(500);
    assert.notEqual((await page.evaluate(inspectPond)).material.rippleOffset, first.material.rippleOffset,
      "water ripples advance in real rendered frames");
    assert.equal(first.tourStage, 2, "Gate → Hall tour completed");
    assert.equal(first.zones.C03_CENTRAL, "ACTIVE");
    await walk(95, -4);
    await walk(100, 20);
    await capture("close", -Math.PI / 2);
    await capture("overview", -Math.PI / 2, true);
    await walk(94, 20);
    const near = await capture("near", -Math.PI / 2);
    assert.equal(near.zones.C03_CENTRAL, "NEAR");
    assert.notEqual(near.guid, first.guid, "streaming actually rebuilt the entity");
    await walk(95, -4);
    // Pass south of the existing east entrance lamp when returning toward the hall.
    await walk(95, -8);
    await walk(90, -18);
    await walk(60, -18);
    await walk(49.481, -15);
    await walk(49.481, -4.715);
    await walk(0, -76);
    await walk(0, -98);
    const unloaded = await page.evaluate(inspectPond);
    assert.equal(unloaded.zones.C03_CENTRAL, "UNLOADED");
    assert.equal(unloaded.count, 0);
    result.states.push({ label: "unloaded", ...unloaded });
    await walk(0, -76);
    await walk(49.481, -4.715);
    await walk(60, -18);
    await walk(90, -18);
    await walk(130.3574, -2.1004);
    const returned = await capture("returned");
    assert.notEqual(returned.guid, first.guid);
    await basicView('buildings-after-streaming',0);
    await walk(95, -8);
    await walk(85, -30);
    await page.evaluate(() => {
      const d = window.__INHAGAME_P0__;
      d.orbit.yaw = 0; d.orbit.pitch = .55; d.orbit.distance = 36;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(output, `${mode}-hall-pond-layout.png`) });
    assert.deepEqual(result.errors, []);
    result.pass = true;
    await context.close();
    console.log(`${mode}: pond runtime, screenshots, tour and unload/reload PASS`);
  }
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
