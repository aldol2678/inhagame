// Runs in the browser before the PNG test's independent framebuffer-read hook.
// Uses real native canvases and PNG codecs with the production capture module.
export async function validateAlphaCaptures({ path = 'worker' } = {}) {
  const { createPhotoCapture } = await import('/src/photo/photo-capture.js');
  if (!['worker', 'legacy'].includes(path)) throw Error('Unknown alpha validation test path');
  const cases = [];
  for (const [width, height] of [[1, 1], [1, 7], [9, 1], [1280, 720], [360, 800], [844, 390]]) {
    for (const alpha of [0, 1, 127, 255]) {
      for (const position of [...new Set([0, width - 1, (height - 1) * width, width * height - 1])]) {
        const source = document.createElement('canvas'); source.width = width; source.height = height;
        const context = source.getContext('2d', { willReadFrequently: true });
        const seed = context.createImageData(width, height);
        // Black avoids unrelated low-alpha RGB premultiplication rounding.
        seed.data[position * 4 + 3] = alpha; context.putImageData(seed, 0, 0);
        const expected = context.getImageData(0, 0, width, height).data;
        const reads = [], events = new Map(), encoded = [];
        const app = { graphicsDevice: {}, on: (name, fn) => events.set(name, fn),
          off: (name, fn) => { if (events.get(name) === fn) events.delete(name); } };
        const mode = { update: () => true, subscribe: () => () => {} };
        const doc = { createElement: name => {
          const canvas = document.createElement(name), ctx = canvas.getContext('2d', { willReadFrequently: true });
          const read = ctx.getImageData.bind(ctx);
          ctx.getImageData = (...args) => { reads.push(args); return read(...args); };
          const toBlob = canvas.toBlob.bind(canvas);
          canvas.toBlob = (callback, ...args) => toBlob(blob => { encoded.push(blob); callback(blob); }, ...args);
          return canvas;
        } };
        const capture = createPhotoCapture({ app, canvas: source, mode, doc, diagnostics: true,
          ...(path === 'legacy' ? { createWorker: () => null } : {}) });
        let bitmap;
        let originalPngUnchanged = null;
        try {
          const pending = capture.request(); events.get('frameend')();
          if (!alpha) {
            let code;
            try { await pending; } catch (error) { code = error.code; }
            if (code !== 'unavailable') throw Error('Fully transparent native canvas must be rejected');
          } else {
            const result = await pending;
            if (result.width !== width || result.height !== height || result.blob.type !== 'image/png') throw Error('PNG result contract changed');
            // Validation must return the original encoded PNG, never a worker re-encode.
            if (encoded.length !== 1 || result.blob !== encoded[0]) throw Error('Capture must retain its original PNG Blob');
            const originalBytes = new Uint8Array(await encoded[0].arrayBuffer());
            const resultBytes = new Uint8Array(await result.blob.arrayBuffer());
            originalPngUnchanged = resultBytes.length === originalBytes.length &&
              resultBytes.every((value, index) => value === originalBytes[index]);
            if (!originalPngUnchanged) throw Error('Encoded PNG bytes changed during validation');
            bitmap = await createImageBitmap(result.blob);
            const decoded = document.createElement('canvas'); decoded.width = bitmap.width; decoded.height = bitmap.height;
            const ctx = decoded.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
            const actual = ctx.getImageData(0, 0, width, height).data;
            if (bitmap.width !== width || bitmap.height !== height || actual.length !== expected.length ||
                actual.some((value, index) => value !== expected[index])) throw Error('Decoded PNG must preserve every original RGBA pixel');
            decoded.width = decoded.height = 0;
          }
          const expectedReads = path === 'worker' ? [] : alpha && position === 0 ? [[0, 0, 1, 1]] : [[0, 0, 1, 1], [0, 0, width, height]];
          if (JSON.stringify(reads) !== JSON.stringify(expectedReads)) throw Error('Main-thread read rectangles differ from the selected validation path');
          const diagnostic = capture.diagnostics().at(-1);
          if (diagnostic?.validation?.path !== path) throw Error(`Expected actual ${path} validation; fallback is not worker evidence`);
          if (diagnostic.code !== (alpha ? 'success' : 'unavailable')) throw Error('Wrong terminal alpha classification');
          if (path === 'worker') {
            if (encoded.length !== 1) throw Error('Worker validation requires exactly one original PNG encode');
            if (diagnostic.validation.fallbackReason !== null) throw Error('Worker case unexpectedly fell back');
            for (const key of ['decodeMs', 'readbackMs', 'scanMs'])
              if (!Number.isFinite(diagnostic.validation[key]) || diagnostic.validation[key] < 0) throw Error(`Missing worker ${key}`);
          }
          if (alpha || path === 'worker') {
            const timing = diagnostic.encoding;
            if (!timing || ![timing.callStartElapsedMs, timing.callReturnElapsedMs, timing.callbackElapsedMs].every(Number.isFinite) ||
                timing.callReturnElapsedMs < timing.callStartElapsedMs || timing.callbackElapsedMs < timing.callReturnElapsedMs)
              throw Error('Native toBlob call-return and callback timestamps must be recorded separately');
          }
          cases.push({ width, height, alpha, position, path, reads, originalPngUnchanged,
            validation: diagnostic.validation, encoding: diagnostic.encoding ?? null,
            outcome: alpha ? 'PNG_PIXELS_MATCH' : 'TRANSPARENT_REJECTED' });
        } finally { bitmap?.close(); capture.destroy(); source.width = source.height = 0; }
      }
    }
  }
  if (cases.length !== 68) throw Error('Native alpha matrix must retain all 68 preregistered cases');
  return { path, scope: 'Synthetic native-canvas alpha semantics and decoded PNG equivalence, not campus performance or device-gallery evidence', cases };
}

