import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveGraphicsFailureArtifacts, closeGraphicsSmokeAfterSave, withGraphicsDeadline } from './browser/graphics-failure-artifact.mjs';

const never = () => new Promise(() => {});
const readReport = async output => JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
const readReportSync = output => JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
const failingReceipt = () => ({ status: 'FAIL', error: 'need actual rendered frames',
  checks: { framePacing: { renders: 0, updates: 0 } }, screenshots: [], problems: ['renderer stalled'] });
async function fixture(t) {
  const output = await mkdtemp(join(tmpdir(), 'graphics-failure-'));
  t.after(() => rm(output, { recursive: true }));
  return output;
}

test('hung diagnostic and screenshot cannot prevent the failure receipt or erase pacing evidence', async t => {
  const output = await fixture(t), receipt = failingReceipt();
  let rejectDiagnostic, rejectScreenshot;
  const page = {
    evaluate: () => {
      const saved = readReportSync(output);
      assert.equal(saved.error, receipt.error);
      assert.deepEqual(saved.checks, receipt.checks);
      return new Promise((_, reject) => { rejectDiagnostic = reject; });
    },
    screenshot: () => {
      assert.equal(readReportSync(output).failureDiagnostics.reason, 'evaluation-timeout');
      return new Promise((_, reject) => { rejectScreenshot = reject; });
    }
  };
  await saveGraphicsFailureArtifacts(page, output, receipt, { timeoutMs: 30 });
  const saved = await readReport(output);
  assert.equal(saved.status, 'FAIL');
  assert.equal(saved.error, 'need actual rendered frames');
  assert.deepEqual(saved.checks.framePacing, { renders: 0, updates: 0 });
  assert.deepEqual(saved.problems, ['renderer stalled']);
  assert.deepEqual(saved.failureDiagnostics, { status: 'unavailable', reason: 'evaluation-timeout' });
  assert.equal(saved.captureError, 'failure screenshot timeout');
  assert.deepEqual(saved.screenshots, []);
  rejectDiagnostic(new Error('late diagnostic rejection'));
  rejectScreenshot(new Error('late screenshot rejection'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await readReport(output), saved);
});

test('responsive failure diagnostics and screenshot are collected after the initial report', async t => {
  const output = await fixture(t), receipt = failingReceipt();
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  globalThis.window = { __INHAGAME_P0__: {
    app: { autoRender: false, renderNextFrame: true, graphicsDevice: { contextLost: true } },
    getStatus: () => ({ renderer: 'WebGL2', graphics: { frameLimit: 30 } })
  } };
  globalThis.document = { visibilityState: 'visible' };
  try {
    await saveGraphicsFailureArtifacts({
      evaluate: async fn => { assert.equal((await readReport(output)).status, 'FAIL'); return fn(); },
      screenshot: async ({ path }) => { await writeFile(path, 'test screenshot'); }
    }, output, receipt);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
  const saved = await readReport(output);
  assert.deepEqual(saved.screenshots, ['failure.png']);
  assert.deepEqual(saved.failureDiagnostics, { status: 'collected', data: {
    visibility: 'visible', contextLost: true, autoRender: false, renderNextFrame: true,
    renderer: 'WebGL2', graphics: { frameLimit: 30 }
  } });
  assert.equal(await readFile(join(output, 'failure.png'), 'utf8'), 'test screenshot');
  assert.equal(saved.captureError, undefined);
});

test('rejected diagnostics and screenshot retain the primary assertion without private browser errors', async t => {
  const output = await fixture(t), receipt = failingReceipt();
  await saveGraphicsFailureArtifacts({
    evaluate: async () => { throw new Error('private diagnostic URL'); },
    screenshot: async () => { throw new Error('private screenshot URL'); }
  }, output, receipt);
  const saved = await readReport(output);
  assert.equal(saved.error, receipt.error);
  assert.deepEqual(saved.failureDiagnostics, { status: 'unavailable', reason: 'evaluation-failed' });
  assert.equal(saved.captureError, 'failure screenshot failed');
  assert.doesNotMatch(JSON.stringify(saved), /private/);
});

test('launch failure without a page still writes its report', async t => {
  const output = await fixture(t), receipt = failingReceipt();
  await saveGraphicsFailureArtifacts(undefined, output, receipt);
  assert.deepEqual(await readReport(output), receipt);
});

test('normal cleanup follows the initial save and never calls owned abort or force-exit', async () => {
  const calls = [];
  const cleanup = await closeGraphicsSmokeAfterSave({
    close: async () => { calls.push('close'); }, abort: () => { assert.fail('abort on successful close'); }
  }, async state => { calls.push(state ? state.close : 'save'); }, {
    forceExit: () => assert.fail('force exit on successful close')
  });
  assert.deepEqual(calls, ['save', 'close', 'complete']);
  assert.deepEqual(cleanup, { close: 'complete' });
});

test('hung normal cleanup is recorded before bounded owned abort', async t => {
  const output = await fixture(t), receipt = failingReceipt(), calls = [];
  const save = async cleanup => {
    if (cleanup) receipt.cleanup = cleanup;
    await writeFile(join(output, 'report.json'), JSON.stringify(receipt));
  };
  const cleanup = await closeGraphicsSmokeAfterSave({
    close: () => { calls.push('close'); assert.equal(readReportSync(output).status, 'FAIL'); return never(); },
    abort: () => { calls.push('abort'); assert.equal(readReportSync(output).cleanup.close, 'timeout'); }
  }, save, { timeoutMs: 30, forceExit: () => assert.fail('owned abort completed') });
  assert.deepEqual(calls, ['close', 'abort']);
  assert.deepEqual(cleanup, { close: 'timeout', abort: 'complete' });
  assert.deepEqual((await readReport(output)).cleanup, cleanup);
});

for (const closeOutcome of ['timeout', 'failed']) test(`close ${closeOutcome} and abort timeout force a nonzero exit only after the final durable receipt`, async t => {
  const output = await fixture(t), receipt = failingReceipt(), calls = [];
  const save = async cleanup => {
    if (cleanup) receipt.cleanup = cleanup;
    await writeFile(join(output, 'report.json'), JSON.stringify(receipt));
  };
  let finalAtExit;
  const cleanup = await closeGraphicsSmokeAfterSave({
    close: () => {
      calls.push('close');
      if (closeOutcome === 'failed') throw new Error('normal close failed');
      return never();
    },
    abort: () => { calls.push('abort'); return never(); }
  }, save, { timeoutMs: 10, forceExit: code => {
    calls.push(`exit:${code}`); finalAtExit = readReportSync(output);
  } });
  assert.deepEqual(calls, ['close', 'abort', 'exit:1']);
  assert.deepEqual(cleanup, { close: closeOutcome, abort: 'timeout' });
  assert.deepEqual(finalAtExit.cleanup, cleanup);
  assert.equal(finalAtExit.status, 'FAIL');
  assert.equal(finalAtExit.error, 'need actual rendered frames');
});

for (const closeOutcome of ['timeout', 'failed']) test(`close ${closeOutcome} followed by abort rejection triggers no forced exit`, async () => {
  const cleanup = await closeGraphicsSmokeAfterSave({
    close: closeOutcome === 'failed' ? async () => { throw new Error('close failed'); } : never,
    abort: async () => { throw new Error('abort failed'); }
  }, async () => {}, { timeoutMs: 5, forceExit: () => assert.fail('abort did not hang') });
  assert.deepEqual(cleanup, { close: closeOutcome, abort: 'failed' });
});

test('a receipt write failure prevents forced exit', async () => {
  let writes = 0;
  await assert.rejects(closeGraphicsSmokeAfterSave({ close: never, abort: never }, async () => {
    if (++writes === 3) throw new Error('disk full');
  }, { timeoutMs: 5, forceExit: () => assert.fail('receipt was not durable') }), /disk full/);
});

test('Node deadline rejects a hung renderer operation and handles its late rejection', async () => {
  let rejectOperation;
  await assert.rejects(withGraphicsDeadline(() => new Promise((_, reject) => { rejectOperation = reject; }), 5, 'rendered frame sample'),
    error => error.code === 'GRAPHICS_OPERATION_TIMEOUT' && /rendered frame sample/.test(error.message));
  rejectOperation(new Error('late page failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await withGraphicsDeadline(() => 42, 50, 'immediate'), 42);
});
