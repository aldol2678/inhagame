// Offline application smoke: pinned npm Recast + real WASM, exact page/modules/data.
// npm run build:artifact --prefix apps/world/tests/recast-runtime must run first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.WORLD_RECAST_PLAYWRIGHT_MODULE ?? 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = resolve(root, 'tests/recast-runtime/node_modules/@recast-navigation');
const manifest = JSON.parse(await readFile(resolve(root, 'recast-data/campus.manifest.json'), 'utf8'));
const bytes = await readFile(resolve(root, `recast-data/${manifest.binarySha256}.bin`));
const importMap = { imports: {
  '@recast-navigation/core': '/__recast/core/index.mjs',
  '@recast-navigation/wasm': '/__recast/wasm/recast-navigation.wasm-compat.js'
} };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = path.startsWith('/__recast/') ? resolve(runtime, path.slice('/__recast/'.length)
      .replace(/^(core|wasm|generators)\//, '$1/dist/')) : resolve(root, '.' + path);
    if (!file.startsWith(root) || file.includes('\0')) throw Error('Invalid path');
    let body = await readFile(file);
    if (path === '/recast-npc-poc.html') body = body.toString().replace('<head>',
      `<head><script type="importmap">${JSON.stringify(importMap)}</script>`);
    if (path.startsWith('/__recast/') && /\.(mjs|js)$/.test(path)) {
      body = body.toString().replaceAll("'@recast-navigation/core'", "'/__recast/core/index.mjs'")
        .replaceAll("'@recast-navigation/wasm'", "'/__recast/wasm/recast-navigation.wasm-compat.js'");
    }
    const types = { '.html': 'text/html', '.json': 'application/json', '.bin': 'application/octet-stream' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/javascript', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const observed = {};
try {
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.WORLD_RECAST_BROWSER_EXECUTABLE || undefined });
  for (const mode of ['prebuilt', 'main', 'missing', 'stale', 'corrupt', 'runtime', 'cancel-restart', 'worker-error']) {
    console.error('START', mode);
    const context = await browser.newContext();
    let engineRequests = 0;
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) return route.continue();
      const exports = { 'https://esm.sh/recast-navigation@0.43.1': 'core',
        'https://esm.sh/recast-navigation@0.43.1/generators': 'generators' };
      const name = exports[url];
      if (!name) return route.abort();
      engineRequests++;
      await route.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
        body: `export * from '${origin}/__recast/${name}/index.mjs';` });
    });
    if (mode === 'missing') await context.route('**/campus.manifest.json', route => route.fulfill({ status: 404 }));
    if (mode === 'stale') await context.route('**/campus.manifest.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...manifest, inputSha256: '0'.repeat(64) }) }));
    if (mode === 'corrupt') await context.route(`**/${manifest.binarySha256}.bin`, route => {
      const corrupt = Buffer.from(bytes); corrupt[100] ^= 1; return route.fulfill({ body: corrupt });
    });
    if (mode === 'worker-error') await context.route('**/recast-npc-worker.mjs', route => route.fulfill({ status: 404 }));
    await context.addInitScript(() => {
      const stats = window.__responsiveness = { frames: 0, maxFrameGapMs: 0, scheduleFrames: 0, longTasks: [], workers: 0, terminated: 0 };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); stats.workers++; }
        terminate() { stats.terminated++; return super.terminate(); }
      };
      let previous;
      const frame = now => {
        if (previous !== undefined) stats.maxFrameGapMs = Math.max(stats.maxFrameGapMs, now - previous);
        previous = now; stats.frames++;
        if (document.getElementById('recast-poc-status')?.textContent.includes('legacy')) stats.scheduleFrames++;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      new PerformanceObserver(list => stats.longTasks.push(...list.getEntries().map(e => e.duration)))
        .observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${origin}/recast-npc-poc.html${mode === 'runtime' ? '?navMesh=runtime' : mode === 'prebuilt' ? '' : '?navMesh=prebuilt'}${mode === 'main' ? '&execution=main' : ''}`);
      if (['prebuilt', 'cancel-restart'].includes(mode)) {
        await page.waitForFunction(() => window.__responsiveness.scheduleFrames >= 10, null, { timeout: 120_000 });
        // A real DOM click while the synchronous evaluator is still busy in its Worker.
        await page.evaluate(() => {
          const button = document.createElement('button'); button.id = 'test-probe'; button.textContent = 'probe';
          button.onclick = () => { window.__probeClicked = true; }; document.body.append(button);
        });
        const at = performance.now(); await page.locator('#test-probe').click();
        observed[mode + 'ClickMs'] = performance.now() - at;
        assert.equal(await page.evaluate(() => window.__probeClicked), true);
        assert.equal(await page.evaluate(() => window.__RECAST_NPC_POC__ === undefined), true);
      }
      if (mode === 'cancel-restart') {
        await page.locator('#recast-poc-cancel').click();
        await page.waitForFunction(() => window.__RECAST_NPC_POC__?.verdict === 'CANCELLED');
        const cancelledAtFrame = await page.evaluate(() => window.__responsiveness.frames);
        await page.waitForFunction(frame => window.__responsiveness.frames >= frame + 20, cancelledAtFrame);
        assert.equal(await page.evaluate(() => window.__RECAST_NPC_POC__.verdict), 'CANCELLED');
        await page.locator('#recast-poc-restart').click();
        await page.waitForFunction(() => window.__responsiveness.workers === 2);
        await page.locator('#recast-poc-restart').click();
      }
      await page.waitForFunction(() => Boolean(window.__RECAST_NPC_POC__), null, { timeout: 120_000 });
      const result = await page.evaluate(() => window.__RECAST_NPC_POC__);
      assert.deepEqual(JSON.parse(await page.locator('#recast-poc-output').textContent()), result);
      assert.deepEqual(errors, []);
      observed[mode] = result;
      observed[mode + 'Responsiveness'] = await page.evaluate(() => window.__responsiveness);
      console.error('RESULT', mode, result.verdict, JSON.stringify(observed[mode + 'Responsiveness']));
      if (['prebuilt', 'main', 'runtime', 'cancel-restart'].includes(mode)) {
        assert.equal(result.verdict, 'PASS', JSON.stringify(result));
        assert.equal(result.population, 48); assert.equal(result.expansion, 'READY');
        assert.equal(result.eligibleLegs, 200); assert.equal(result.recastRoutes, 200);
        assert.equal(result.movementLegs, 141); assert.equal(result.movementCoverage, 1);
        assert.equal(result.failures.length, 0); assert.equal(result.skippedMissingEndpoints, 0);
        assert.equal(result.navMeshInitialization, mode === 'runtime' ? 'GENERATED' : 'IMPORTED');
      } else {
        assert.equal(result.verdict, 'ERROR');
        const reasons = { missing: 'UNAVAILABLE', stale: 'INPUT_MISMATCH', corrupt: 'BINARY_CHECKSUM', 'worker-error': 'WORKER_ERROR' };
        assert.match(result.message, new RegExp((mode === 'worker-error' ? 'RECAST_' : 'RECAST_ARTIFACT_') + reasons[mode]));
        assert.equal(engineRequests, 0, 'rejected artifacts must not start WASM or generation');
      }
    } catch (error) { console.error('OBSERVED_BEFORE_FAILURE', JSON.stringify(observed)); throw error; }
    finally { await context.close(); }
  }
  const metrics = ({ elapsedMs, artifactValidationMs, navigatorInitializationMs, scheduleEvaluationMs, navMeshInitialization, ...value }) => value;
  assert.deepEqual(metrics(observed.prebuilt), metrics(observed.runtime));
  assert.deepEqual(metrics(observed.prebuilt), metrics(observed.main));
  assert.deepEqual(metrics(observed.prebuilt), metrics(observed['cancel-restart']));
  for (const mode of ['prebuilt', 'runtime', 'cancel-restart']) {
    assert.ok(observed[mode + 'Responsiveness'].maxFrameGapMs < 500, mode + ' frame stalled');
    assert.ok(observed[mode + 'Responsiveness'].scheduleFrames >= 10, mode + ' schedule did not animate');
    assert.equal(observed[mode + 'Responsiveness'].workers, observed[mode + 'Responsiveness'].terminated);
  }
  assert.ok(observed.mainResponsiveness.maxFrameGapMs > 1000, 'baseline should expose synchronous blocking');
  assert.equal(observed['cancel-restartResponsiveness'].workers, 3);
  console.log(JSON.stringify({ browserVersion: browser.version(), offlinePinnedRecast: '0.43.1', observed }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
