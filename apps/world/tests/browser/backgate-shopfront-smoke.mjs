// Exact-head GitHub-hosted-only QA. Never run this to bypass a denied local browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertHosted, BASELINE, CURRENT_MAIN, BASELINE_PATHS, VIEWPORTS, VIEWS, expectedRaster } from './backgate-shopfront-qa-plan.mjs';

assertHosted(process.env); // Before importing the browser harness or starting any server.
const { startSmoke } = await import('./harness.mjs');
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(process.env.WORLD_SHOPFRONT_QA_OUTPUT || 'test-results/backgate-shopfronts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
const began = Date.now();
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), baselineCommit: BASELINE, currentMainCommit: CURRENT_MAIN,
  scope: 'Actual offline current campus; only three old geometry/sign modules are substituted. Neutral illustrative facades, no image/reference fidelity or surveyed-business claim.',
  limits: { overallMs: 660000, bootMs: 60000, operationMs: 15000, frameMs: 6000, cleanupMs: 10000 },
  camera: 'Same orthographic facade-inspection cameras in both variants; not chase-camera or physical-device evidence',
  excluded: ['Production sky', 'performance/FPS', 'WebGPU', 'real touch/keyboard input', 'all 37 individual facade screenshots', 'exhaustive navigation'],
  baselineFiles: [], currentSharedFiles: [], cases: [], walking: [], comparisons: [], screenshots: [] };
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'report.json');
const flush = () => writeFile(reportPath, JSON.stringify({ ...report, elapsedMs: Date.now() - began }, null, 2) + '\n');
const watchdog = setTimeout(() => {
  report.status = 'FAIL'; report.error = 'Overall hosted shopfront QA deadline exceeded';
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); process.exit(1);
}, report.limits.overallMs);
async function bounded(label, operation, ms = report.limits.operationMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label}: ${ms}ms deadline exceeded`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const samplesByCase = new Map();
let activeCase;
try {
  report.head = git(['rev-parse', 'HEAD']).toString().trim();
  assert.equal(report.head, process.env.EXPECTED_SHOPFRONT_HEAD, 'exact pull request head');
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']).toString().trim(), '', 'exact-head checkout must be clean');
  assert.equal(git(['rev-parse', `${BASELINE}^{commit}`]).toString().trim(), BASELINE);
  assert.equal(git(['rev-parse', `${CURRENT_MAIN}^{commit}`]).toString().trim(), CURRENT_MAIN);
  report.githubRunId = process.env.GITHUB_RUN_ID;
  const oldSources = new Map(BASELINE_PATHS.map(urlPath => {
    const sourcePath = `apps/world${urlPath}`, bytes = git(['show', `${BASELINE}:${sourcePath}`]);
    report.baselineFiles.push({ path: sourcePath, commit: BASELINE, sha256: hash(bytes) });
    return [urlPath, bytes];
  }));
  for (const name of ['campus-chunk-renderer.js', 'campus-render-kit.js', 'campus-material-profile.js',
    'back-street-layout.js', 'culture-street-layout.js', 'world-collision.js', 'roadview-layout.js']) {
    const sourcePath = `apps/world/src/${name}`;
    report.currentSharedFiles.push({ path: sourcePath, sha256: hash(await readFile(path.join(repo, sourcePath))) });
  }
  report.runtimeChangedPaths = git(['diff', '--name-only', CURRENT_MAIN, 'HEAD', '--', 'apps/world/src', 'apps/world/data'])
    .toString().trim().split('\n').filter(Boolean);
  const allowed = [...BASELINE_PATHS.map(p => `apps/world${p}`), 'apps/world/src/backgate-shopfront-geometry.js'];
  for (const changed of report.runtimeChangedPaths) assert.ok(allowed.includes(changed), `unrelated runtime change: ${changed}`);
  await flush();

  for (const viewport of VIEWPORTS) {
    const smoke = await bounded('browser startup', () => startSmoke({ viewport: { width: viewport.width, height: viewport.height },
      contextOptions: { deviceScaleFactor: 1, isMobile: viewport.name !== 'desktop', hasTouch: viewport.name !== 'desktop' } }), 30000);
    try {
      for (const variant of ['old', 'new']) {
        const page = await smoke.context.newPage(), fatal = smoke.watch(page), baselineHits = [];
        const evaluate = (label, fn, args) => bounded(label, () => Promise.race([page.evaluate(fn, args), fatal]));
        const invoke = (method, value) => evaluate(method, async ({ method, value }) => {
          const fixture = await import('/tests/browser/backgate-shopfront-fixture.mjs');
          return fixture[method](value);
        }, { method, value });
        if (variant === 'old') await page.route(url => url.origin === smoke.origin && BASELINE_PATHS.includes(url.pathname), async route => {
          const url = new URL(route.request().url());
          baselineHits.push({ path: url.pathname, sha256: hash(oldSources.get(url.pathname)) });
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: oldSources.get(url.pathname) });
        });
        activeCase = { viewport, variant, status: 'RUNNING', baselineHits, views: [] }; report.cases.push(activeCase); await flush();
        try {
          await bounded('campus boot', () => Promise.race([(async () => {
            await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForFunction(() => { const s = window.__INHAGAME_P0__?.getStatus?.();
              return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished; }, null, { timeout: 60000 });
            await page.waitForFunction(() => window.__INHAGAME_ENVIRONMENT__?.status?.().settled &&
              window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled, null, { timeout: 60000 });
          })(), fatal]), 65000);
          activeCase.renderer = await evaluate('renderer', () => window.__INHAGAME_P0__.getStatus().renderer);
          assert.equal(activeCase.renderer, 'WebGL2');
          await page.addStyleTag({ content: 'body > :not(#application):not(script):not(style){visibility:hidden!important}' });
          activeCase.fixture = await evaluate('freeze actual campus', async () => {
            const { prepareCampus } = await import('/tests/browser/backgate-shopfront-fixture.mjs');
            return prepareCampus(window.__INHAGAME_P0__);
          });
          activeCase.raster = expectedRaster(viewport, activeCase.fixture.graphics, activeCase.fixture.devicePixelRatio);
          if (variant === 'old') assert.deepEqual([...new Set(baselineHits.map(hit => hit.path))].sort(), [...BASELINE_PATHS].sort());
          else assert.deepEqual(baselineHits, []);
          const walking = await evaluate('actual controller routes', async () => {
            const { runShopfrontWalking } = await import('/tests/browser/backgate-shopfront-walking.mjs');
            return runShopfrontWalking(window.__INHAGAME_P0__);
          });
          assert.equal(walking.passed, true); assert.equal(walking.cases.length, 8);
          report.walking.push({ viewport: viewport.name, variant, ...walking });

          for (const view of VIEWS) {
            const setup = await invoke('selectView', view.name), receipt = { ...setup, tiers: [] }; activeCase.views.push(receipt);
            let allHash;
            for (const tier of ['ALL', 'BASE']) {
              const ownership = await invoke('setTier', tier);
              await invoke('pixels'); await invoke('pixels'); // Warm camera, shader and shadow state before evidence.
              const visible = await invoke('pixels'), stable = await invoke('pixels');
              for (const frame of [visible, stable]) {
                assert.equal(frame.width, activeCase.raster.width); assert.equal(frame.height, activeCase.raster.height);
                assert.equal(frame.glError, 0); assert.equal(frame.contextLost, false);
              }
              assert.equal(stable.sha256, visible.sha256, `${view.name} ${tier}: stationary framebuffer must be identical`);
              assert.equal(stable.changed, 0); assert.equal(stable.changedFacade, 0);
              const key = `${viewport.name}-${view.name}-${tier.toLowerCase()}`, filename = `${key}-${variant}.png`;
              await bounded('screenshot', () => page.locator('#application').screenshot({ path: path.join(output, filename), scale: 'css', animations: 'disabled', timeout: 10000 }));
              const bytes = await readFile(path.join(output, filename));
              assert.equal(bytes.readUInt32BE(16), viewport.width, 'CSS screenshot width');
              assert.equal(bytes.readUInt32BE(20), viewport.height, 'CSS screenshot height');
              report.screenshots.push({ file: filename, sha256: hash(bytes), bytes: bytes.length, scale: 'css',
                cssWidth: viewport.width, cssHeight: viewport.height, framebufferWidth: visible.width, framebufferHeight: visible.height, framebufferSha256: visible.sha256 });
              samplesByCase.set(`${key}-${variant}`, { samples: visible.samples, camera: setup.camera, hash: visible.sha256 });
              await invoke('showShopfronts', false);
              const hidden = await invoke('pixels');
              assert.equal(hidden.glError, 0); assert.equal(hidden.contextLost, false);
              assert.ok(hidden.changedFacade > Math.max(30, visible.facadePixels * .002), `${key}: target has no visible facade contribution`);
              await invoke('showShopfronts', true);
              await invoke('pixels'); const restored = await invoke('pixels');
              assert.equal(restored.glError, 0); assert.equal(restored.sha256, visible.sha256, `${key}: exact target restoration`);
              const summary = ({ samples, ...rest }) => rest;
              receipt.tiers.push({ tier, ownership, visible: summary(visible), stable: summary(stable), hidden: summary(hidden), restored: summary(restored), screenshot: filename });
              if (tier === 'ALL') allHash = visible.sha256;
              await flush();
            }
            await invoke('setTier', 'ALL'); await invoke('pixels'); const cycled = await invoke('pixels');
            assert.equal(cycled.sha256, allHash, `${view.name}: ALL -> BASE -> ALL pixels must restore`);
            receipt.lodRoundTripSha256 = cycled.sha256;
          }
          assert.deepEqual(smoke.problems, [], 'browser errors'); activeCase.status = 'PASS'; await flush();
        } finally { await bounded('page cleanup', () => page.close(), 10000); }
      }
    } finally { await bounded('browser cleanup', () => smoke.close(), 10000); }
  }
  for (const viewport of VIEWPORTS) {
    const oldCase = report.cases.find(r => r.viewport.name === viewport.name && r.variant === 'old');
    const newCase = report.cases.find(r => r.viewport.name === viewport.name && r.variant === 'new');
    assert.deepEqual(newCase.fixture.graphics, oldCase.fixture.graphics, 'same unmodified active graphics profile');
    assert.deepEqual(newCase.raster, oldCase.raster, 'same backing-buffer raster dimensions');
    const oldWalk = report.walking.find(r => r.viewport === viewport.name && r.variant === 'old');
    const newWalk = report.walking.find(r => r.viewport === viewport.name && r.variant === 'new');
    assert.deepEqual(newWalk.cases, oldWalk.cases, 'same actual-controller paths and heights in both geometry variants');
    for (const view of VIEWS) for (const tier of ['ALL', 'BASE']) {
      const key = `${viewport.name}-${view.name}-${tier.toLowerCase()}`, old = samplesByCase.get(`${key}-old`), current = samplesByCase.get(`${key}-new`);
      assert.deepEqual(current.camera, old.camera, `${key}: same camera`); assert.notEqual(current.hash, old.hash, `${key}: old/new frames differ`);
      let changedSamples = 0;
      for (let i = 0; i < old.samples.length; i += 3) if (old.samples.slice(i, i + 3).reduce((sum, n, j) => sum + Math.abs(n - current.samples[i + j]), 0) > 12) changedSamples++;
      assert.ok(changedSamples > 8, `${key}: old/new facade sample difference`);
      report.comparisons.push({ key, cameraIdentical: true, oldSha256: old.hash, newSha256: current.hash, changedFacadeSamples: changedSamples, totalFacadeSamples: 1024 });
    }
  }
  assert.equal(report.screenshots.length, 48); assert.equal(report.comparisons.length, 24);
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), report.head);
  assert.equal(git(['status', '--porcelain', '--untracked-files=normal']).toString().trim(), '', 'QA must not change tracked checkout state');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack || error);
  if (activeCase?.status === 'RUNNING') activeCase.status = 'FAIL';
  throw error;
} finally {
  clearTimeout(watchdog); await flush();
  const manifest = [...report.screenshots.map(s => `${s.sha256}  ${s.file}`), `${hash(await readFile(reportPath))}  report.json`];
  await writeFile(path.join(output, 'SHA256SUMS'), manifest.join('\n') + '\n');
  console.log(`Shopfront hosted QA: ${report.status}; ${report.screenshots.length}/48 screenshots; ${report.comparisons.length}/24 old/new pairs`);
}
