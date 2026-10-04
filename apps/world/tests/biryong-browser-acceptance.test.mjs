// Node-only contracts: this test must never import Playwright or start a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const helperUrl = new URL('./browser/biryong-map-guidance-qa.mjs', import.meta.url);
const smokeUrl = new URL('./browser/biryong-map-guidance-smoke.mjs', import.meta.url);
const workflowUrl = new URL('../../../.github/workflows/biryong-map-guidance-browser.yml', import.meta.url);

test('hosted acceptance guard rejects local and self-hosted environments without browser imports', async () => {
  const { assertHostedBrowserExecution } = await import(helperUrl);
  assert.throws(() => assertHostedBrowserExecution({}), /GitHub-hosted/);
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }), /GitHub-hosted/);
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'push' }), /pull_request/);
  // Pure validation only; no accepted environment is applied to process.env or a subprocess.
  assert.throws(() => assertHostedBrowserExecution({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'pull_request' }), /exact PR head/);
});

test('required viewport and public NPC cases are explicit and complete', async () => {
  const { BIRYONG_QA_VIEWPORTS, BIRYONG_QA_NPCS } = await import(helperUrl);
  assert.deepEqual(BIRYONG_QA_VIEWPORTS.map(v => [v.name, v.viewport.width, v.viewport.height, v.mobile]), [
    ['desktop', 1280, 720, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true]
  ]);
  assert.deepEqual(BIRYONG_QA_NPCS.map(n => [n.id, n.name, n.topicId]), [
    ['BR_NPC_001', '강소라', 'work'], ['BR_NPC_003', '남이솔', 'map'], ['BR_NPC_006', '한세온', 'craft']
  ]);
  const { biryongDialogueDestinations } = await import('../src/biryong/biryong-dialogue-guidance.js');
  for (const npc of BIRYONG_QA_NPCS) assert.ok(biryongDialogueDestinations(npc.id, npc.topicId).includes(npc.target));
});

test('actual map receipt keeps CSS percentages separate from DOMRect viewport pixels', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  // Execute only the pure DOM serializer in a tiny Node fixture. Never import the
  // guarded browser entrypoint or fabricate a hosted environment.
  const start = source.indexOf('async function readMap(page) {');
  const end = source.indexOf('\nasync function inspectRoute(page) {', start);
  assert.ok(start >= 0 && end > start);
  const rect = { x: 618, y: 558.4375, left: 618, top: 558.4375, right: 662, bottom: 602.4375, width: 44, height: 44 };
  const element = { hidden: true, children: [], getBoundingClientRect: () => ({ toJSON: () => ({ ...rect }) }) };
  const poi = { ...element, dataset: { poiId: 'poi.biryong-realm.station', presentation: 'NORMAL' },
    style: { left: '50%', top: '78.9318%' }, querySelector: () => ({ getAttribute: () => 'M0 0L1 1' }) };
  const root = { ...element, querySelector: () => element,
    querySelectorAll: selector => selector === '.full-map-poi' ? [poi] : [] };
  const document = { getElementById: id => id === 'full-map-panel' ? root : element, querySelectorAll: () => [] };
  const readMap = vm.runInNewContext(`(${source.slice(start, end).trim()})`, { document, innerWidth: 1280, innerHeight: 720 });
  const receipt = await readMap({ evaluate: callback => callback() });
  const node = receipt.pois[0];
  assert.equal(node.mapPositionPercent?.left, 50, 'CSS percentage must survive a DOMRect left property');
  assert.equal(node.mapPositionPercent?.top, 78.9318, 'serialized CSS percentage must survive a DOMRect top property');
  assert.equal(node.left, rect.left, 'screen geometry remains available in its original pixel units');
  assert.equal(node.top, rect.top);
  assert.match(source, /assertMapPointProjection\(node, poi\.position, b\)/);
  const { assertMapPointProjection } = await import(helperUrl);
  const { createBiryongMapDataSource, BIRYONG_MAP_DESTINATIONS } = await import('../src/biryong/biryong-map-data.js');
  const station = BIRYONG_MAP_DESTINATIONS.find(poi => poi.poiId === node.id), bounds = createBiryongMapDataSource().bounds;
  assert.doesNotThrow(() => assertMapPointProjection(node, station.position, bounds), 'normal CSSOM rounding is subpixel');
  assert.throws(() => assertMapPointProjection({ ...node, mapPositionPercent: { left: rect.left, top: rect.top } }, station.position, bounds), /local X source/);
  assert.throws(() => assertMapPointProjection({ ...node, mapPositionPercent: { left: 50, top: 78.94 } }, station.position, bounds), /local Z source/);
});

test('normal captures wait for hidden transition overlays and subsequent real frames', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  const start = source.indexOf('function readTransitionVisualState(');
  const end = source.indexOf('\nasync function state(page) {', start);
  assert.ok(start >= 0 && end > start, 'a read-only transition diagnostic is required');
  const overlay = { hidden: false, className: 'space-fade on' };
  const diagnostics = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    document: { getElementById: () => overlay },
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', opacity: el.hidden ? '0' : '1', visibility: 'visible' })
  });
  assert.equal(diagnostics(true), false, 'nonblank framebuffer cannot bypass a visible black DOM overlay');
  assert.equal(diagnostics()[0].hidden, false);
  assert.equal(diagnostics()[0].opacity, '1');
  overlay.hidden = true; overlay.className = 'space-fade';
  assert.equal(diagnostics(true), true);
  assert.match(source, /waitForFunction\(readTransitionVisualState, true, \{ timeout: 15000 \}\)/);
  assert.match(source, /await page\.evaluate\(waitForRenderedFrames\)/);
  assert.match(source, /capture\('failure', \{ settled: false \}\)/, 'failure screenshots retain the actual obstructed state');
  assert.doesNotMatch(source, /reducedMotion:|spaceFade\.hidden\s*=|spaceFade\.classList\.(?:add|remove)/);
});

test('browser import is guarded and actual production owners are retained', async () => {
  const source = await readFile(smokeUrl, 'utf8');
  const guard = source.indexOf('assertHostedBrowserExecution(process.env)');
  const browserImport = source.indexOf("await import('./harness.mjs')");
  assert.ok(guard >= 0 && browserImport > guard, 'hosted guard must run before importing the existing browser harness');
  assert.doesNotMatch(source, /import\s*\{[^}]*startSmoke[^}]*\}\s*from/);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]+\s*=/, 'never spoof the hosted environment');
  assert.doesNotMatch(source, /\.setDataSource\s*\(|\.app\.off\s*\(|new\s+PlayerController|NullGraphicsDevice/);
  assert.match(source, /actorSnapshot/);
  assert.match(source, /nearestNpc/);
  assert.match(source, /biryongRealm\.enter\(\)/);
  assert.match(source, /biryong-station-transit/);
  assert.match(source, /SHA256SUMS/);
  assert.match(source, /PENDING_INDEPENDENT_PIXEL_REVIEW/);
});

test('workflow uses a read-only token, exact PR head and failure artifacts', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /(?:pull_request_target|contents: write|id-token: write|secrets\.)/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /EXPECTED_BIRYONG_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /timeout --signal=TERM --kill-after=10s/);
  assert.match(source, /fonts-noto-cjk/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /if-no-files-found: error/);
});
