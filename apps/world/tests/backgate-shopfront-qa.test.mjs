import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as plan from './browser/backgate-shopfront-qa-plan.mjs';
import { PlayerController } from '../src/player-controller.js';
import { BASELINE, CURRENT_MAIN, BASELINE_PATHS, VIEWPORTS, TARGETS, VIEWS, frontOf, cameraFor, expectedRaster, assertHosted } from './browser/backgate-shopfront-qa-plan.mjs';
import { representativeRoutes, runShopfrontWalking } from './browser/backgate-shopfront-walking.mjs';

test('hosted-only guard rejects local or unspecified-head execution', () => {
  for (const env of [{}, { GITHUB_ACTIONS: 'true' }, { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }]) assert.throws(() => assertHosted(env));
  assert.doesNotThrow(() => assertHosted({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', EXPECTED_SHOPFRONT_HEAD: CURRENT_MAIN }));
  const source = readFileSync(new URL('./browser/backgate-shopfront-smoke.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertHosted(process.env)') < source.indexOf("await import('./harness.mjs')"));
});

test('comparison changes only the pinned old geometry/sign files and includes all aspect ratios', () => {
  assert.equal(BASELINE, 'd9cbd3948e4e5acf359313824387dc8695c3e672');
  assert.equal(CURRENT_MAIN, '995364fa5a403fcd290d1bf7357b78f85692c447');
  assert.deepEqual(BASELINE_PATHS, ['/src/back-street-geometry.js', '/src/culture-street-geometry.js', '/src/culture-street-signs.js']);
  assert.deepEqual(VIEWPORTS.map(({ width, height }) => [width, height]), [[1280, 720], [390, 844], [844, 390]]);
  assert.equal(TARGETS.length, 37); assert.equal(new Set(TARGETS.map(q => q.id)).size, 37);
  assert.equal(TARGETS.filter(q => q.id.startsWith('back_street_')).length, 10);
  const source = readFileSync(new URL('./browser/backgate-shopfront-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /git\(\['diff', '--name-only', CURRENT_MAIN, 'HEAD'/);
  assert.doesNotMatch(source, /git\(\['diff', '--name-only', BASELINE, 'HEAD'/);
});


// These are the pinned legacy module shapes used by the adapter. The hosted run
// separately reads and hashes the complete bytes from BASELINE via git show.
const legacyStreet = "export function fillBackStreetBase(b){for(const s of BACK_STREET_SEGMENTS)corridor(b,s.frame,s.road.width);for(const q of BACK_STREET_BLOCKS)building(b,q,q.front);return b;}";
const legacySources = () => new Map([
  [BASELINE_PATHS[0], legacyStreet],
  [BASELINE_PATHS[1], 'export function fillCultureBase(b){return b;}'],
  [BASELINE_PATHS[2], 'export function buildCultureSigns(){}']
]);

test('current integration permits only the exact facade and restoration runtime files', () => {
  assert.equal(typeof plan.assertRuntimeChanges, 'function');
  const allowed = ['back-street-geometry.js', 'culture-street-geometry.js', 'culture-street-signs.js',
    'backgate-shopfront-geometry.js', 'back-alley-geometry.js', 'back-market-geometry.js',
    'backgate-infill-geometry.js', 'campus-road-blockout.js', 'north-side-gate-geometry.js']
    .map(name => `apps/world/src/${name}`);
  assert.deepEqual([...plan.ALLOWED_RUNTIME_PATHS].sort(), allowed.sort());
  assert.doesNotThrow(() => plan.assertRuntimeChanges(allowed));
  for (const forbidden of ['apps/world/data/reality/campus-facilities.json',
    'apps/world/src/back-street-layout.js', 'apps/world/src/culture-street-layout.js',
    'apps/world/src/campus-chunk-renderer.js', 'apps/world/src/campus-material-profile.js',
    'apps/world/src/world-collision.js', 'apps/world/src/player-controller.js',
    'apps/world/src/main.js', 'apps/world/src/not-allowlisted-geometry.js']) {
    assert.throws(() => plan.assertRuntimeChanges([...allowed, forbidden]), /unrelated runtime change/);
  }
});

test('legacy facade adapter preserves current paving and signals without duplicate historical paving', () => {
  assert.equal(typeof plan.comparisonSources, 'function');
  const originals = legacySources(), adapted = plan.comparisonSources(originals);
  assert.deepEqual([...adapted.keys()].sort(), [...BASELINE_PATHS,
    `${BASELINE_PATHS[0]}?shopfront-baseline`, `${BASELINE_PATHS[1]}?shopfront-baseline`].sort());
  for (const [path, names] of [[BASELINE_PATHS[0], ['fillBackStreetBase', 'fillBackStreetNear', 'fillBackStreetDetail']],
    [BASELINE_PATHS[1], ['fillCultureBase', 'fillCultureNear', 'fillCultureDetail']]]) {
    assert.equal(adapted.get(path), `export * from '${path}?shopfront-current';\nexport { ${names.join(', ')} } from '${path}?shopfront-baseline';\n`);
    assert.equal(adapted.has(`${path}?shopfront-current`), false, 'current sources must not be intercepted');
  }
  assert.equal(adapted.get(`${BASELINE_PATHS[0]}?shopfront-baseline`),
    'export function fillBackStreetBase(b){for(const q of BACK_STREET_BLOCKS)building(b,q,q.front);return b;}');
  assert.equal(adapted.get(`${BASELINE_PATHS[1]}?shopfront-baseline`), originals.get(BASELINE_PATHS[1]));
  assert.equal(adapted.get(BASELINE_PATHS[2]), originals.get(BASELINE_PATHS[2]));
  assert.equal(originals.get(BASELINE_PATHS[0]), legacyStreet, 'source provenance remains untouched');
});

test('legacy adapter fails closed if the exact pinned paving statement changes or repeats', () => {
  assert.equal(typeof plan.comparisonSources, 'function');
  for (const street of [legacyStreet.replace('s.road.width', 's.road.width + 1'), legacyStreet + legacyStreet]) {
    const sources = legacySources(); sources.set(BASELINE_PATHS[0], street);
    assert.throws(() => plan.comparisonSources(sources), /exactly one pinned historical paving statement/);
  }
  const missing = legacySources(); missing.delete(BASELINE_PATHS[1]);
  assert.throws(() => plan.comparisonSources(missing), /exact baseline paths/);
  const extra = legacySources(); extra.set('/src/main.js', '');
  assert.throws(() => plan.comparisonSources(extra), /exact baseline paths/);
});

test('diagnostic cameras face both culture sides and the terminal actual local v=1 facade', () => {
  assert.deepEqual(VIEWS.map(v => v.name), ['back-street', 'culture-west', 'culture-east', 'culture-terminal']);
  assert.equal(VIEWS[1].plot.side, 1); assert.equal(VIEWS[2].plot.side, -1);
  assert.ok(Math.abs(frontOf(VIEWS[3].plot) - 1) < 1e-10);
  for (const { plot } of VIEWS) for (const viewport of VIEWPORTS) {
    const plan = cameraFor(plot, viewport), aspect = viewport.width / viewport.height;
    assert.equal(plan.projection, 'orthographic');
    assert.ok([...plan.position, ...plan.target, plan.orthoHeight].every(Number.isFinite));
    assert.ok(plan.orthoHeight * 2 > plot.h);
    assert.ok(plan.orthoHeight * 2 * aspect > plot.w);
    assert.ok(Math.abs(Math.hypot(plan.position[0] - plan.target[0], plan.position[2] - plan.target[2]) - 1.8) < 1e-8);
  }
});

test('mobile raster expectations retain the active LOW 0.8 ratio and separate CSS pixels', () => {
  assert.deepEqual(VIEWPORTS.map(v => expectedRaster(v, { maxPixelRatio: v.name === 'desktop' ? 2 : .8 }, 1)),
    [{ width: 1280, height: 720, ratio: 1 }, { width: 312, height: 675, ratio: .8 }, { width: 675, height: 312, ratio: .8 }]);
  assert.throws(() => expectedRaster(VIEWPORTS[0], { maxPixelRatio: NaN }, 1));
});

function controllerFixture() {
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement'].map(k => [k, globalThis[k]]));
  globalThis.window = { addEventListener() {} };
  globalThis.document = { body: { dataset: {} }, getElementById() { return null; } };
  globalThis.HTMLElement = class {};
  let position = { x: 0, y: 1.15, z: -98 }, rotation = { x: 0, y: 17, z: 0 };
  const player = { getLocalPosition: () => ({ ...position }), setLocalPosition(x, y, z) { position = { x, y, z }; },
    getLocalEulerAngles: () => ({ ...rotation }), setLocalEulerAngles(x, y, z) { rotation = { x, y, z }; } };
  const controller = new PlayerController(player);
  return { player, controller, close() {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  } };
}

test('real controller completes eight capsule-clear forward/reverse facade routes and restores inputs', () => {
  const d = controllerFixture();
  try {
    assert.equal(representativeRoutes(d.controller.groundY).length, 8);
    const position = d.player.getLocalPosition(), rotation = d.player.getLocalEulerAngles();
    const keys = d.controller.keys, touch = d.controller.touchVector;
    keys.add('KeyA'); touch.x = .2; touch.y = .3; d.controller.inputEnabled = false; d.controller.jumpQueued = true;
    const report = runShopfrontWalking(d);
    assert.equal(report.passed, true); assert.equal(report.cases.length, 8); assert.ok(report.totalTicks > 0);
    for (const receipt of report.cases) {
      assert.equal(receipt.passed, true); assert.ok(receipt.ticks > 0); assert.ok(receipt.remaining < .005);
      assert.equal(receipt.trace.length, receipt.ticks + 1); assert.ok(receipt.maxFootError < 1e-6);
    }
    for (const view of VIEWS) assert.deepEqual(report.cases.filter(c => c.area === view.name).map(c => c.direction), ['forward', 'reverse']);
    assert.deepEqual(d.player.getLocalPosition(), position); assert.deepEqual(d.player.getLocalEulerAngles(), rotation);
    assert.equal(d.controller.keys, keys); assert.deepEqual([...keys], ['KeyA']);
    assert.equal(d.controller.touchVector, touch); assert.deepEqual(touch, { x: .2, y: .3 });
    assert.equal(d.controller.inputEnabled, false); assert.equal(d.controller.jumpQueued, true);
  } finally { d.close(); }
});

test('read-only pull-request workflow pins head and preserves full baseline history', () => {
  const source = readFileSync(new URL('../../../.github/workflows/backgate-shopfront-browser.yml', import.meta.url), 'utf8');
  assert.match(source, /pull_request:\s+paths:/); assert.doesNotMatch(source, /pull_request_target|workflow_dispatch|contents: write/);
  assert.match(source, /permissions:\s+contents: read/); assert.match(source, /fetch-depth: 0/);
  assert.match(source, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(source, /persist-credentials: false/); assert.match(source, /backgate-shopfront-null-smoke\.mjs/);
  assert.match(source, /timeout --signal=TERM --kill-after=15s 12m/); assert.match(source, /actions\/upload-artifact@v4/);
});
