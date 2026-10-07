const failure = code => Object.assign(new Error(`Photo capture: ${code}`), { code });
const cancelled = () => Object.assign(failure('cancelled'), { name: 'AbortError' });

// Copies only the existing game canvas, never DOM/HUD or a second camera/render target.
// PlayCanvas 2.22.4 fires frameend after graphicsDevice.frameEnd submits WebGPU commands.
// Copy synchronously in that callback: WebGL's non-preserved buffer and WebGPU's current
// texture need to be read before the browser presents/discards the frame. Encoding may
// finish later, so it uses an isolated 2D snapshot and revalidates the photo session.
export function createPhotoCapture({ app, canvas, mode, doc = globalThis.document,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, timeoutMs = 10_000 } = {}) {
  let pending = null, destroyed = false;
  function finish(request, error, value) {
    if (pending !== request) return;
    pending = null;
    app.off('frameend', request.frame);
    clearTimer(request.timer);
    if (request.snapshot) { request.snapshot.width = 0; request.snapshot.height = 0; }
    request.snapshot = null;
    if (error) request.reject(error); else request.resolve(value);
  }
  const cancel = () => { if (pending) finish(pending, cancelled()); };
  const unsubscribe = mode.subscribe(({ active }) => { if (!active) cancel(); });
  function request() {
    if (destroyed || !mode.update()) return Promise.reject(cancelled());
    if (pending) return Promise.reject(failure('busy'));
    return new Promise((resolve, reject) => {
      const job = { resolve, reject, snapshot: null, frame: null, timer: null };
      pending = job;
      job.frame = () => {
        app.off('frameend', job.frame);
        if (pending !== job) return;
        if (!mode.update()) { cancel(); return; }
        try {
          const { width, height } = canvas;
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
          snapshot.toBlob(blob => {
            if (pending !== job) return;
            if (!mode.update()) { cancel(); return; }
            if (!blob || blob.type !== 'image/png' || !blob.size) { finish(job, failure('encoding')); return; }
            finish(job, null, { blob, width, height });
          }, 'image/png');
        } catch { finish(job, failure('unavailable')); }
      };
      job.timer = setTimer(() => finish(job, failure('timeout')), timeoutMs);
      app.on('frameend', job.frame);
      app.renderNextFrame = true;
    });
  }
  return Object.freeze({ request, cancel,
    get busy() { return !!pending; },
    destroy() { if (destroyed) return; destroyed = true; cancel(); unsubscribe(); }
  });
}
