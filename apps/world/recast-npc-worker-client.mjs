let nextRequestId = 0;
export function startRecastWorker({ prebuiltMode = false, onPhase = () => {},
  createWorker = () => new Worker(new URL('./recast-npc-worker.mjs', import.meta.url), { type: 'module' }) } = {}) {
  const requestId = ++nextRequestId;
  let worker, settled = false, resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });
  const finish = result => {
    if (settled) return;
    settled = true;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    }
    resolveResult(result);
  };
  const fail = message => finish({ verdict: 'ERROR', message });
  try {
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      if (settled || data?.requestId !== requestId) return;
      if (data.type === 'PHASE') onPhase(data.phase);
      else if (data.type === 'RESULT') {
        if (!['PASS', 'PARTIAL', 'FAIL', 'ERROR'].includes(data.result?.verdict)) fail('RECAST_WORKER_INVALID_RESULT');
        else finish(data.result);
      } else fail('RECAST_WORKER_INVALID_MESSAGE');
    };
    worker.onerror = event => { event.preventDefault?.(); fail(`RECAST_WORKER_ERROR: ${event.message || 'Worker failed'}`); };
    worker.onmessageerror = () => fail('RECAST_WORKER_MESSAGE_ERROR');
    worker.postMessage({ type: 'RUN', requestId, prebuiltMode });
  } catch (error) { fail(`RECAST_WORKER_START_ERROR: ${error?.message ?? String(error)}`); }
  return { promise, cancel: () => finish({ verdict: 'CANCELLED', message: '평가를 취소했습니다.' }) };
}
