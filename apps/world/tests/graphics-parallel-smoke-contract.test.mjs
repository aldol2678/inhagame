import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { withGraphicsDeadline, closeGraphicsSmokeAfterSave } from './browser/graphics-failure-artifact.mjs';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [smoke, main, campus, harness] = await Promise.all([
  read('./browser/graphics-parallel-smoke.mjs'), read('../src/main.js'),
  read('../campus/index.html'), read('./browser/harness.mjs')
]);
test('pacing evidence is attached before unchanged acceptance assertions', () => {
  const sample = smoke.indexOf('const pacing = await renderedSample();');
  const attach = smoke.indexOf('receipt.checks.framePacing = pacing;', sample);
  const assertion = smoke.indexOf("assert.ok(pacing.renders > 2, 'need actual rendered frames');", sample);
  assert.ok(sample >= 0 && attach > sample && assertion > attach);
  assert.ok(smoke.includes("assert.ok(pacing.updates >= pacing.renders"));
  assert.ok(smoke.includes("assert.ok(pacing.renderedFps <= 34"));
});
test('pacing sampler retains start/end state and raw counts without changing its 2500 ms window', async () => {
  const source = smoke.match(/async function renderedSample\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const listeners = new Map();
  const app = { autoRender: false, renderNextFrame: true, graphicsDevice: { contextLost: false },
    on: (name, fn) => listeners.set(name, fn), off: name => listeners.delete(name) };
  const document = { visibilityState: 'visible' };
  let elapsed = 0, deadline, complete;
  const resultPromise = runInNewContext(`(${source})()`, {
    window: { __INHAGAME_P0__: { app } }, document,
    page: { evaluate: fn => fn() }, performance: { now: () => elapsed },
    withGraphicsDeadline, TIMEOUT_MS: 100,
    setTimeout: (fn, ms) => { complete = fn; deadline = ms; }
  });
  await Promise.resolve();
  assert.equal(deadline, 2500);
  listeners.get('update')(); listeners.get('postrender')();
  document.visibilityState = 'hidden'; app.graphicsDevice.contextLost = true;
  app.autoRender = true; app.renderNextFrame = false; elapsed = 2500; complete();
  const result = JSON.parse(JSON.stringify(await resultPromise));
  assert.deepEqual(result.startState, { visibility: 'visible', contextLost: false, autoRender: false, renderNextFrame: true });
  assert.deepEqual(result.endState, { visibility: 'hidden', contextLost: true, autoRender: true, renderNextFrame: false });
  assert.equal(result.renders, 1); assert.equal(result.updates, 1);
  assert.equal(result.elapsedMs, 2500); assert.equal(result.renderedFps, .4);
  assert.equal(listeners.size, 0);
});
test('graphics smoke parses without launching browser', () => {
  const result = spawnSync(process.execPath, ['--check', new URL('./browser/graphics-parallel-smoke.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('mock clock replaces exactly one construction seam and retains offline harness', () => {
  assert.equal(main.split('const worldClock = previewHost ? null : createNpcWorldClock();').length, 2);
  assert.match(smoke, /from '\.\/harness\.mjs'/);
  assert.match(smoke, /main\.replace\(needle/);
  assert.match(harness, /route\.abort\("blockedbyclient"\)/);
  assert.match(harness, /supabase-js stubbed/);
});
test('all fixed smoke ID selectors exist exactly once in campus markup', () => {
  const ids = new Set([...smoke.matchAll(/locator\('#([\w-]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size >= 10);
  for (const id of ids) assert.equal(campus.split(`id="${id}"`).length, 2, id);
});
test('smoke covers four workstreams, saves failure receipts and labels CI surrogate', () => {
  for (const marker of ['checks.settings', 'checks.framePacing', 'checks.contact', 'checks.daylight', 'checks.biryong',
    "receipt.status = 'FAIL'", 'report.json', "realDevice: false", 'CI_BROWSER_SURROGATE'])
    assert.ok(smoke.includes(marker), marker);
  assert.match(smoke, /app\.on\('postrender', render\)/);
  assert.match(smoke, /app\.off\('postrender', render\)/);
  assert.match(smoke, /returnToCampus\(\)/);
});
test('settings dismissal checks ownership and native movement without forcibly releasing claims', () => {
  for (const marker of ['beforeFocus.owners.viewSettings, false', "beforeFocus.topOwners.includes('view-settings')",
    'beforeFocus.movement, true', "page.keyboard.down('w')", "page.keyboard.up('w')",
    "verifyMovementRestored('after-detail-controls')", "verifyMovementRestored('after-reset-and-quality')"])
    assert.ok(smoke.includes(marker), marker);
  assert.doesNotMatch(smoke, /inputFocus\.(?:release|clear)|controller\.setInputEnabled\(true\)/);
});
test('contact screenshots target an actual canonical garden receiver and restore temporary camera', async () => {
  const {campusBaseContactGeometry}=await import('../src/campus-contact-shading-layout.js');
  const {GARDEN_BENCHES}=await import('../src/library-garden-layout.js');
  const id=GARDEN_BENCHES[0].id;
  assert.ok(campusBaseContactGeometry().sources.some(s=>s.id===id&&s.receivers.includes('garden')));
  for(const marker of ['contact.activeMeshes>0', "b.name==='campus_contact_base'", 'source.id===view.benchId',
    'assert.deepEqual(await cameraState(),onCamera', "findByName('GraphicsContactQaCamera')?.destroy()",
    'd.player.enabled=s.playerEnabled', 'camera.enabled=s.cameraEnabled', "app.once('postrender',rendered)"])
    assert.ok(smoke.includes(marker),marker);
});
test('launch failures reach receipt finally and region return asserts visual settings', () => {
  assert.match(smoke, /try \{\n  if \(process\.env\.EXPECTED_GRAPHICS_HEAD\) assert\.equal[^\n]+\n  smoke = await startSmoke/);
  assert.ok(smoke.includes('smoke?.problems ?? []')); assert.ok(smoke.includes('await closeGraphicsSmokeAfterSave(smoke,'));
  assert.ok(smoke.includes('assert.equal(restored.canvasFilter,campusPresentation.canvasFilter'));
  assert.ok(smoke.includes('assert.equal(restored.toneMapping,campusPresentation.toneMapping'));
});

test('graphics browser QA runs independently of optimizer performance gates on the exact PR head', async () => {
  const workflow = await read('../../../.github/workflows/graphics-integration-browser.yml');
  const optimizer = await read('../../../.github/workflows/world-asset-optimizer.yml');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /EXPECTED_GRAPHICS_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(workflow, /needs:|continue-on-error|secrets\.|pull_request_target/);
  assert.doesNotMatch(optimizer, /run: node apps\/world\/tests\/browser\/graphics-parallel-smoke.mjs/);
  assert.match(smoke, /execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(smoke, /assert.equal\(receipt.exactHead, process.env.EXPECTED_GRAPHICS_HEAD/);
});

// Exercise the actual failure tail without a renderer. A never-settling failure
// screenshot must not prevent the existing diagnostic receipt from being saved.
test('failure receipt is durable before failure-page capture can hang', async () => {
  const tail = smoke.slice(smoke.lastIndexOf('} catch (error) {'), smoke.indexOf("\nconsole.log(`graphics parallel smoke:"));
  assert.ok(tail.startsWith('} catch (error) {'));
  const saved = [];
  let captureStarted = false;
  const receipt = { checks: { framePacing: { renders: 0 } }, screenshots: [] };
  const pending = runInNewContext(`(async () => { try { throw Error('render count failed'); ${tail} })()`, {
    receipt, output: '/diagnostic-output', page: {},
    smoke: { problems: ['renderer stopped'], close: async () => {} },
    shot: () => { captureStarted = true; return new Promise(() => {}); },
    writeFile: async (_path, json) => { saved.push(JSON.parse(json)); },
    saveGraphicsFailureArtifacts: async (_page, _output, value) => {
      saved.push(JSON.parse(JSON.stringify(value)));
      captureStarted = true;
      return new Promise(() => {});
    }
  });
  pending.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(captureStarted, true);
  assert.equal(saved.length, 1, 'report must exist before a browser capture can stall');
  assert.equal(saved[0].status, 'FAIL');
  assert.equal(saved[0].checks.framePacing.renders, 0);
  assert.deepEqual(saved[0].problems, ['renderer stopped']);
});

test('a hung rendered-frame sample is bounded in Node without an in-page timer reply', async () => {
  const source = smoke.match(/async function renderedSample\(\) \{[\s\S]*?\n\}/)?.[0];
  const pending = runInNewContext(`(${source})()`, {
    page: { evaluate: () => new Promise(() => {}) }, withGraphicsDeadline, TIMEOUT_MS: 5
  });
  const result = await Promise.race([
    pending.then(() => 'completed', error => error.code),
    new Promise(resolve => setTimeout(() => resolve('still waiting for browser'), 50))
  ]);
  assert.equal(result, 'GRAPHICS_OPERATION_TIMEOUT');
});

for (const [code, startupCleanup, shouldExit] of [
  ['SMOKE_STARTUP_TIMEOUT', 'not-started', true],
  [undefined, 'failed', true],
  [undefined, 'timeout', true],
  [undefined, 'complete', false],
  [undefined, undefined, false]
]) test(`startup ${code ?? 'rejection'} with cleanup ${startupCleanup ?? 'unset'} persists before exit decision`, async () => {
  const tail = smoke.slice(smoke.lastIndexOf('} catch (error) {'), smoke.indexOf("\nconsole.log(`graphics parallel smoke:"));
  const originalError = Object.assign(new Error('startup failed'), { code, startupCleanup });
  const saved = [], exits = [];
  const receipt = { checks: {}, screenshots: [] };
  const pending = runInNewContext(`(async () => { try { throw originalError; ${tail} })()`, {
    originalError, receipt, output: '/diagnostic-output', smoke: null, page: undefined,
    closeGraphicsSmokeAfterSave,
    saveGraphicsFailureArtifacts: async (_page, _output, value) => { saved.push(JSON.parse(JSON.stringify(value))); },
    writeFile: async (_path, json) => { saved.push(JSON.parse(json)); },
    process: { exit: code => {
      assert.ok(saved.length >= 2, 'initial and final failure receipts must be saved');
      assert.equal(saved.at(-1).status, 'FAIL');
      assert.equal(saved.at(-1).startupCleanup, startupCleanup);
      exits.push(code);
    } }
  });
  await assert.rejects(pending, error => error === originalError);
  assert.deepEqual(exits, shouldExit ? [1] : []);
  assert.equal(saved.at(-1).status, 'FAIL');
});
