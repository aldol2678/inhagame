const failure = code => Object.assign(new Error(`Photo capture: ${code}`), { code });
const cancelled = () => Object.assign(failure('cancelled'), { name: 'AbortError' });

// Copies only the existing game canvas, never DOM/HUD or a second camera/render target.
// On rendered frames, PlayCanvas 2.22.4 fires frameend after graphicsDevice.frameEnd
// submits WebGPU commands; skipped-render ticks also emit frameend. Copy synchronously in that callback: WebGL's non-preserved buffer and WebGPU's current
// texture need to be read before the browser presents/discards the frame. Encoding may
// finish later, so it uses an isolated 2D snapshot and revalidates the photo session.
export function createPhotoCapture({ app, canvas, mode, doc = globalThis.document,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, timeoutMs = 10_000,
  diagnostics = false, now = () => globalThis.performance.now(), onDiagnostic = null } = {}) {
  let pending = null, destroyed = false;
  // QA-only bounded, in-memory evidence. Never retain pixels, error text or identity.
  const records = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  function mark(job, phase) {
    if (!diagnostics) return;
    try {
      const at = now();
      if (!job.diagnostic) {
        job.startedAt = at;
        job.diagnostic = { code: null, phase, exceptionKind: null, postrenderObservedSinceRequest: false, events: [] };
        records.push(job.diagnostic);
        if (records.length > 8) records.shift();
      }
      const record = job.diagnostic;
      const operation = record.readbackOperations?.at(-1);
      const elapsedMs = Math.max(record.events.at(-1)?.elapsedMs ?? 0,
        operation?.endElapsedMs ?? operation?.startElapsedMs ?? 0, at - job.startedAt);
      record.events.push({ phase, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0, state: {
        visibility: ['visible', 'hidden', 'prerender'].includes(doc.visibilityState) ? doc.visibilityState : 'unknown',
        contextLost: app.graphicsDevice?.contextLost === true,
        postrenderObservedSinceRequest: record.postrenderObservedSinceRequest,
        autoRender: typeof app.autoRender === 'boolean' ? app.autoRender : null,
        renderNextFrame: typeof app.renderNextFrame === 'boolean' ? app.renderNextFrame : null,
        width: Number.isInteger(canvas.width) ? canvas.width : null,
        height: Number.isInteger(canvas.height) ? canvas.height : null
      } });
      if (phase !== 'complete' && phase !== 'failed') record.phase = phase;
    } catch { /* Diagnostics must never affect capture. */ }
  }
  function diagnosticElapsed(job) {
    const elapsed = now() - job.startedAt;
    const operation = job.diagnostic.readbackOperations?.at(-1);
    return Number.isFinite(elapsed) ? Math.max(job.diagnostic.events.at(-1)?.elapsedMs ?? 0,
      operation?.endElapsedMs ?? operation?.startElapsedMs ?? 0, elapsed) : null;
  }
  function readbackOperation(job, operation, end = false) {
    if (!job.diagnostic) return;
    try {
      const at = diagnosticElapsed(job);
      if (at === null) return;
      const operations = job.diagnostic.readbackOperations ??= [];
      if (!end) operations.push({ operation, startElapsedMs: at, endElapsedMs: null, durationMs: null });
      else {
        const record = operations.at(-1);
        if (record?.operation !== operation || record.endElapsedMs !== null) return;
        record.endElapsedMs = Math.max(record.startElapsedMs, at);
        record.durationMs = record.endElapsedMs - record.startElapsedMs;
      }
    } catch { /* Optional clock and diagnostic state cannot affect the operation. */ }
  }
  function timerDiagnostic(job, fired = false) {
    if (!job.diagnostic) return;
    try {
      const at = diagnosticElapsed(job);
      if (at === null) return;
      if (!fired) job.diagnostic.timeout = { nominalDeadlineElapsedMs: at + timeoutMs, callbackElapsedMs: null, skewMs: null };
      else if (job.diagnostic.timeout) {
        job.diagnostic.timeout.callbackElapsedMs = at;
        job.diagnostic.timeout.skewMs = Math.max(0, at - job.diagnostic.timeout.nominalDeadlineElapsedMs);
      }
    } catch { /* Diagnostics must never change the timeout. */ }
  }
  function lateEncodingDiagnostic(job) {
    // Observe only a first callback within 30 s of timeout, while its receipt is
    // still in the eight-record ring. No timer, blob inspection or observer call.
    if (destroyed || job.diagnostic?.code !== 'timeout' || !records.includes(job.diagnostic) || job.diagnostic.lateEncodingCallback) return;
    try {
      const at = diagnosticElapsed(job), timeoutAt = job.diagnostic.timeout?.callbackElapsedMs;
      if (at === null || timeoutAt == null || at < timeoutAt || at - timeoutAt > 30_000) return;
      job.diagnostic.lateEncodingCallback = { elapsedMs: at, afterTimeoutMs: at - timeoutAt };
    } catch { /* Late callbacks must remain inert for capture/session state. */ }
  }
  function completeDiagnostic(job, error) {
    if (!job.diagnostic) return;
    job.diagnostic.code = error?.code ?? 'success';
    mark(job, error ? 'failed' : 'complete');
    try { onDiagnostic?.(copy(job.diagnostic)); } catch { /* Optional QA observer only. */ }
  }
  function finish(request, error, value) {
    if (pending !== request) return;
    pending = null;
    completeDiagnostic(request, error);
    app.off('frameend', request.frame);
    if (request.postrender) app.off('postrender', request.postrender);
    clearTimer(request.timer);
    if (request.snapshot) { request.snapshot.width = 0; request.snapshot.height = 0; }
    request.snapshot = null;
    if (error) request.reject(error); else request.resolve(value);
  }
  const cancel = () => { if (pending) finish(pending, cancelled()); };
  const offClosing = mode.subscribeClosing?.(cancel, { priority: 0 });
  const unsubscribe = mode.subscribe(({ active }) => { if (!active) cancel(); });
  function request() {
    if (destroyed || !mode.update()) return Promise.reject(cancelled());
    if (pending) return Promise.reject(failure('busy'));
    return new Promise((resolve, reject) => {
      const job = { resolve, reject, snapshot: null, frame: null, timer: null };
      pending = job;
      mark(job, 'request');
      // postrender is evidence that PlayCanvas rendered, not evidence of GPU completion.
      // frameend also fires on ticks where rendering was skipped.
      if (diagnostics) {
        job.postrender = () => {
          if (pending === job && job.diagnostic) job.diagnostic.postrenderObservedSinceRequest = true;
        };
        app.on('postrender', job.postrender);
      }
      job.frame = () => {
        app.off('frameend', job.frame);
        if (pending !== job) return;
        mark(job, 'frame');
        if (!mode.update()) { cancel(); return; }
        try {
          const { width, height } = canvas;
          if (app.graphicsDevice?.contextLost || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
            throw failure('unavailable');
          const snapshot = job.snapshot = doc.createElement('canvas');
          snapshot.width = width; snapshot.height = height;
          const context = snapshot.getContext('2d', { willReadFrequently: true });
          if (!context || typeof snapshot.toBlob !== 'function') throw failure('unavailable');
          mark(job, 'readback');
          readbackOperation(job, 'drawImage');
          context.drawImage(canvas, 0, 0);
          readbackOperation(job, 'drawImage', true);
          readbackOperation(job, 'getImageData');
          const pixels = context.getImageData(0, 0, width, height).data;
          readbackOperation(job, 'getImageData', true);
          readbackOperation(job, 'alphaScan');
          let visible = false;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
          readbackOperation(job, 'alphaScan', true);
          if (!visible) throw failure('unavailable');
          mark(job, 'encoding');
          snapshot.toBlob(blob => {
            if (pending !== job) { lateEncodingDiagnostic(job); return; }
            if (!mode.update()) { cancel(); return; }
            if (!blob || blob.type !== 'image/png' || !blob.size) { finish(job, failure('encoding')); return; }
            finish(job, null, { blob, width, height });
          }, 'image/png');
        } catch (error) {
          if (job.diagnostic) {
            // Error messages/stacks may contain private URLs or data.
            job.diagnostic.exceptionKind = ['SecurityError', 'InvalidStateError', 'TypeError', 'RangeError', 'Error'].includes(error?.name)
              ? error.name : 'Other';
          }
          finish(job, failure('unavailable'));
        }
      };
      timerDiagnostic(job);
      job.timer = setTimer(() => {
        if (pending !== job) return;
        timerDiagnostic(job, true); finish(job, failure('timeout'));
      }, timeoutMs);
      app.on('frameend', job.frame);
      app.renderNextFrame = true;
    });
  }
  return Object.freeze({ request, cancel,
    diagnostics: () => copy(records),
    get busy() { return !!pending; },
    destroy() { if (destroyed) return; destroyed = true; cancel(); unsubscribe(); offClosing?.(); }
  });
}
