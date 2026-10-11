import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePhotoCaptureDiagnostics, closePhotoPageAfterSave } from './browser/photo-capture-artifact.mjs';

for (const code of ['success', 'timeout']) test('capture artifact retains ' + code + ' diagnostics', async () => {
  const output = await mkdtemp(join(tmpdir(), 'photo-diagnostics-'));
  try {
    const records = [{ code, phase: 'encoding', events: [] }];
    const result = await savePhotoCaptureDiagnostics({ evaluate: async fn => {
      globalThis.window = { __INHAGAME_P0__: { getPhotoCaptureDiagnostics: () => records } };
      try { return fn(); } finally { delete globalThis.window; }
    } }, output, 'desktop-ground');
    assert.equal(result.path, 'desktop-ground-diagnostics.json');
    assert.deepEqual(JSON.parse(await readFile(join(output, result.path))), { status: 'collected', records });
  } finally { await rm(output, { recursive: true }); }
});
test('unreadable page still writes a fixed unavailable receipt without private error text', async () => {
  const output = await mkdtemp(join(tmpdir(), 'photo-diagnostics-'));
  try {
    const result = await savePhotoCaptureDiagnostics({ evaluate: async () => { throw new Error('private URL'); } }, output, 'closed');
    assert.deepEqual(JSON.parse(await readFile(join(output, result.path))), { status: 'unavailable', reason: 'evaluation-failed', records: [] });
  } finally { await rm(output, { recursive: true }); }
});


test('a hung browser evaluation reaches a Node deadline and preserves an unavailable artifact', async () => {
  const output = await mkdtemp(join(tmpdir(), 'photo-diagnostics-'));
  try {
    let rejectEvaluation;
    const page = { evaluate: () => new Promise((_, reject) => { rejectEvaluation = reject; }) };
    const result = await savePhotoCaptureDiagnostics(page, output, 'hung', { timeoutMs: 5 });
    const receipt = await readFile(join(output, result.path), 'utf8');
    assert.deepEqual(JSON.parse(receipt), { status: 'unavailable', reason: 'evaluation-timeout', records: [] });
    rejectEvaluation(new Error('late private error')); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(await readFile(join(output, result.path), 'utf8'), receipt);
  } finally { await rm(output, { recursive: true }); }
});

test('report is saved before bounded page closure even when close hangs', async () => {
  const calls = [];
  const result = await closePhotoPageAfterSave({ close: () => { calls.push('close'); return new Promise(() => {}); } },
    async () => { calls.push('save'); }, { timeoutMs: 5 });
  assert.deepEqual(calls, ['save', 'close']);
  assert.equal(result, 'timeout');
});

test('bounded page closure handles success and errors without leaking browser error text', async () => {
  assert.equal(await closePhotoPageAfterSave({ close: async () => {} }, async () => {}), 'closed');
  assert.equal(await closePhotoPageAfterSave({ close: async () => { throw new Error('private'); } }, async () => {}), 'failed');
});
