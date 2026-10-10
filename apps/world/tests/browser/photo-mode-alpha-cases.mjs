// Runs in the browser before the PNG test's independent framebuffer-read hook.
// Uses real native canvases and PNG codecs with the production capture module.
export async function validateAlphaCaptures() {
  const { createPhotoCapture } = await import('/src/photo/photo-capture.js');
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
        const reads = [], events = new Map();
        const app = { graphicsDevice: {}, on: (name, fn) => events.set(name, fn),
          off: (name, fn) => { if (events.get(name) === fn) events.delete(name); } };
        const mode = { update: () => true, subscribe: () => () => {} };
        const doc = { createElement: name => {
          const canvas = document.createElement(name), ctx = canvas.getContext('2d', { willReadFrequently: true });
          const read = ctx.getImageData.bind(ctx);
          ctx.getImageData = (...args) => { reads.push(args); return read(...args); };
          return canvas;
        } };
        const capture = createPhotoCapture({ app, canvas: source, mode, doc });
        let bitmap;
        try {
          const pending = capture.request(); events.get('frameend')();
          if (!alpha) {
            let code;
            try { await pending; } catch (error) { code = error.code; }
            if (code !== 'unavailable') throw Error('Fully transparent native canvas must be rejected');
          } else {
            const result = await pending;
            if (result.width !== width || result.height !== height || result.blob.type !== 'image/png') throw Error('PNG result contract changed');
            bitmap = await createImageBitmap(result.blob);
            const decoded = document.createElement('canvas'); decoded.width = bitmap.width; decoded.height = bitmap.height;
            const ctx = decoded.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
            const actual = ctx.getImageData(0, 0, width, height).data;
            if (bitmap.width !== width || bitmap.height !== height || actual.length !== expected.length ||
                actual.some((value, index) => value !== expected[index])) throw Error('Decoded PNG must preserve every original RGBA pixel');
            decoded.width = decoded.height = 0;
          }
          const expectedReads = alpha && position === 0 ? [[0, 0, 1, 1]] : [[0, 0, 1, 1], [0, 0, width, height]];
          if (JSON.stringify(reads) !== JSON.stringify(expectedReads)) throw Error('Native read rectangles must follow exact witness/full fallback');
          cases.push({ width, height, alpha, position, reads, outcome: alpha ? 'PNG_PIXELS_MATCH' : 'TRANSPARENT_REJECTED' });
        } finally { bitmap?.close(); capture.destroy(); source.width = source.height = 0; }
      }
    }
  }
  return { scope: 'Synthetic native-canvas alpha semantics and decoded PNG equivalence, not campus performance or device-gallery evidence', cases };
}
