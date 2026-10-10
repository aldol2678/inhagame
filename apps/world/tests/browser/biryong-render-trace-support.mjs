import assert from 'node:assert/strict';

export const TRACE_LIMITS = Object.freeze({ windowMs: 8000, maxSamples: 120,
  maxTraceBytes: 8 * 1024 * 1024, maxTraceEvents: 50_000, maxProfileBytes: 4 * 1024 * 1024,
  phaseMs: 15_000, cpuIntervalUs: 2000 });

// Keep a valid JSON document even if collection is truncated or CDP shutdown fails.
export class BoundedTrace {
  constructor({ maxBytes = TRACE_LIMITS.maxTraceBytes, maxEvents = TRACE_LIMITS.maxTraceEvents } = {}) {
    this.maxBytes = maxBytes; this.maxEvents = maxEvents;
    this.events = []; this.bytes = Buffer.byteLength(JSON.stringify({ traceEvents: [] })); this.truncated = false;
  }
  add(events) {
    for (const event of events) {
      if (this.truncated) break;
      const bytes = Buffer.byteLength(JSON.stringify(event)) + (this.events.length ? 1 : 0);
      if (this.events.length >= this.maxEvents || this.bytes + bytes > this.maxBytes) { this.truncated = true; break; }
      this.events.push(event); this.bytes += bytes;
    }
  }
  document() { return { traceEvents: this.events }; }
}
// Output truncation is recoverable only after valid samples and successful CDP cleanup.
// Keep every other artifact failure fatal; partial evidence never becomes acceptance.
export function traceWindowCompletion({ collected, trace, errors }) {
  const fatalErrors = [...errors];
  if (!trace.complete) fatalErrors.push('Trace collection did not stop cleanly');
  if (trace.dataLossOccurred || trace.bufferUsageMax >= .99)
    fatalErrors.push('Browser trace buffer filled or reported data loss; partial diagnostic only');
  if (!trace.events) fatalErrors.push('Trace empty; partial diagnostic only');
  const warnings = trace.truncated ? ['Trace output capped; partial diagnostic only'] : [];
  return {
    status: collected && !fatalErrors.length && !warnings.length ? 'COLLECTED' : 'PARTIAL',
    artifactErrors: [...fatalErrors, ...warnings],
    recoverableArtifactWarnings: collected && !fatalErrors.length ? warnings : [],
    fatalErrors
  };
}
export async function runTraceSequence(collectWindow) {
  let status = 'DIAGNOSTIC_COMPLETE';
  for (const [label, scale] of [['baseline-before', 1], ['half-resolution', .5], ['baseline-after', 1]]) {
    const window = await collectWindow(label, scale);
    assert.ok(['COLLECTED', 'PARTIAL'].includes(window?.status), 'window completion status required');
    if (window.status === 'PARTIAL') status = 'DIAGNOSTIC_PARTIAL';
  }
  return status;
}

export function summarizeIntervals(values) {
  const valid = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return { sampleCount: valid.length, meanMs: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    p95Ms: valid.length ? valid[Math.ceil(valid.length * .95) - 1] : null };
}
export function assertResolutionControl(baseline, current, scale) {
  assert.ok(baseline && current, 'baseline and current scene required');
  for (const key of ['viewport', 'driver', 'camera', 'environment', 'graphics', 'visible', 'inBiryong', 'renderComponents'])
    assert.deepEqual(current[key], baseline[key], `${key} changed during drawing-buffer control`);
  for (const key of ['position', 'cameraTransform']) {
    assert.equal(current[key].length, baseline[key].length, key);
    current[key].forEach((v, i) => assert.ok(Math.abs(v - baseline[key][i]) < .01, `${key} drift`));
  }
  assert.deepEqual(current.drawingBuffer, baseline.drawingBuffer.map(n => Math.floor(n * scale)), 'drawingBuffer must match requested control');
  assert.equal(current.visible, 'visible'); assert.equal(current.inBiryong, true);
  assert.equal(current.graphics.tier, 'low'); assert.equal(current.graphics.castShadows, false);
}

