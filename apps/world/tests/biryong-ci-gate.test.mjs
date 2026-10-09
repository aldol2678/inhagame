import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBiryongSamples } from './browser/biryong-performance-diagnostics.mjs';
import { compareImmutableBiryongBaseline } from './browser/biryong-control-comparison.mjs';
import { gateBiryongControl, gateBiryongVisual } from './browser/biryong-ci-gate.mjs';

const scene = {
  viewport: { width: 1280, height: 720, dpr: 1 }, drawingBuffer: { width: 1024, height: 576 },
  renderer: 'WebGL2', driver: { renderer: 'ANGLE (SwiftShader Device)' },
  visible: 'visible', inBiryong: true, position: [0, 1.15, 75],
  camera: { yaw: 0, pitch: .375, distance: 3.5, firstPerson: false },
  environment: { time: 'DAY', weather: 'CLEAR' }, graphics: { tier: 'low' }
};
const sample = (p95Ms, invalid = true) => ({
  sampleCount: 90, p95Ms, p99Ms: p95Ms, longFrameRate: invalid ? .8 : 0,
  scene, validity: { validForComparison: !invalid, outcome: invalid ? 'INCONCLUSIVE' : 'VALID' }
});
const receipt = (head, p95Ms, invalid = true) => ({
  mode: 'baseline-only', exactHead: head, samplerHead: 'candidate',
  status: invalid ? 'INCONCLUSIVE' : 'PASS', completedAt: '2026-10-09T10:00:00Z',
  frameMeasurement: 'browser-animation-frame-interval', progress: [{ state: 'DONE' }],
  problems: [], baseline: { low: sample(p95Ms, invalid) }
});
const report = (a, b, aOutcome = 'failure', bOutcome = 'failure') => {
  const r = compareImmutableBiryongBaseline(a, b, {
    expectedMainSha: 'main', expectedCandidateSha: 'candidate'
  });
  r.readErrors = [];
  r.measurementOutcomes = { main: aOutcome, candidate: bOutcome };
  for (const [label, outcome] of Object.entries(r.measurementOutcomes)) {
    if (outcome !== 'success') {
      r.errors.push(`${label}: measurement process outcome ${outcome}`);
      r.outcome = 'INCONCLUSIVE';
      r.passed = false;
    }
  }
  return r;
};

test('real SwiftShader LOW baseline inadequacy stays INCONCLUSIVE, not PASS', () => {
  const outcome = gateBiryongControl(report(receipt('main', 550), receipt('candidate', 600)));
  assert.equal(outcome.outcome, 'INCONCLUSIVE');
  assert.equal(outcome.ok, true);
  assert.match(outcome.reason, /budget/);
});

test('invalid source identity, scene mismatch, missing receipt and crash all FAIL closed', () => {
  const a = receipt('main', 550), b = receipt('candidate', 600);
  const wrongSha = structuredClone(b); wrongSha.exactHead = 'forged';
  assert.equal(gateBiryongControl(report(a, wrongSha)).outcome, 'FAIL');
  const badScene = structuredClone(b); badScene.baseline.low.scene.camera.yaw = 100;
  assert.equal(gateBiryongControl(report(a, badScene)).outcome, 'FAIL');
  assert.equal(gateBiryongControl(report(null, b)).outcome, 'FAIL');
  const crashed = structuredClone(b); crashed.problems.push('pageerror: crash');
  assert.equal(gateBiryongControl(report(a, crashed)).outcome, 'FAIL');
  const incomplete = structuredClone(a); delete incomplete.completedAt;
  assert.equal(gateBiryongControl(report(incomplete, b)).outcome, 'FAIL');
});

test('valid numeric performance regression is a hard FAIL, never diagnostic-only', () => {
  const a = receipt('main', 20, false), b = receipt('candidate', 550);
  assert.equal(compareImmutableBiryongBaseline(a, b, {
    expectedMainSha: 'main', expectedCandidateSha: 'candidate'
  }).outcome, 'FAIL');
  assert.equal(gateBiryongControl(report(a, b, 'success', 'failure')).outcome, 'FAIL');
  assert.equal(gateBiryongControl(report(a, receipt('candidate', 22, false), 'success', 'success')).outcome, 'PASS');
});

const visualReceipt = () => {
  const baseline = sample(550), visual = sample(600);
  const assessment = classifyBiryongSamples({ tier: 'low', baseline, visual });
  return {
    mode: 'visual-comparison', exactHead: 'head', status: 'INCONCLUSIVE',
    completedAt: '2026-10-09T10:00:00Z', progress: [{ state: 'DONE' }],
    problems: [], baseline: { low: baseline },
    error: 'Error: low INCONCLUSIVE: Baseline cannot sustain the unchanged CI surrogate budget',
    desktop: { low: { visual, scene, sceneComparable: true,
      structural: { withinBudget: true }, monitor: { active: true }, assessment } }
  };
};
test('visual smoke software-only timeout of usable performance is diagnostic, not acceptance', () => {
  assert.equal(gateBiryongVisual(visualReceipt(), 'failure', 'head').outcome, 'INCONCLUSIVE');
  const failed = visualReceipt();
  failed.error = 'Error: browser crashed';
  assert.equal(gateBiryongVisual(failed, 'failure', 'head').outcome, 'FAIL');
  assert.equal(gateBiryongVisual(visualReceipt(), 'cancelled', 'head').outcome, 'FAIL');
  assert.equal(gateBiryongVisual(visualReceipt(), 'failure', 'wrong-head').outcome, 'FAIL');
  const browserProblem = visualReceipt(); browserProblem.problems.push('render error');
  assert.equal(gateBiryongVisual(browserProblem, 'failure', 'head').outcome, 'FAIL');
  const fakePass = visualReceipt(); fakePass.status = 'PASS';
  assert.equal(gateBiryongVisual(fakePass, 'success', 'head').outcome, 'FAIL');
});

test('optimizer no longer blocks later asset gates on Biryong performance and heavy profiling is manual', async () => {
  const { readFile } = await import('node:fs/promises');
  const optimizer = await readFile(new URL('../../../.github/workflows/world-asset-optimizer.yml', import.meta.url), 'utf8');
  const control = await readFile(new URL('../../../.github/workflows/biryong-main-control-browser.yml', import.meta.url), 'utf8');
  const visual = await readFile(new URL('../../../.github/workflows/biryong-visual-performance-diagnostics.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(optimizer, /Run Biryong visual performance smoke/);
  assert.match(optimizer, /Run asset authority canary smoke/);
  assert.doesNotMatch(control, /'apps\/world\/\*\*'/);
  assert.match(control, /biryong-ci-gate\.mjs control/);
  assert.match(control, /cancel-in-progress: true/);
  assert.match(visual, /workflow_dispatch:/);
  assert.doesNotMatch(visual, /pull_request:/);
  assert.match(visual, /biryong-ci-gate\.mjs visual/);
});
