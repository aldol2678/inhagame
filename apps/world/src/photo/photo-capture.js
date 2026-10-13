const failure = code => Object.assign(new Error(`Photo capture: ${code}`), { code });
const cancelled = () => Object.assign(failure('cancelled'), { name: 'AbortError' });

// Copies only the existing game canvas, never DOM/HUD or a second camera/render target.
// PlayCanvas 2.22.4 fires frameend after graphicsDevice.frameEnd submits WebGPU commands.
// Copy synchronously in that callback: WebGL's non-preserved buffer and WebGPU's current
// texture need to be read before the browser presents/discards the frame. Encoding may
// finish later, so it uses an isolated 2D snapshot and revalidates the photo session.
export function createPhotoCapture({ app, canvas, mode, doc = globalThis.document,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, timeoutMs = 30_000, softLimitMs = 10_000,
  now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  let pending = null, destroyed = false;
  const observers = new Set();
  const number = value => Number.isFinite(value) ? value : null;
  const frame = () => number(app.frame);
  // One bounded, image-free observation of the latest accepted request. These timestamps
  // preserve the full elapsed time, including any time beyond the soft warning.
  // 30 seconds is a provisional product safety limit for PNG creation only.
  let lastStatus = Object.freeze({ state: 'idle', stage: 'idle', errorCode: null,
    elapsedMs: 0, frameWaitMs: 0, readbackMs: 0, encodingMs: 0,
    requestedFrame: null, capturedFrame: null, settledFrame: null, width: null, height: null,
    softLimitMs, timeoutMs, overSoftLimitMs: 0 });
  function sample(job, at = now()) {
    const elapsed = start => Math.max(0, at - start);
    return { ...job.diagnostic, elapsedMs: elapsed(job.startedAt),
      softLimitMs, timeoutMs, overSoftLimitMs: Math.max(0, elapsed(job.startedAt) - softLimitMs),
      frameWaitMs: Math.max(0, (job.frameAt ?? at) - job.startedAt),
      readbackMs: job.frameAt === null ? 0 : Math.max(0, (job.encodingAt ?? at) - job.frameAt),
      encodingMs: job.encodingAt === null ? 0 : elapsed(job.encodingAt) };
  }
  function notify(status) {
    for (const observer of observers) { try { observer(status); } catch { /* UI observation cannot change capture settlement. */ } }
  }
  const expired = job => now() - job.startedAt >= timeoutMs;
  function finish(request, error, value) {
    if (pending !== request) return;
    lastStatus = Object.freeze({ ...sample(request),
      state: error ? error.name === 'AbortError' ? 'cancelled' : 'failed' : 'succeeded',
      stage: error ? request.diagnostic.stage : 'complete', errorCode: error?.code ?? null, settledFrame: frame() });
    pending = null;
    app.off('frameend', request.frame);
    clearTimer(request.timer);
    clearTimer(request.warningTimer);
    if (request.snapshot) { request.snapshot.width = 0; request.snapshot.height = 0; }
    request.snapshot = null;
    notify(lastStatus);
    if (error) request.reject(error); else request.resolve(value);
  }
  const cancel = () => { if (pending) finish(pending, cancelled()); };
  const offClosing = mode.subscribeClosing?.(cancel, { priority: 0 });
  const unsubscribe = mode.subscribe(({ active }) => { if (!active) cancel(); });
  function request() {
    if (destroyed || !mode.update()) return Promise.reject(cancelled());
    if (pending) return Promise.reject(failure('busy'));
    return new Promise((resolve, reject) => {
      const job = { resolve, reject, snapshot: null, frame: null, timer: null, warningTimer: null,
        startedAt: now(), frameAt: null, encodingAt: null,
        diagnostic: { state: 'pending', stage: 'waiting-frame', errorCode: null,
          requestedFrame: frame(), capturedFrame: null, settledFrame: null,
          width: number(canvas.width), height: number(canvas.height) } };
      pending = job;
      job.frame = () => {
        app.off('frameend', job.frame);
        if (pending !== job) return;
        if (!mode.update()) { cancel(); return; }
        if (expired(job)) { finish(job, failure('timeout')); return; }
        try {
          job.frameAt = now(); job.diagnostic.stage = 'readback'; job.diagnostic.capturedFrame = frame();
          const { width, height } = canvas;
          job.diagnostic.width = number(width); job.diagnostic.height = number(height);
          if (app.graphicsDevice?.contextLost || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
            throw failure('unavailable');
          const snapshot = job.snapshot = doc.createElement('canvas');
          snapshot.width = width; snapshot.height = height;
          const context = snapshot.getContext('2d', { willReadFrequently: true });
          if (!context || typeof snapshot.toBlob !== 'function') throw failure('unavailable');
          context.drawImage(canvas, 0, 0);
          const pixels = context.getImageData(0, 0, width, height).data;
          let visible = false;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
          if (!visible) throw failure('unavailable');
          if (expired(job)) { finish(job, failure('timeout')); return; }
          job.encodingAt = now(); job.diagnostic.stage = 'encoding';
          notify(Object.freeze(sample(job)));
          if (pending !== job) return;
          snapshot.toBlob(blob => {
            if (pending !== job) return;
            if (!mode.update()) { cancel(); return; }
            // A delayed timer must never let a late PNG become a successful save.
            if (expired(job)) { finish(job, failure('timeout')); return; }
            if (!blob || blob.type !== 'image/png' || !blob.size) { finish(job, failure('encoding')); return; }
            finish(job, null, { blob, width, height });
          }, 'image/png');
        } catch { finish(job, failure('unavailable')); }
      };
      job.timer = setTimer(() => finish(job, failure('timeout')), timeoutMs);
      job.warningTimer = setTimer(() => {
        if (pending === job) notify(Object.freeze(sample(job)));
      }, softLimitMs);
      app.on('frameend', job.frame);
      app.renderNextFrame = true;
      notify(Object.freeze(sample(job)));
    });
  }
  return Object.freeze({ request, cancel,
    get busy() { return !!pending; },
    status: () => pending ? Object.freeze(sample(pending)) : lastStatus,
    subscribe(observer) { observers.add(observer); return () => observers.delete(observer); },
    destroy() { if (destroyed) return; destroyed = true; cancel(); unsubscribe(); offClosing?.(); observers.clear(); }
  });
}
