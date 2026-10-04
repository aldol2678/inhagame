import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const output = resolve(process.env.HIGGS_TRASH_POC_OUTPUT || "higgsfield-trash-runtime-poc");
await mkdir(output, { recursive: true });
const smoke = await startSmoke({ viewport: { width: 1280, height: 800 } });
const report = { url: smoke.origin, result: null };

function percentile(values, p) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))];
}

async function sampleFrames(page, mode) {
  await page.evaluate(mode => window.__INHAGAME_HIGGSFIELD_TRASH_POC__.setMode(mode), mode);
  await page.waitForTimeout(150);
  return page.evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    for (let i = 0; i < 72; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      if (i >= 8) samples.push(now - previous);
      previous = now;
    }
    return samples;
  });
}

try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?assetPoc=higgsfield-trash`, {
    waitUntil: "domcontentloaded", timeout: TIMEOUT_MS
  });
  await Promise.race([
    page.waitForFunction(() =>
      window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true &&
      window.__INHAGAME_HIGGSFIELD_TRASH_POC__?.status?.().ready === true,
      null, { timeout: TIMEOUT_MS }),
    fatal
  ]);

  const initial = await page.evaluate(() => ({
    renderer: window.__INHAGAME_P0__.getStatus().renderer,
    poc: window.__INHAGAME_HIGGSFIELD_TRASH_POC__.status()
  }));
  assert.equal(initial.renderer, "WebGPU", "strict POC must exercise the WebGPU renderer");
  assert.equal(initial.poc.provenance.revision, 2);
  assert.equal(initial.poc.provenance.assetBytes, 58044);
  assert.equal(initial.poc.provenance.sourceTriangles, 720);
  assert.equal(initial.poc.generated.triangles, 720, "runtime GLB triangle count matches Blender receipt");
  assert.ok(initial.poc.generated.meshInstances > 0 && initial.poc.generated.meshInstances <= 16);
  assert.ok(initial.poc.control.triangles > 0);

  await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    d.orbit.yaw = 0;
    d.orbit.pitch = 0.28;
    d.orbit.distance = 5.5;
    for (let i = 0; i < 8; i++) d.app.fire("update", 0.016);
  });
  await page.waitForTimeout(300);

  const visibility = await page.evaluate(() => {
    const d = window.__INHAGAME_P0__;
    const camera = d.orbit.camera.camera;
    const locate = name => {
      const entity = d.app.root.findByName(name);
      const point = camera.worldToScreen(entity.getPosition());
      return { x: point.x, y: point.y, z: point.z, enabled: entity.enabled };
    };
    return {
      generated: locate("HiggsfieldTrashGeneratedSlot"),
      control: locate("HiggsfieldTrashControlSlot"),
      width: innerWidth,
      height: innerHeight
    };
  });
  for (const target of [visibility.generated, visibility.control]) {
    assert.ok(target.enabled && target.z > 0);
    assert.ok(target.x >= 0 && target.x <= visibility.width);
    assert.ok(target.y >= 0 && target.y <= visibility.height);
  }
  assert.ok(Math.abs(visibility.generated.x - visibility.control.x) > 25, "side-by-side controls are visually separated");

  const generatedFrames = await sampleFrames(page, "generated");
  const controlFrames = await sampleFrames(page, "control");
  const bothFrames = await sampleFrames(page, "both");
  await page.waitForTimeout(120);
  await page.screenshot({ path: resolve(output, "webgpu-side-by-side.png"), fullPage: true });

  report.result = {
    ...initial,
    visibility,
    frameMs: {
      generated: { p50: percentile(generatedFrames, .50), p95: percentile(generatedFrames, .95) },
      control: { p50: percentile(controlFrames, .50), p95: percentile(controlFrames, .95) },
      both: { p50: percentile(bothFrames, .50), p95: percentile(bothFrames, .95) }
    },
    problems: [...smoke.problems]
  };
  assert.deepEqual(smoke.problems, []);
  console.log(JSON.stringify(report.result, null, 2));
} finally {
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await smoke.close();
}
