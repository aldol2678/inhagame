// Only this fresh worker-owned canvas is read. Never resize/re-encode the PNG.
const supported = scope => typeof scope.createImageBitmap === 'function' && typeof scope.OffscreenCanvas === 'function';
export async function validatePng({ blob, width, height, diagnostics = false }, scope = globalThis) {
  if (!supported(scope)) return { status: 'unsupported' };
  let bitmap, canvas;
  const timings = {}, evidence = diagnostics ? { timings } : {};
  const now = () => {
    if (!diagnostics) return null;
    try { const t = scope.performance.now(); return Number.isFinite(t) ? t : null; } catch { return null; }
  };
  const elapsed = (key, start) => {
    const end = now();
    if (start !== null && end !== null && end >= start) timings[key] = end - start;
  };
  let stage = 'decode', start = now();
  try {
    bitmap = await scope.createImageBitmap(blob);
    elapsed('decodeMs', start);
    if (bitmap.width !== width || bitmap.height !== height) return { status: 'invalid', reason: 'dimensions', ...evidence };
    stage = 'setup'; start = now();
    canvas = new scope.OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { status: 'unsupported' };
    stage = 'readback';
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    elapsed('readbackMs', start);
    if (pixels.length !== width * height * 4) return { status: 'invalid', reason: 'readback', ...evidence };
    start = now();
    let visible = false;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
    elapsed('scanMs', start);
    return { status: visible ? 'valid' : 'invalid', ...(visible ? {} : { reason: 'transparent' }), ...evidence };
  } catch { return stage === 'setup' ? { status: 'unsupported' } : { status: 'invalid', reason: stage, ...evidence }; }
  finally {
    try { bitmap?.close(); } catch { /* Best effort after validation; worker is terminated by owner. */ }
    try { if (canvas) { canvas.width = 0; canvas.height = 0; } } catch { /* Same ownership rule. */ }
  }
}
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = async ({ data }) => {
    if (data?.type !== 'validate') return;
    const result = await validatePng(data);
    globalThis.postMessage({ type: 'validated', id: data.id, ...result });
  };
  globalThis.postMessage({ type: supported(globalThis) ? 'ready' : 'unsupported' });
}
