// Hosted WebGL2 diagnostic gate. Synthetic scene and replies; never full-campus acceptance.
// npm ci --prefix apps/world/tests/browser && npx --prefix apps/world/tests/browser playwright install chromium
// WORLD_SMOKE_DISABLE_WEBGPU=1 EXPECTED_ASSET_RUNTIME_HEAD=<sha> node apps/world/tests/browser/fishing-assets-smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startSmoke } from './harness.mjs';
import { FISHING_ASSETS } from '../../src/activity/fishing-visuals.js';
import { requirePixelContribution, FISHING_AVATAR_PROXY, validateFishingAvatarProxy } from './fishing-assets-fixture.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(process.env.FISHING_ASSETS_OUTPUT || 'test-results/asset-runtime/fishing');
const viewports = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'portrait', width: 390, height: 844 }, { name: 'landscape', width: 844, height: 390 }];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const committedBytes = relative => execFileSync('git', ['show', `${report.gitHead}:${relative}`], { cwd: repo, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'report.json'), started = Date.now();
const report = { status: 'RUNNING', startedAt: new Date().toISOString(),
  scope: 'Synthetic fishing scene, production createCharacter/client/presentation/renderer code, original fishing GLBs/atlases and the public QA cuboid proxy over HTTP, real PlayCanvas 2.22.4 WebGL2 pixels. Both canonical shore transforms; frozen synthetic server replies and diagnostic cameras. No live API, account, reward, full-campus, weather or first-person acceptance.',
  avatarScope: 'The production createCharacter/anchor path loads induck-v3.glb, an independent public QA cuboid proxy. Original mascot geometry is withheld; DuckWing_R is a compatibility node, not a real wing or hand. Close-ups prove code/anchor compatibility only. No duck anatomy or hand-fit acceptance. Magenta sphere is a synthetic wardrobe sentinel.',
  anatomicalFitValidated: false,
  limits: { operationMs: 15000, frameMs: 6000, overallMs: 300000, cleanupMs: 8000 },
  viewports, assets: [], sourceHashes: [], responses: [], requests: [], syntheticRequests: [], cases: [], screenshots: [], errors: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const watchdog = setTimeout(() => {
  report.status = 'FAIL'; report.errors.push('Overall fishing hosted deadline exceeded');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); process.exit(1);
}, report.limits.overallMs);
async function bounded(label, fn, ms = report.limits.operationMs) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label}: ${ms}ms deadline`)), ms); })]); }
  finally { clearTimeout(timer); }
}
const pixelsOkay = pixels => {
  assert.equal(pixels.glError, 0, 'no WebGL error'); assert.equal(pixels.contextLost, false);
  assert.ok(pixels.foreground > 100, 'nonempty actual framebuffer');
};
const proofOkay = (proof, minimum) => {
  pixelsOkay(proof.visible); pixelsOkay(proof.hidden); pixelsOkay(proof.restored);
  assert.ok(proof.roi.minDepth > .01 && proof.roi.maxDepth < 100 && proof.roi.minX >= 0 && proof.roi.maxX < proof.visible.width && proof.roi.minY >= 0 && proof.roi.maxY < proof.visible.height, `${proof.key}: unclipped projected contribution bounds`);
  requirePixelContribution(proof.delta, minimum);
  assert.equal(proof.restoreDelta.exactChanged, 0, `${proof.key}: exact frozen-frame restoration`);
};
const cacheOkay = (state, gpu = false) => {
  assert.equal(state.cache.length, 5);
  for (const asset of state.cache) {
    assert.equal(asset.loaded, true, `${asset.key}: registry resource loaded`);
    assert.equal(asset.sameResource, true, `${asset.key}: original shared resource identity`);
    if (gpu) assert.equal(asset.gpuResident, true, `${asset.key}: actual GL buffer/texture survives disposal`);
  }
};
const baseOkay = state => {
  assert.equal(state.engine, '2.22.4'); assert.equal(state.device, 'webgl2'); assert.equal(state.reflection, -1);
  assert.equal(state.avatar.modelState, 'glb'); assert.equal(state.avatar.helper, 'createCharacter');
  assert.equal(state.avatar.representation, 'public-qa-cuboid-proxy'); assert.equal(state.avatar.anatomicalFitValidated, false);
  assert.equal(state.avatar.sha256, FISHING_AVATAR_PROXY.sha256);
  assert.equal(state.canvas.width, state.canvas.cssWidth); assert.equal(state.canvas.height, state.canvas.cssHeight);
  assert.equal(state.captionOverlapsCanvas, false); assert.equal(state.captionOverflow, false);
  assert.equal(state.wardrobe.preserved, true); assert.equal(state.wardrobe.unchanged, true); assert.equal(state.wardrobe.enabled, true);
  assert.equal(state.presentation.failed, false); assert.equal(state.client.lastError, null); cacheOkay(state);
};
const activeOkay = (state, phase, fish = false) => {
  baseOkay(state); assert.equal(state.presentation.phase, phase); assert.equal(state.presentation.attached, true);
  assert.equal(state.presentation.resources.failures, 0); assert.equal(state.grip.present, true); assert.equal(state.grip.dedicated, true);
  assert.ok(state.grip.pointsTowardWater > (fish ? .15 : .6), 'rod points at water despite deliberately different player yaw');
  assert.equal(state.roots, 1); assert.equal(state.models.rod.enabled, true);
  assert.equal(state.models.float.enabled, !fish); assert.equal(state.models.fish.enabled, fish);
  for (const key of ['rod', 'float', 'fish']) {
    assert.equal(state.models[key].surfaces, FISHING_ASSETS[key].surfaces); assert.ok(state.models[key].vertices > 0);
    assert.deepEqual(state.models[key].scale, [.5, .5, .5]);
    assert.equal(state.models[key].sharedMeshes, true); assert.equal(state.models[key].instanceMaterials, true);
  }
};
const detachedOkay = (state, gpu = false) => {
  baseOkay(state); assert.equal(state.presentation.attached, false); assert.equal(state.grip.present, false); assert.equal(state.roots, 0);
  for (const model of Object.values(state.models)) assert.equal(model.present, false);
  assert.equal(state.sprites.ripple, false); assert.equal(state.sprites.splash, false); cacheOkay(state, gpu);
};
let smoke, page, fatal;
const responseChecks = [];
try {
  report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: 5000 }).trim();
  assert.match(report.gitHead, /^[0-9a-f]{40}$/);
  if (process.env.EXPECTED_ASSET_RUNTIME_HEAD) assert.equal(report.gitHead, process.env.EXPECTED_ASSET_RUNTIME_HEAD, 'exact expected candidate commit');
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'apps/world'], { cwd: repo, timeout: 5000, stdio: 'pipe' });
  report.trackedWorldTreeClean = true;
  report.expectedHead = process.env.EXPECTED_ASSET_RUNTIME_HEAD || null;
  report.githubRunId = process.env.GITHUB_RUN_ID || null;
  const provenanceBytes = await readFile(path.join(repo, 'ASSET_PROVENANCE.json'));
  const noticeBytes = await readFile(path.join(repo, 'NOTICE.md'));
  const proxyBytes = await readFile(path.join(repo, FISHING_AVATAR_PROXY.path));
  for (const [relative, bytes] of [['ASSET_PROVENANCE.json', provenanceBytes], ['NOTICE.md', noticeBytes], [FISHING_AVATAR_PROXY.path, proxyBytes]]) {
    assert.equal(hash(bytes), hash(committedBytes(relative)), `${relative}: exact HEAD proxy provenance bytes`);
    report.sourceHashes.push({ path: relative, sha256: hash(bytes), matchesHead: true });
  }
  report.avatarProvenance = validateFishingAvatarProxy({ manifest: JSON.parse(provenanceBytes), notice: noticeBytes.toString('utf8'), sha256: hash(proxyBytes) });
  report.avatarProvenance.sources = ['ASSET_PROVENANCE.json', 'NOTICE.md'];
  const runtimePaths = ['src/activity/fishing-renderer.js', 'src/activity/fishing-visuals.js', 'src/activity/fishing-client.js', 'src/activity/fishing-panel.js',
    'src/activity/fishing-spots.js', 'src/appearance/equipment-asset-loader.js', 'src/appearance/equipment-anchors.js', 'src/character-model.js', 'src/player-dimensions.js', 'src/world-scale.js'];
  for (const relative of runtimePaths) {
    const bytes = await readFile(path.join(repo, 'apps/world', relative));
    assert.equal(hash(bytes), hash(committedBytes(`apps/world/${relative}`)), `${relative}: exact HEAD source bytes`);
    report.sourceHashes.push({ path: `apps/world/${relative}`, sha256: hash(bytes), matchesHead: true });
  }
  for (const [key, spec] of Object.entries(FISHING_ASSETS)) {
    const bytes = await readFile(path.join(repo, 'apps/world', spec.url));
    assert.equal(hash(bytes), hash(committedBytes(`apps/world${spec.url}`)), `${key}: exact HEAD asset bytes`);
    assert.equal(hash(bytes), spec.sha256, `${key}: exact approved original bytes`);
    report.assets.push({ key, url: spec.url, bytes: bytes.length, sha256: hash(bytes) });
  }
  await flush();
  // Explicitly use the existing harness's SwiftShader WebGL2 path, never native GPU fallback retries.
  process.env.WORLD_SMOKE_DISABLE_WEBGPU = '1';
  smoke = await bounded('browser startup', () => startSmoke({ viewport: { width: viewports[0].width, height: viewports[0].height }, contextOptions: { deviceScaleFactor: 1 } }), 35000);
  const html = await readFile(new URL('./fishing-assets-harness.html', import.meta.url), 'utf8');
  const engineUrl = html.match(/"playcanvas":"([^"]+)"/)[1];
  smoke.context.on('request', request => {
    const url = new URL(request.url());
    report.requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(),
      local: url.origin === smoke.origin, pinnedEngine: url.href === engineUrl });
  });
  smoke.context.on('response', response => {
    responseChecks.push((async () => {
      const url = new URL(response.url());
      const receipt = { url: response.url(), status: response.status() };
      if (url.origin === smoke.origin && /^\/(src|assets|data|tests\/browser)\//.test(url.pathname)) {
        const bytes = await response.body(), local = await readFile(path.join(repo, 'apps/world', decodeURIComponent(url.pathname)));
        receipt.bytes = bytes.length; receipt.sha256 = hash(bytes);
        assert.equal(receipt.sha256, hash(committedBytes(`apps/world${decodeURIComponent(url.pathname)}`)), `${url.pathname}: HTTP bytes equal exact HEAD`);
        receipt.matchesHead = true;
        assert.equal(receipt.sha256, hash(local), `${url.pathname}: HTTP bytes equal checked-out bytes`);
      } else if (url.href === engineUrl) {
        const bytes = await response.body(); receipt.bytes = bytes.length; receipt.sha256 = hash(bytes);
        assert.equal(receipt.sha256, hash(await readFile(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url))), 'served pinned PlayCanvas bundle');
      }
      report.responses.push(receipt);
    })().catch(error => { report.errors.push(`HTTP evidence: ${error.message}`); }));
  });
  // Defense in depth: even accidental API requests cannot leave the fixture.
  await smoke.context.route('**/api/**', route => route.abort('blockedbyclient'));
  page = await smoke.context.newPage(); fatal = smoke.watch(page);
  const call = (method, ...args) => bounded(method, () => Promise.race([page.evaluate(async ({ method, args }) => window.__FISHING_ASSETS_QA__[method](...args), { method, args }), fatal]));
  const shot = async name => {
    await call('pixels');
    await bounded(`screenshot ${name}`, () => page.screenshot({ path: path.join(output, `${name}.png`), timeout: 10000 }));
    report.screenshots.push(`${name}.png`);
  };
  await bounded('fixture navigation', () => Promise.race([page.goto(`${smoke.origin}/tests/browser/fishing-assets-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 }), fatal]), 32000);
  await bounded('fixture startup', () => Promise.race([page.waitForFunction(() => window.__FISHING_ASSETS_QA__?.ready || window.__FISHING_ASSETS_QA__?.error, null, { timeout: 20000 }), fatal]), 22000);
  assert.equal(await page.evaluate(() => window.__FISHING_ASSETS_QA__.error), undefined);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const shore of [0, 1]) {
      const name = `${viewport.name}-${shore === 0 ? 'north' : 'south'}`;
      const record = { name, viewport, shore, states: {}, pixelProofs: [] }; report.cases.push(record);
      record.states.waiting = await call('setup', shore); activeOkay(record.states.waiting, 'WAITING');
      assert.ok(Math.abs(record.states.waiting.floatPosition[2] + record.states.waiting.target.z) < 1e-4, 'canonical north maps to rendered negative Z');
      assert.ok(Math.abs(record.states.waiting.floatPosition[1] - record.states.waiting.target.y) < .004, 'float rests on canonical water surface');
      record.waitingPixels = await call('pixels'); pixelsOkay(record.waitingPixels); await shot(`${name}-waiting`);
      for (const [key, minimum] of [['rod', 12], ['float', 3], ['ripple', 4], ['line', 8]]) {
        const proof = await call('proof', key); record.pixelProofs.push(proof);
        proofOkay(proof, minimum);
      }
      record.gripCloseup = await call('gripCloseup'); baseOkay(record.gripCloseup);
      for (const point of [record.gripCloseup.gripScreen, record.gripCloseup.compatibilityWingScreen]) {
        assert.ok(point[0] > 0 && point[0] < record.gripCloseup.canvas.width && point[1] > 0 && point[1] < record.gripCloseup.canvas.height, 'grip and QA proxy compatibility node both visible; no anatomical fit claim');
      }
      record.gripPixels = await call('pixels'); pixelsOkay(record.gripPixels);
      await shot(`${name}-public-qa-proxy-grip-closeup`); await call('overview');
      record.states.closed = await call('close'); detachedOkay(record.states.closed);
      const beforeReopen = await call('pixels'); pixelsOkay(beforeReopen);
      record.states.reopened = await call('reopen'); activeOkay(record.states.reopened, 'WAITING');
      record.reopenPixels = await call('pixels'); assert.equal(record.reopenPixels.hash, record.waitingPixels.hash, 'cached recreation restores actual pixels without recast');
      assert.equal(record.states.reopened.sprites.splash, false);
      await call('tick', 3000, 'BITE'); record.states.bite = await call('tick', 3125, 'BITE SPLASH'); activeOkay(record.states.bite, 'BITE');
      assert.equal(record.states.bite.sprites.splash, true); await shot(`${name}-bite`);
      const splash = await call('proof', 'splash'); record.pixelProofs.push(splash); proofOkay(splash, 4);
      record.states.hookPending = await call('beginHook'); activeOkay(record.states.hookPending, 'BITE'); assert.equal(record.states.hookPending.client.busy, 'hook');
      await shot(`${name}-hook-pending-no-fish`);
      record.states.success = await call('completeHook'); activeOkay(record.states.success, 'RESULT', true);
      await call('tick', 3425, 'CURRENT SUCCESS · REELING');
      const fish = await call('proof', 'fish'); record.pixelProofs.push(fish); proofOkay(fish, 10);
      await shot(`${name}-current-success-reeling`);
      record.states.reeled = await call('tick', 3825, 'CURRENT SUCCESS · SOCKET ATTACHED'); activeOkay(record.states.reeled, 'RESULT', true);
      assert.ok(record.states.reeled.mouthTipDistance < 1e-5, 'actual Catch_Line and Line_Tip coincide');
      record.successPixels = await call('pixels'); pixelsOkay(record.successPixels); await shot(`${name}-current-success`);
      record.states.refreshed = await call('refresh'); activeOkay(record.states.refreshed, 'RESULT', true);
      assert.equal((await call('pixels')).hash, record.successPixels.hash, 'same current result refresh does not replay reeling');
      record.states.resultClosed = await call('close'); detachedOkay(record.states.resultClosed, true);
      record.states.resultReopened = await call('reopen'); detachedOkay(record.states.resultReopened, true);
      record.states.disposed = await call('dispose'); detachedOkay(record.states.disposed, true);
      record.states.replayed = await call('recreate'); detachedOkay(record.states.replayed, true);
      await shot(`${name}-replayed-result-no-fish`);
      // New active attempt: resume after hidden interval already in BITE, without a replay splash.
      await call('setup', shore); record.states.suppressed = await call('suppress', true); detachedOkay(record.states.suppressed, true);
      await call('tick', 3125, 'HIDDEN DURING BITE'); await call('suppress', false); await call('loaded');
      record.states.resumed = await call('stats'); activeOkay(record.states.resumed, 'BITE'); assert.equal(record.states.resumed.sprites.splash, false);
      record.resumePixels = await call('pixels'); pixelsOkay(record.resumePixels); await shot(`${name}-resumed-no-replay`);
      record.states.finalDisposal = await call('dispose'); detachedOkay(record.states.finalDisposal, true);
      record.afterDisposal = await call('pixels'); assert.equal((await call('stats')).lines.length, 0, 'no stale immediate line after disposal');
      await flush(); console.log(`PASS synthetic fishing ${name}`);
    }
  }
  report.syntheticRequests = await call('requests');
  await bounded('HTTP evidence completion', () => Promise.all(responseChecks));
  assert.ok(report.requests.length > 5);
  for (const request of report.requests) {
    assert.equal(request.method, 'GET', 'no network writes, account or reward calls');
    assert.ok(request.local || request.pinnedEngine, `unexpected off-origin request ${request.url}`);
    assert.ok(!new URL(request.url).pathname.startsWith('/api/'), 'no live API calls');
  }
  for (const spec of Object.values(FISHING_ASSETS)) {
    const requests = report.requests.filter(r => new URL(r.url).pathname === spec.url);
    assert.equal(requests.length, 1, `${spec.url}: actual registry cache prevents repeated HTTP fetches across disposal/reopen`);
    assert.ok(report.responses.some(r => new URL(r.url).pathname === spec.url && r.status === 200 && r.sha256 === spec.sha256), `${spec.url}: original HTTP payload receipt`);
  }
  assert.ok(report.responses.some(r => new URL(r.url).pathname === FISHING_AVATAR_PROXY.url && r.status === 200 && r.sha256 === FISHING_AVATAR_PROXY.sha256), 'HTTP-loaded body is the pinned public QA cuboid proxy');
  report.gitHeadAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(report.gitHeadAfter, report.gitHead, 'checkout did not move during evidence capture');
  assert.deepEqual(smoke.problems, []); assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.errors.push(error.stack || String(error)); process.exitCode = 1;
  if (page) try { await bounded('failure screenshot', () => page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }), 6000); report.screenshots.push('failure.png'); } catch { /* primary error retained */ }
} finally {
  if (smoke) {
    report.browserProblems = smoke.problems;
    try { await bounded('browser cleanup', () => smoke.close(), report.limits.cleanupMs); }
    catch (error) { report.status = 'FAIL'; report.errors.push(error.message); process.exitCode = 1; }
  }
  report.elapsedMs = Date.now() - started; await flush(); clearTimeout(watchdog);
}
console.log(`${report.status}: synthetic fishing WebGL2 evidence at ${reportPath}`);
// A failed shared-harness startup can leave an unreturned child-server handle.
// The terminal report must still finish this CI process; hosted job cleanup owns that orphan.
if (report.status !== 'PASS') process.exit(1);
