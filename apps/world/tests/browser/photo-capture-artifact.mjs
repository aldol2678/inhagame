import { writeFile } from 'node:fs/promises';

// This timer runs in Node, independently of a hung browser renderer or protocol reply.
async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(value => ({ outcome: 'complete', value }), () => ({ outcome: 'failed' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'timeout' }), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

// Run in a finally block while the page is still open: failed captures need evidence too.
// This QA collection deadline does not change the application's 10-second PNG timeout.
export async function savePhotoCaptureDiagnostics(page, output, label, { timeoutMs = 5_000 } = {}) {
  const result = await bounded(() => page.evaluate(() => window.__INHAGAME_P0__?.getPhotoCaptureDiagnostics?.() ?? null), timeoutMs);
  const receipt = result.outcome === 'complete' && Array.isArray(result.value)
    ? { status: 'collected', records: result.value }
    : { status: 'unavailable', reason: result.outcome === 'complete' ? 'api-unavailable' : `evaluation-${result.outcome}`, records: [] };
  const path = `${label}-diagnostics.json`;
  await writeFile(`${output}/${path}`, JSON.stringify(receipt, null, 2));
  return { path, status: receipt.status, ...(receipt.reason ? { reason: receipt.reason } : {}) };
}

// Persist the failure report before cleanup, and never let a hung close block the caller.
export async function closePhotoPageAfterSave(page, save, { timeoutMs = 5_000 } = {}) {
  await save();
  const result = await bounded(() => page.close(), timeoutMs);
  return result.outcome === 'complete' ? 'closed' : result.outcome;
}
