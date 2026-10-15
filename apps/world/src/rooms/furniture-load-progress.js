// Measured bytes only. These are bounded safety limits, not throughput promises.
// Small existing models retain their original eight-second total load/render cap.
export const FURNITURE_LARGE_LOAD_POLICY = Object.freeze({ inactivityMs: 15000, overallMs: 180000, processingMs: 30000, renderMs: 8000 });
export function furnitureLoadPolicy(visual, timeoutMs) {
  if (timeoutMs !== undefined) return { inactivityMs: timeoutMs, overallMs: timeoutMs, processingMs: timeoutMs, renderMs: timeoutMs };
  return visual.byteLength > 1024 * 1024 ? FURNITURE_LARGE_LOAD_POLICY
    : { inactivityMs: 8000, overallMs: 8000, processingMs: 8000, renderMs: 8000 };
}
const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });

// One fixed overall deadline, plus a phase deadline. Only increasing received
// bytes renew network inactivity; decode and first render get bounded budgets.
export function createFurnitureLoadWatchdog({ policy, onTimeout, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const overallAt = now() + policy.overallMs;
  let active = true, timer = null, generation = 0, loaded = 0, phase = 'download', phaseAt = now() + policy.inactivityMs;
  function arm() {
    clearTimer(timer);
    const token = ++generation;
    timer = setTimer(() => {
      if (!active || token !== generation) return;
      active = false;
      onTimeout(new Error(now() >= overallAt ? 'FURNITURE_OVERALL_TIMEOUT' : `FURNITURE_${phase.toUpperCase()}_TIMEOUT`));
    }, Math.max(0, Math.min(overallAt, phaseAt) - now()));
  }
  arm();
  return {
    progress(loadedBytes, totalBytes) {
      if (!active || phase !== 'download' || !Number.isSafeInteger(loadedBytes) || !Number.isSafeInteger(totalBytes)
        || loadedBytes <= loaded || loadedBytes > totalBytes || totalBytes <= 0) return false;
      loaded = loadedBytes;
      if (loadedBytes === totalBytes) { phase = 'processing'; phaseAt = now() + policy.processingMs; }
      else phaseAt = now() + policy.inactivityMs;
      arm();
      return true;
    },
    render() {
      if (!active || phase === 'render') return;
      phase = 'render'; phaseAt = now() + policy.renderMs; arm();
    },
    stop() { active = false; generation++; clearTimer(timer); timer = null; }
  };
}

export async function readFurnitureBytes(response, expectedBytes, { signal, onProgress = () => {} } = {}) {
  const check = () => { if (signal?.aborted) throw abortError(); };
  check();
  if (Number(response.headers?.get('content-length')) > expectedBytes) throw Error('FURNITURE_BYTE_LENGTH');
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Older transports expose no incremental evidence. Never fabricate progress.
    const contents = await response.arrayBuffer();
    check();
    if (contents.byteLength !== expectedBytes) throw Error('FURNITURE_BYTE_LENGTH');
    onProgress({ loadedBytes: contents.byteLength, totalBytes: expectedBytes });
    return contents;
  }
  const bytes = new Uint8Array(expectedBytes);
  let loadedBytes = 0;
  const cancelReader = () => { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* abort cleanup cannot throw */ } };
  signal?.addEventListener('abort', cancelReader, { once: true });
  try {
    while (true) {
      check();
      const { done, value } = await reader.read();
      check();
      if (done) break;
      if (!value?.byteLength) continue;
      if (loadedBytes + value.byteLength > expectedBytes) throw Error('FURNITURE_BYTE_LENGTH');
      bytes.set(value, loadedBytes); loadedBytes += value.byteLength;
      onProgress({ loadedBytes, totalBytes: expectedBytes });
    }
    if (loadedBytes !== expectedBytes) throw Error('FURNITURE_BYTE_LENGTH');
    return bytes.buffer;
  } catch (error) {
    cancelReader();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}

// The shared source owns a deadline too: replacing subscribers cannot keep one
// hung request alive forever. A placement's release never aborts another owner.
export async function withFurnitureLoadDeadline(work, { signal, policy, onProgress = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const controller = new AbortController();
  let rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const stop = error => { controller.abort(); rejectStop(error); };
  const watchdog = createFurnitureLoadWatchdog({ policy, onTimeout: stop, now, setTimer, clearTimer });
  const abort = () => stop(abortError());
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([stopped, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortError();
      return work(controller.signal, progress => {
        if (controller.signal.aborted) return;
        watchdog.progress(progress.loadedBytes, progress.totalBytes);
        onProgress(progress);
      });
    })]);
  } finally {
    watchdog.stop(); signal?.removeEventListener('abort', abort);
  }
}

// Subscribe before awaiting; replayed snapshots cover models started by bind().
// Each caller owns its subscriptions, so concurrent room/preview waiters coexist.
export async function waitForFurnitureVisuals(handles, { onProgress, signal } = {}) {
  const unsubscribers = [];
  const seen = new Map();
  let rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  const cleanup = () => { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe(); };
  const abort = () => { cleanup(); rejectAbort(abortError()); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    if (onProgress) for (const handle of handles) {
      unsubscribers.push(handle.subscribeProgress(progress => {
        if (signal?.aborted || progress.loadedBytes <= (seen.get(progress.sourceKey) ?? -1)) return;
        seen.set(progress.sourceKey, progress.loadedBytes);
        try { onProgress(progress); } catch { /* observation cannot change readiness */ }
      }));
    }
    return await Promise.race([Promise.all(handles.map(handle => handle.ready)), cancelled]);
  } finally {
    cleanup(); signal?.removeEventListener('abort', abort);
  }
}
