// Exact-head, offline real-browser visual acceptance for MAIN_GATE_REVEAL_V01.
// Uses the shared campus harness only. No login, backend mutation, Preview deployment or Production access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startSmoke, TIMEOUT_MS } from "./harness.mjs";

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const expectedHead = process.env.EXPECTED_MAP_HEAD;
assert.match(expectedHead ?? "", /^[a-f0-9]{40}$/, "EXPECTED_MAP_HEAD must identify the immutable candidate");
assert.equal(head, expectedHead, "cinematic acceptance must test the exact PR head");

const output = path.resolve(process.env.WORLD_CINEMATIC_QA_OUTPUT || "test-results/main-gate-cinematic");
await mkdir(output, { recursive: true });
const report = {
  head,
  status: "RUNNING",
  scope: "Real offline Campus renderer; MAIN_GATE_REVEAL_V01 desktop + mobile frames; backend disabled",
  cases: [],
  screenshots: []
};

const capture = async (page, name) => {
  const file = `${name}.png`;
  const bytes = await page.screenshot({
    path: path.join(output, file),
    fullPage: false,
    animations: "disabled"
  });
  report.screenshots.push({
    file,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
};

const readFrame = page => page.evaluate(() => {
  const d = window.__INHAGAME_P0__;
  const s = d.getStatus();
  const camera = d.app.root.findByName("Camera");
  const p = camera.getPosition();
  const f = camera.forward;
  return {
    cinematic: s.cinematic,
    inputEnabled: d.controller.inputEnabled,
    orbitInputEnabled: d.orbit.inputEnabled,
    fov: camera.camera.fov,
    camera: { x: p.x, y: p.y, z: p.z },
    forward: { x: f.x, y: f.y, z: f.z },
    player: (() => {
      const q = d.player.getLocalPosition();
      return { x: q.x, y: q.y, z: q.z };
    })(),
    bodyCinematic: document.body.dataset.cinematic ?? null,
    renderer: s.renderer
  };
});

try {
  for (const spec of [
    { name: "desktop", viewport: { width: 1280, height: 720 }, mobile: false },
    { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true }
  ]) {
    const smoke = await startSmoke({
      viewport: spec.viewport,
      contextOptions: { isMobile: spec.mobile, hasTouch: spec.mobile }
    });
    try {
      const page = await smoke.context.newPage();
      const fatal = smoke.watch(page);
      const wait = (fn, arg = null, timeout = TIMEOUT_MS) =>
        Promise.race([page.waitForFunction(fn, arg, { timeout }), fatal]);

      await page.goto(`${smoke.origin}/campus/?lobby=1&envTime=day&envWeather=clear`, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS
      });
      await wait(() => {
        const s = window.__INHAGAME_P0__?.getStatus?.();
        return s?.renderer === "UNAVAILABLE" || s?.loading?.finished;
      });
      const boot = await readFrame(page);
      assert.equal(boot.renderer, "WebGL2");

      const start = page.locator("#main-gate-start");
      await (spec.mobile ? start.tap() : start.click());
      await wait(() => window.__INHAGAME_P0__?.getStatus?.().cinematic?.active === true);

      const entry = { name: spec.name, viewport: spec.viewport, frames: [] };
      for (const shot of [
        { id: "opening", elapsed: 0.65 },
        { id: "rise", elapsed: 2.35 },
        { id: "vista", elapsed: 5.15 }
      ]) {
        await wait(target => {
          const c = window.__INHAGAME_P0__?.getStatus?.().cinematic;
          return c?.active === true && c.elapsed >= target;
        }, shot.elapsed, 30_000);
        const frame = await readFrame(page);
        assert.equal(frame.cinematic.sequenceId, "MAIN_GATE_REVEAL_V01");
        assert.equal(frame.inputEnabled, false);
        assert.equal(frame.orbitInputEnabled, false);
        assert.equal(frame.bodyCinematic, "MAIN_GATE_REVEAL_V01");
        assert.ok(frame.fov >= 50 && frame.fov <= 75);
        entry.frames.push({ shot: shot.id, ...frame });
        await capture(page, `${spec.name}-${shot.id}`);
      }

      await wait(() => {
        const d = window.__INHAGAME_P0__, c = d?.getStatus?.().cinematic;
        return c?.active === false && c?.reason === "complete" && d.controller.inputEnabled;
      }, null, 30_000);
      entry.completed = await readFrame(page);
      assert.equal(entry.completed.bodyCinematic, null);
      assert.equal(entry.completed.inputEnabled, true);
      assert.equal(entry.completed.orbitInputEnabled, true);
      assert.ok(Math.abs(entry.completed.fov - 62) < 1e-6, "gameplay FOV is restored");
      assert.deepEqual(smoke.problems, []);
      entry.result = "PASS";
      report.cases.push(entry);
    } finally {
      await smoke.close();
    }
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.stack || String(error);
  throw error;
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
