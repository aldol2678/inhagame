import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorldSmokeSource } from './browser/harness-source.mjs';
import { compareImmutableBiryongBaseline } from './browser/biryong-control-comparison.mjs';

test('harness resolves the selected immutable app root and validates both import maps and engine pins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'biryong-control-'));
  try {
    const current = join(dir, 'current'), control = join(dir, 'control');
    for (const root of [current, control]) {
      for (const sub of ['campus', 'editor', 'tests/browser']) await mkdir(join(root, sub), { recursive: true });
      await writeFile(join(root, 'tests/browser/package.json'), JSON.stringify({ devDependencies: { playcanvas: '2.22.4' } }));
      for (const page of ['campus', 'editor']) await writeFile(join(root, page, 'index.html'), '"playcanvas": "https://cdn.jsdelivr.net/npm/playcanvas@2.22.4/build/playcanvas.mjs"');
    }
    const options = { defaultWorldRoot: current, samplerPackagePath: join(current, 'tests/browser/package.json') };
    assert.equal((await resolveWorldSmokeSource(options)).worldRoot, current);
    const selected = await resolveWorldSmokeSource({ ...options, worldRoot: control });
    assert.equal(selected.devServer, join(control, 'dev-server.mjs'));
    await writeFile(join(control, 'editor/index.html'), '"playcanvas": "https://cdn.jsdelivr.net/npm/playcanvas@2.21.0/build/playcanvas.mjs"');
    await assert.rejects(resolveWorldSmokeSource({ ...options, worldRoot: control }), /editor.*2.21.0/);
    await writeFile(join(control, 'tests/browser/package.json'), JSON.stringify({ devDependencies: { playcanvas: '2.21.0' } }));
    await assert.rejects(resolveWorldSmokeSource({ ...options, worldRoot: control }), /pin mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
const scene = { viewport: { width: 1280, height: 720, dpr: 1 }, drawingBuffer: { width: 1024, height: 576 },
  renderer: 'WEBGL2', driver: { renderer: 'SwiftShader' }, visible: 'visible', inBiryong: true,
  position: [0, 1, 75], camera: { yaw: 0, pitch: .375, distance: 3.5, firstPerson: false },
  environment: { time: 'DAY', weather: 'CLEAR' }, graphics: { tier: 'low' } };
const environment = { browserVersion: '153.0.8010.12', expectedBrowserVersion: '153.0.8010.12',
  browserRevision: '1243', browserChannel: 'chromium', playwrightVersion: '1.63.0', engineVersion: '2.22.4',
  nodeVersion: 'v24.19.0', platform: 'linux', arch: 'x64', kernel: 'test-kernel', cpuModel: 'test-cpu', cpuCount: 4,
  imageOS: 'ubuntu24', imageVersion: '20261004.327.1', runId: '1', runAttempt: '1', job: 'compare-low-off' };
const receipt = (head, p95Ms) => ({ mode: 'baseline-only', exactHead: head, samplerHead: 'candidate', problems: [],
  environment: structuredClone(environment),
  frameMeasurement: 'browser-animation-frame-interval', status: p95Ms > 85 ? 'INCONCLUSIVE' : 'PASS',
  baseline: { low: { sampleCount: 90, p95Ms, p99Ms: p95Ms, longFrameRate: p95Ms > 85 ? .8 : 0, scene } } });
const options = { expectedMainSha: 'main', expectedCandidateSha: 'candidate' };
test('matching frame numbers cannot pass with different or missing browser environments', () => {
  const main = receipt('main', 20), candidate = receipt('candidate', 22);
  main.environment = { browserVersion: '153.0.8010.12' };
  candidate.environment = { browserVersion: '154.0.8037.57' };
  assert.equal(compareImmutableBiryongBaseline(main, candidate, options).outcome, 'INCONCLUSIVE');
  delete main.environment; delete candidate.environment;
  assert.equal(compareImmutableBiryongBaseline(main, candidate, options).outcome, 'INCONCLUSIVE');
});
test('browser drift, host drift and malformed environment cannot be accepted', () => {
  for (const [key, value] of Object.entries({ browserVersion: '154.0.8037.57', browserChannel: 'chrome',
    browserRevision: '', cpuCount: 0, engineVersion: '', imageVersion: 'different', runId: 'different' })) {
    const main = receipt('main', 20), candidate = receipt('candidate', 22);
    candidate.environment[key] = value;
    assert.equal(compareImmutableBiryongBaseline(main, candidate, options).outcome, 'INCONCLUSIVE', key);
  }
  const main = receipt('main', 20), candidate = receipt('candidate', 22);
  main.environment = {}; candidate.environment = {};
  assert.equal(compareImmutableBiryongBaseline(main, candidate, options).outcome, 'INCONCLUSIVE');
});
test('main control invalid remains INCONCLUSIVE, and main valid/candidate slow is FAIL', () => {
  assert.equal(compareImmutableBiryongBaseline(receipt('main', 550), receipt('candidate', 600), options).outcome, 'INCONCLUSIVE');
  assert.equal(compareImmutableBiryongBaseline(receipt('main', 20), receipt('candidate', 550), options).outcome, 'FAIL');
  assert.equal(compareImmutableBiryongBaseline(receipt('main', 20), receipt('candidate', 22), options).outcome, 'PASS');
});
test('wrong source SHA, missing samples, mismatched scene and sampler never pass', () => {
  assert.equal(compareImmutableBiryongBaseline(null, receipt('candidate', 22), options).outcome, 'INCONCLUSIVE');
  assert.equal(compareImmutableBiryongBaseline(receipt('wrong', 20), receipt('candidate', 22), options).outcome, 'INCONCLUSIVE');
  const changed = structuredClone(receipt('candidate', 22)); changed.baseline.low.scene.camera.yaw = 1;
  assert.equal(compareImmutableBiryongBaseline(receipt('main', 20), changed, options).outcome, 'INCONCLUSIVE');
  changed.baseline.low.scene = scene; changed.samplerHead = 'different';
  assert.equal(compareImmutableBiryongBaseline(receipt('main', 20), changed, options).outcome, 'INCONCLUSIVE');
});

test('missing receipts still produce a comparison JSON and nonzero exit', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'biryong-report-'));
  try {
    const output = join(dir, 'comparison.json');
    const run = spawnSync(process.execPath, [new URL('./browser/biryong-control-report.mjs', import.meta.url).pathname,
      join(dir, 'missing-main.json'), join(dir, 'missing-candidate.json'), output, 'main', 'candidate']);
    assert.equal(run.status, 1);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.outcome, 'INCONCLUSIVE');
    assert.equal(result.passed, false);
    assert.equal(result.readErrors.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('control workflow uses exact immutable source, same runner, LOW-only mode and always artifacts', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../../../.github/workflows/biryong-main-control-browser.yml', import.meta.url), 'utf8');
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /ref: e49419c39d884515f2402a2f3a23fe4c754b8882/);
  assert.match(workflow, /BIRYONG_PERF_MODE: baseline-only/);
  assert.match(workflow, /BIRYONG_PERF_TIERS: low/);
  assert.match(workflow, /name: Upload control receipts and logs\s+if: always\(\)/);
  const harness = await readFile(new URL('./browser/harness.mjs', import.meta.url), 'utf8');
  assert.match(harness, /pinnedPlayCanvas\(worldRoot\)/);
  assert.match(harness, /startServer\(playCanvas\)/);
  assert.match(harness, /cwd: worldRoot/);
});


test('baseline-only collection cannot retain PASS after browser error assertion', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./browser/biryong-performance-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /catch \(error\) \{\s*if \(receipt.status !== 'INCONCLUSIVE'\) receipt.status = 'FAIL';/);
});