// Native module-worker protocol checks, separate from the correctness matrix.
// These bounded QA waits never change createPhotoCapture's product deadline.
export async function validateWorkerProtocolCases() {
  const cases = [], source = document.createElement('canvas');
  source.width = 3; source.height = 2;
  const context = source.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'black'; context.fillRect(0, 0, 3, 2);
  const png = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
  if (!png) throw Error('Native fixture PNG encode failed');
  async function requestWorker(blob, width, height, id) {
    const worker = new Worker('/src/photo/photo-alpha-worker.js', { type: 'module' });
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Native worker protocol QA deadline')), 5_000);
        worker.onerror = () => reject(Error('Native worker failed to load'));
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') worker.postMessage({ type: 'validate', id, blob, width, height, diagnostics: true });
          else if (data.type === 'validated' && data.id === id) resolve(data);
          else reject(Error('Unexpected native worker protocol response'));
        };
      });
    } finally { clearTimeout(timer); worker.terminate(); }
  }
  try {
    for (const [name, blob, width, height, reason] of [
      ['corrupted-png', new Blob(['not a PNG'], { type: 'image/png' }), 3, 2, 'decode'],
      ['native-dimension-mismatch', png, 4, 2, 'dimensions']
    ]) {
      const result = await requestWorker(blob, width, height, name);
      if (result.status !== 'invalid' || result.reason !== reason) throw Error(`${name}: invalid input was not rejected`);
      cases.push({ name, status: result.status, reason: result.reason, timings: result.timings ?? null });
    }
    const { createPhotoCapture } = await import('/src/photo/photo-capture.js');
    const events = new Map(), reads = [], encoded = [];
    const app = { graphicsDevice: {}, on: (name, fn) => events.set(name, fn), off: name => events.delete(name) };
    const mode = { update: () => true, subscribe: () => () => {} };
    const doc = { createElement: () => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      const read = ctx.getImageData.bind(ctx), toBlob = canvas.toBlob.bind(canvas);
      ctx.getImageData = (...args) => { reads.push(args); return read(...args); };
      canvas.toBlob = (callback, ...args) => toBlob(blob => { encoded.push(blob); callback(blob); }, ...args);
      return canvas;
    } };
    const capture = createPhotoCapture({ app, canvas: source, mode, doc, diagnostics: true,
      createWorker: () => { throw new DOMException('Synthetic worker policy denial', 'SecurityError'); } });
    try {
      const pending = capture.request(); events.get('frameend')();
      const result = await pending, diagnostic = capture.diagnostics().at(-1);
      if (diagnostic.validation.path !== 'legacy' || diagnostic.validation.fallbackReason !== 'startup-error' ||
          JSON.stringify(reads) !== JSON.stringify([[0, 0, 1, 1]]) || result.blob !== encoded[0] || encoded.length !== 1)
        throw Error('Blocked worker construction must use the exact legacy witness and original PNG');
      cases.push({ name: 'blocked-worker-construction', status: 'LEGACY_FALLBACK', reads,
        originalPngUnchanged: true, validation: diagnostic.validation, encoding: diagnostic.encoding });
    } finally { capture.destroy(); }
    return { scope: 'Actual native worker decode/protocol plus simulated worker-constructor SecurityError; not an actual CSP policy or WebKit test', cases };
  } finally { source.width = source.height = 0; }
}
