import test from 'node:test';
import assert from 'node:assert/strict';
import { startRecastWorker } from '../recast-npc-worker-client.mjs';
function fixture() {
  const worker = { terminated: 0, terminate() { this.terminated++; }, postMessage(message) { this.request = message; } };
  const phases = [];
  const job = startRecastWorker({ prebuiltMode: true, onPhase: value => phases.push(value), createWorker: () => worker });
  return { worker, job, phases, send: data => worker.onmessage?.({ data: { requestId: worker.request.requestId, ...data } }) };
}
test('Worker completion forwards diagnostics and terminates owned realm once', async () => {
  const { worker, job, phases, send } = fixture();
  const result = { verdict: 'FAIL', failures: [{ id: 'npc', reason: 'INCOMPLETE_PATH' }] };
  send({ type: 'PHASE', phase: 'schedule' }); send({ type: 'RESULT', result });
  assert.equal(worker.request.prebuiltMode, true);
  assert.deepEqual(await job.promise, result); assert.deepEqual(phases, ['schedule']);
  job.cancel(); assert.equal(worker.terminated, 1); assert.equal(worker.onmessage, null);
});
test('cancel during synchronous work ignores captured late completion', async () => {
  const { worker, job } = fixture(); const queued = worker.onmessage;
  job.cancel(); queued({ data: { requestId: worker.request.requestId, type: 'RESULT', result: { verdict: 'PASS' } } });
  assert.equal((await job.promise).verdict, 'CANCELLED'); assert.equal(worker.terminated, 1);
});
test('a stale request cannot finish a newer evaluation', async () => {
  const first = fixture(), second = fixture();
  second.worker.onmessage({ data: { requestId: first.worker.request.requestId, type: 'RESULT', result: { verdict: 'PASS' } } });
  assert.equal(second.worker.terminated, 0); second.job.cancel(); first.job.cancel();
  assert.equal((await second.job.promise).verdict, 'CANCELLED');
});
for (const mode of ['error', 'messageerror', 'invalid-result', 'invalid-message']) {
  test(`${mode} produces ERROR without a coverage verdict`, async () => {
    const { worker, job, send } = fixture();
    if (mode === 'error') worker.onerror({ message: 'module failed', preventDefault() {} });
    else if (mode === 'messageerror') worker.onmessageerror();
    else if (mode === 'invalid-result') send({ type: 'RESULT', result: {} });
    else send({ type: 'unknown' });
    assert.equal((await job.promise).verdict, 'ERROR'); assert.equal(worker.terminated, 1);
  });
}
test('unsupported or blocked Worker fails explicitly', async () => {
  const job = startRecastWorker({ createWorker: () => { throw Error('Worker unavailable'); } });
  assert.match((await job.promise).message, /RECAST_WORKER_START_ERROR/);
});
