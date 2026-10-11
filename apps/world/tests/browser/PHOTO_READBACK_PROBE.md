# Exact alpha witness before full readback

This candidate changes only the visibility validation of the isolated photo
snapshot. The existing `drawImage(canvas, 0, 0)`, PNG encoding, dimensions,
10,000 ms application timeout, cancellation and download/preview paths remain.
No application renderer or GPU settings are changed.

## Decision and equivalence

Read original pixel `(0, 0)` at native resolution. A nonzero alpha byte proves
that the snapshot has at least one nonzero alpha byte, so a full ImageData
allocation/readback is unnecessary for validation. If that byte is zero, run
the original full-resolution read and alpha scan. A negative probe alone never
rejects an image. This retains a lone alpha=1 pixel at any coordinate and rejects
a fully transparent image. The snapshot is neither downscaled nor altered.

The [HTML getImageData algorithm](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-getimagedata)
reads the requested bitmap rectangle and checks origin cleanliness. There is no
interpolation in this probe. Downscaled alpha validation was not selected:
resampling/quantization cannot be assumed to preserve a lone minimally nonzero
alpha pixel.

`willReadFrequently: true` was already supplied on the snapshot's first context
creation in the before revision. It remains there. The [2D context initialization
contract](https://html.spec.whatwg.org/multipage/canvas.html#2d-context-creation-algorithm)
creates the context with the settings; later `getContext` calls return the bound
context rather than reconfigure it. Merely adding/changing options later would
not establish another optimization.

## Limits

A 1×1 read requests four returned bytes instead of `width * height * 4` on the
positive path. This does not prove that GPU synchronization, deferred drawing,
or the encoder's own full-image work is avoided. In Chromium's
[canvas implementation](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc),
getImageData finalizes pending work before copying the requested region. That
current implementation is a possible explanation, not diagnosis of the pinned
CI browser. A transparent first pixel adds one API call before the original
work; improvement must be measured and may be absent or negative.

The split `drawImage`, `getImageData` and `alphaScan` timings remain. Each read
now includes a `rectangle` so one-pixel and full fallback operations are
unambiguous. The nominal timeout, timeout skew and bounded late-callback evidence
remain unchanged; the timer cannot interrupt a synchronous browser operation.

## Validation

- `node --test apps/world/tests/photo-capture.test.mjs`: exact read rectangles,
  all twelve positions in a 4×3 image with alpha 1/127/255, full transparency,
  1×1/one-row/one-column plus desktop/portrait/landscape dimensions, exceptions,
  cleanup, cancellation, timeout and diagnostics.
- Existing `photo-mode-png-smoke.mjs` first runs `photo-mode-alpha-cases.mjs` in
  the real browser: native canvas transparency rejection, sparse corner alpha
  cases and decoded PNG RGBA equality. It then keeps the existing PlayCanvas
  framebuffer-vs-downloaded-PNG equality and native UI lifecycle checks.
- That PNG correctness test deliberately reads a second full framebuffer in its
  `toBlob` hook. Do not treat its duration as the readback performance benchmark.
- Use the separately bounded fixed-before/candidate campus A/B diagnostic for
  performance evidence. Keep the before revision
  `aa35d922716e726beb92d53d359c357f6276296c` and candidate identities distinct.
  Synthetic pass, successful evidence collection and device-gallery verification
  are different claims. No physical-device gallery result is established here.

Local browser execution is not a prerequisite workaround: when the task
executor denies browser sockets, run the existing authorized hosted CI workflow
rather than bypassing that restriction. Until hosted results exist, native
browser cases and campus performance remain unverified.
