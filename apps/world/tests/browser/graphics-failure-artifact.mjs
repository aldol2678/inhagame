import { writeFile } from 'node:fs/promises';

// Node owns this deadline: an in-page timer cannot rescue a stopped renderer.
export async function withGraphicsDeadline(operation, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs} ms`);
        error.code = 'GRAPHICS_OPERATION_TIMEOUT';
        reject(error);
      }, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

async function bounded(operation, timeoutMs) {
  try { return { outcome: 'complete', value: await withGraphicsDeadline(operation, timeoutMs, 'graphics diagnostic') }; }
  catch (error) { return { outcome: error?.code === 'GRAPHICS_OPERATION_TIMEOUT' ? 'timeout' : 'failed' }; }
}

// Save the assertion and any completed evidence before touching the failing page.
export async function saveGraphicsFailureArtifacts(page, output, receipt, { timeoutMs = 5_000 } = {}) {
  const save = () => writeFile(`${output}/report.json`, JSON.stringify(receipt, null, 2));
  await save();
  if (!page) return;
  const diagnostic = await bounded(() => page.evaluate(() => {
    const d = window.__INHAGAME_P0__, app = d?.app;
    const status = d?.getStatus?.();
    return { visibility: document.visibilityState,
      contextLost: app?.graphicsDevice?.contextLost === true,
      autoRender: app?.autoRender ?? null, renderNextFrame: app?.renderNextFrame ?? null,
      renderer: status?.renderer ?? null, graphics: status?.graphics ?? null };
  }), timeoutMs);
  receipt.failureDiagnostics = diagnostic.outcome === 'complete'
    ? { status: 'collected', data: diagnostic.value }
    : { status: 'unavailable', reason: `evaluation-${diagnostic.outcome}` };
  await save();
  // A failure screenshot is best effort and must not wait for another postrender.
  const capture = await bounded(() => page.screenshot({ path: `${output}/failure.png`, timeout: timeoutMs }), timeoutMs);
  if (capture.outcome === 'complete') receipt.screenshots.push('failure.png');
  else receipt.captureError = `failure screenshot ${capture.outcome}`;
  await save();
}

// Preserve normal context -> browser -> server cleanup. Only its bounded failure
// enables the harness's owned-server abort fallback; never terminate other runs.
export async function closeGraphicsSmokeAfterSave(smoke, save, { timeoutMs = 5_000, forceExit = code => process.exit(code) } = {}) {
  await save();
  if (!smoke) return { close: 'not-started' };
  const cleanup = { close: (await bounded(() => smoke.close(), timeoutMs)).outcome };
  if (cleanup.close !== 'complete') {
    await save(cleanup);
    cleanup.abort = (await bounded(() => smoke.abort(), timeoutMs)).outcome;
  }
  await save(cleanup);
  // An unsuccessful close followed by a hung abort can retain protocol handles. The receipt must
  // finish writing before the sole forced, nonzero process exit is allowed.
  if (cleanup.abort === 'timeout') forceExit(1);
  return cleanup;
}
