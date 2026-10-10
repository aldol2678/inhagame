// Exact-head, offline browser acceptance. Run only on the existing GitHub-hosted
// Biryong job; never substitute a local browser or relax the harness isolation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAIN_GATE_SPAWN } from '../../src/campus-spawn.js';
import { assertHostedBrowserExecution } from './biryong-map-guidance-qa.mjs';
assertHostedBrowserExecution(process.env);
const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, process.env.EXPECTED_BIRYONG_HEAD);
const output = path.resolve(process.env.WORLD_BIRYONG_QA_OUTPUT || 'test-results/biryong-map-guidance', 'resume');
await mkdir(output, { recursive: true });
const report = { head, status: 'RUNNING', cases: [],
  scope: 'Offline guest resume, live frame persistence, reload, region maps and invalid-position main-gate fallback',
  limits: ['Synthetic local saved records; authenticated lifecycle is covered by Node integration tests',
    'Touch emulation is not physical-device testing', 'Screenshots still require independent visual review'] };
const key = 'inhagame-world-resume-v1:guest';
const seed = { version: 2, regionId: 'BIRYONG_REALM', x: 0, y: 1.15, z: 75,
  yawDeg: 47, cameraYaw: .8, savedAt: 10_000 };
const flush = () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
function snapshot() {
  const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
  return { region: s.worldRegion.regionId, position: { x: p.x, y: p.y, z: p.z }, movement: d.controller.space.id,
    parent: d.player.parent.name, yaw: d.player.getLocalEulerAngles().y, cameraYaw: d.orbit.yaw,
    campusPaused: d.online.campusPaused, minimap: d.minimap.status().mapSourceId,
    fullMap: d.fullMap.status().mapSourceId, lobby: s.lobby.active, input: d.controller.inputEnabled,
    hiddenStation: s.lobbySpawns.find(p => p.spawnId === 'BIRYONG_STATION'), resume: s.resume };
}
function assertRealm(value) {
  assert.equal(value.region, 'BIRYONG_REALM'); assert.equal(value.movement, 'BIRYONG_REALM');
  assert.equal(value.minimap, 'BIRYONG_REALM'); assert.equal(value.fullMap, 'BIRYONG_REALM');
  assert.equal(value.campusPaused, true); assert.equal(value.lobby, false); assert.equal(value.input, true);
  assert.equal(value.hiddenStation.visible, false); assert.equal(value.hiddenStation.canStart, false);
}
try {
  for (const spec of [{ name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false },
    { name: 'portrait', viewport: { width: 390, height: 844 }, mobile: true }]) {
    const smoke = await startSmoke({ viewport: spec.viewport, contextOptions: { isMobile: spec.mobile, hasTouch: spec.mobile } });
    try {
      const page = await smoke.context.newPage(), fatal = smoke.watch(page);
      const wait = (fn, arg = null) => Promise.race([page.waitForFunction(fn, arg, { timeout: TIMEOUT_MS }), fatal]);
      const boot = async () => {
        await wait(() => { const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished; });
        assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer), 'WebGL2');
      };
      await page.addInitScript(({ key, seed }) => {
        if (sessionStorage.getItem('resume-qa-seeded')) return;
        localStorage.setItem(key, JSON.stringify(seed)); sessionStorage.setItem('resume-qa-seeded', '1');
      }, { key, seed });
      await page.goto(`${smoke.origin}/campus/?lobby=1&envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded' });
      await boot();
      assert.equal(await page.locator('#resume-last-location').isVisible(), true);
      const activate = async () => {
        const button = page.locator('#resume-last-location');
        await (spec.mobile ? button.tap() : button.click());
        await wait(() => { const d = window.__INHAGAME_P0__; return !d.lobbyWorld.active && d.biryongRealm.status().ready; });
      };
      await activate();
      const arrived = await page.evaluate(snapshot); assertRealm(arrived);
      assert.ok(Math.abs(arrived.position.x - seed.x) < .01 && Math.abs(arrived.position.z - seed.z) < .01);
      assert.ok(Math.abs(arrived.cameraYaw - seed.cameraYaw) < .01);
      // A local fixture move checks the actual frame-save path (not a direct store write).
      await page.evaluate(() => window.__INHAGAME_P0__.player.setLocalPosition(2, 1.15, 75));
      await wait(({ key, seededAt }) => {
        const value = JSON.parse(localStorage.getItem(key));
        return value?.regionId === 'BIRYONG_REALM' && value.x === 2 && value.savedAt > seededAt;
      }, { key, seededAt: seed.savedAt });
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
      await page.reload({ waitUntil: 'domcontentloaded' }); await boot(); await activate();
      const reloaded = await page.evaluate(snapshot); assertRealm(reloaded);
      assert.ok(Math.abs(reloaded.position.x - 2) < .01 && Math.abs(reloaded.position.z - 75) < .01);
      await page.screenshot({ path: path.join(output, `${spec.name}-resumed.png`) });
      report.cases.push({ name: spec.name, arrived, saved, reloaded });
      // Unsafe saved building coordinates must leave the safe Main Gate CTA available.
      await page.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify({ ...seed, x: -24, z: 58 })), { key, seed });
      await page.reload({ waitUntil: 'domcontentloaded' }); await boot();
      assert.equal(await page.locator('#resume-last-location').isVisible(), false);
      await page.locator('#main-gate-start').click();
      await wait(() => {
        const d = window.__INHAGAME_P0__, s = d.getStatus();
        return !d.lobbyWorld.active && !s.cinematic?.active && d.controller.inputEnabled;
      });
      const invalid = await page.evaluate(snapshot);
      assert.equal(invalid.region, 'CAMPUS'); assert.equal(invalid.minimap, 'campus');
      assert.ok(Math.abs(invalid.position.x - MAIN_GATE_SPAWN.x) < .01 && Math.abs(invalid.position.z - MAIN_GATE_SPAWN.z) < .01);
      report.cases.push({ name: `${spec.name}-invalid-fallback`, invalid });
      assert.deepEqual(smoke.problems, []);
      await flush();
    } finally { await smoke.close(); }
  }
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.stack; throw error; }
finally { await flush(); }