test('passing numeric receipts cannot hide a failed measurement process', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'biryong-exit-'));
  try {
    const a = join(dir, 'main.json'), b = join(dir, 'candidate.json'), out = join(dir, 'comparison.json');
    await writeFile(a, JSON.stringify(receipt('main', 20)));
    await writeFile(b, JSON.stringify(receipt('candidate', 22)));
    const script = new URL('./browser/biryong-control-report.mjs', import.meta.url).pathname;
    for (const outcome of ['failure', 'cancelled', 'skipped', '']) {
      const run = spawnSync(process.execPath, [script, a, b, out, 'main', 'candidate'], {
        env: { ...process.env, BIRYONG_CONTROL_MAIN_OUTCOME: outcome, BIRYONG_CONTROL_CANDIDATE_OUTCOME: 'success' }
      });
      assert.equal(run.status, 1, outcome);
      const report = JSON.parse(await readFile(out, 'utf8'));
      assert.equal(report.passed, false); assert.equal(report.outcome, 'INCONCLUSIVE');
    }
    const run = spawnSync(process.execPath, [script, a, b, out, 'main', 'candidate'], {
      env: { ...process.env, BIRYONG_CONTROL_MAIN_OUTCOME: 'success', BIRYONG_CONTROL_CANDIDATE_OUTCOME: 'success' }
    });
    assert.equal(run.status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
