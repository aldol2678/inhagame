// Node-only contracts: this test must never import Playwright or start a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