// Serialized into the offline test page; hooks measure synchronous elapsed CPU-wall time,
// including stalls. They are not GPU timer queries. No engine methods are replaced.
export function installWindowProbe({ maxSamples }) {
  const runtime = window.__INHAGAME_P0__, app = runtime.app;
  const state = { start: performance.now(), end: null, raf: [], postrender: [], frames: [],
    observedRaf: 0, observedPostrender: 0, observedFrames: 0 };
  let rafId, updateStart = null, renderStart = null, lastRaf = null, lastPost = null, stopped = false, rendered = false;
  const frameupdate = () => { updateStart = performance.now(); renderStart = null; rendered = false; };
  const framerender = () => { renderStart = performance.now(); };
  const postrender = () => {
    const now = performance.now(); state.observedPostrender++; rendered = true;
    if (lastPost !== null && state.postrender.length < maxSamples) state.postrender.push({ at: now, intervalMs: now - lastPost });
    lastPost = now;
  };
  const frameend = () => {
    const now = performance.now(), f = app.stats?.frame;
    state.observedFrames++;
    if (state.frames.length >= maxSamples) return;
    state.frames.push({ at: now, engineFrame: app.frame,
      updateCpuWallMs: updateStart !== null && renderStart !== null ? renderStart - updateStart : null,
      renderSubmissionCpuWallMs: rendered && renderStart !== null ? now - renderStart : null,
      renderOccurred: rendered,
      // Some production engine builds leave profiling counters zero/uninitialized.
      // Preserve raw counters for inspection, never use them as authoritative timings.
      engineStatsRaw: Object.fromEntries(['updateTime', 'renderTime', 'scriptUpdate', 'scriptPostUpdate', 'animUpdate', 'cullTime', 'sortTime', 'forwardTime'].map(k => [k, Number.isFinite(f?.[k]) ? f[k] : null])),
      drawCalls: app.stats?.drawCalls?.total ?? null,
      drawingBuffer: [app.graphicsDevice.canvas.width, app.graphicsDevice.canvas.height] });
  };
  const raf = timestamp => {
    if (stopped) return;
    state.observedRaf++;
    if (lastRaf !== null && state.raf.length < maxSamples) state.raf.push({ at: performance.now(), timestamp, intervalMs: timestamp - lastRaf });
    lastRaf = timestamp; rafId = requestAnimationFrame(raf);
  };
  app.on('frameupdate', frameupdate); app.on('framerender', framerender);
  app.on('postrender', postrender); app.on('frameend', frameend);
  rafId = requestAnimationFrame(raf);
  window.__BIRYONG_TRACE_WINDOW__ = { stop() {
    stopped = true; cancelAnimationFrame(rafId);
    app.off('frameupdate', frameupdate); app.off('framerender', framerender);
    app.off('postrender', postrender); app.off('frameend', frameend);
    state.end = performance.now(); return state;
  } };
  return { start: state.start, timeOrigin: performance.timeOrigin };
}

export function readTraceScene() {
  const runtime = window.__INHAGAME_P0__, app = runtime.app, device = app.graphicsDevice, gl = device.gl;
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const p = runtime.player.getLocalPosition(), g = runtime.graphics.status();
  const e = window.__INHAGAME_ENVIRONMENT__.status();
  const camera = app.root.findComponents('camera').find(c => c.enabled && c.entity.enabled);
  const cp = camera?.entity.getPosition(), cq = camera?.entity.getRotation();
  return { viewport: [innerWidth, innerHeight, devicePixelRatio], drawingBuffer: [device.canvas.width, device.canvas.height],
    driver: gl ? { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) } : { renderer: 'WebGPU' },
    visible: document.visibilityState, inBiryong: runtime.biryongRealm.inBiryong,
    position: [p.x, p.y, p.z], camera: [runtime.orbit.yaw, runtime.orbit.pitch, runtime.orbit.distance, runtime.orbit.firstPerson],
    cameraTransform: cp && cq ? [cp.x, cp.y, cp.z, cq.x, cq.y, cq.z, cq.w] : [],
    environment: [e.targetTime, e.targetWeather], graphics: { tier: g.tier, frameLimit: g.frameLimit ?? 'auto',
      renderScale: g.renderScale ?? 'auto', shadowResolution: g.shadowResolution, castShadows: g.castShadows },
    renderComponents: app.root.findComponents('render').length, drawCalls: app.stats?.drawCalls?.total ?? null,
    maxPixelRatio: device.maxPixelRatio };
}
