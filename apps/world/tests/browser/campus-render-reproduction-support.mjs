import assert from 'node:assert/strict';

// Pin both checkouts to the instrumented revision, while verifying their identities separately.
// GITHUB_SHA can be a synthetic PR merge commit and is deliberately not consulted here.
export function assertReproductionSourceIdentity({ appHead, samplerHead }, env = process.env) {
  assert.ok(env.CAMPUS_REPRO_MODE === undefined || ['v1', 'async-v2'].includes(env.CAMPUS_REPRO_MODE), 'unknown campus reproduction mode');
  for (const key of ['CAMPUS_REPRO_APP_SHA', 'CAMPUS_REPRO_SAMPLER_SHA'])
    assert.match(env[key] ?? '', /^[0-9a-f]{40}$/, `${key} must be an explicit immutable commit SHA`);
  const pins = { app: env.CAMPUS_REPRO_APP_SHA, sampler: env.CAMPUS_REPRO_SAMPLER_SHA };
  if (env.CAMPUS_REPRO_MODE !== 'async-v2')
    assert.equal(pins.app, pins.sampler, 'application and sampler must use the same immutable revision containing instrumentation');
  assert.equal(appHead, pins.app, 'application checkout must match CAMPUS_REPRO_APP_SHA');
  assert.equal(samplerHead, pins.sampler, 'sampler checkout must match CAMPUS_REPRO_SAMPLER_SHA');
  return pins;
}
export const PROTOCOL = Object.freeze({ attempts: 2, sampleMs: 2500, appPngTimeoutMs: 10000,
  settleRenders: 3, phaseMs: 15000, viewport: Object.freeze({ width: 1280, height: 720 }),
  player: Object.freeze([0, 1.15, -98]), orbit: Object.freeze({ yaw: 0, pitch: .4, distance: 3.5, firstPerson: false }),
  graphics: Object.freeze({ preference: 'high', renderScale: 1, shadows: 'medium', frameLimit: 30 }),
  worldMinute: 10 });
export function assertSameCampusScene(before, after) {
  for (const key of ['viewport', 'drawingBuffer', 'driver', 'visible', 'inBiryong', 'position', 'camera',
    'cameraTransform', 'cameraFov', 'environment', 'graphics', 'photoActive', 'worldClockMs'])
    assert.deepEqual(after[key], before[key], `${key} changed between PNG and pacing`);
  assert.equal(after.visible, 'visible'); assert.equal(after.inBiryong, false); assert.equal(after.photoActive, true);
}
// Same event source, window and assertions as graphics-parallel-smoke. No RAF/FPS substitute.
export function sampleCampusPacing() {
  return new Promise(resolve => {
    const app = window.__INHAGAME_P0__.app;
    const state = () => ({ visibility: document.visibilityState, contextLost: app.graphicsDevice?.contextLost === true,
      autoRender: app.autoRender, renderNextFrame: app.renderNextFrame });
    const startState = state(), intervals = []; let previous = null, updates = 0, renders = 0;
    const start = performance.now();
    const update = () => { updates++; };
    const render = () => { const now = performance.now(); renders++;
      if (previous !== null) intervals.push(now - previous); previous = now; };
    app.on('update', update); app.on('postrender', render);
    setTimeout(() => {
      app.off('update', update); app.off('postrender', render);
      const elapsedMs = performance.now() - start, sorted = [...intervals].sort((a,b) => a-b);
      resolve({ startState, endState: state(), updates, renders, elapsedMs, renderedFps: renders * 1000 / elapsedMs,
        intervals, p50Ms: sorted[Math.floor(sorted.length * .5)] ?? null,
        p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] ?? null });
    }, 2500);
  });
}
export function assessPacing(sample) {
  const checks = { minimumThreeRenders: sample.renders > 2, simulationContinues: sample.updates >= sample.renders,
    ceiling34Fps: sample.renderedFps <= 34 };
  return { checks, passed: Object.values(checks).every(Boolean), real30FpsValidated: false };
}
export function readCampusScene() {
  const d = window.__INHAGAME_P0__, app = d.app, device = app.graphicsDevice, gl = device.gl;
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const p = d.player.getLocalPosition(), g = d.graphics.status(), e = window.__INHAGAME_ENVIRONMENT__.status();
  const c = app.root.findByName('Camera').camera, cp = c.entity.getPosition(), cq = c.entity.getRotation();
  return { viewport: [innerWidth, innerHeight, devicePixelRatio], drawingBuffer: [device.canvas.width, device.canvas.height],
    driver: gl ? { vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) } : { renderer: 'WebGPU' },
    visible: document.visibilityState, inBiryong: d.biryongRealm.inBiryong, position: [p.x,p.y,p.z],
    camera: [d.orbit.yaw,d.orbit.pitch,d.orbit.distance,d.orbit.firstPerson],
    cameraTransform: [cp.x,cp.y,cp.z,cq.x,cq.y,cq.z,cq.w], cameraFov: c.fov,
    environment: { targetTime:e.targetTime,targetWeather:e.targetWeather,settled:e.settled,weatherSettled:e.weatherSettled,worldCycleSeconds:e.worldCycleSeconds },
    graphics: { tier:g.tier,frameLimit:g.frameLimit,renderScale:g.renderScale,shadowResolution:g.shadowResolution,castShadows:g.castShadows },
    photoActive: d.getStatus().photoMode.active, worldClockMs: window.__GRAPHICS_QA_CLOCK__.nowMs };
}
export function settleCampusRenders(count) {
  return new Promise(resolve => {
    const app = window.__INHAGAME_P0__.app; let renders = 0;
    const rendered = () => { if (++renders >= count) { app.off('postrender', rendered); resolve({ renders }); } };
    app.on('postrender', rendered);
  });
}
export function classifyReproduction(attempts) {
  if(attempts.some(run=>run.png?.success===false || run.pacing?.assessment?.passed===false))
    return 'OBSERVED_SEE_INDIVIDUAL_RESULTS';
  if(!attempts.some(run=>run.png || run.pacing))return 'NOT_MEASURED';
  return attempts.every(run=>run.status==='COLLECTED')?'NATURAL_FAILURE_NOT_REPRODUCED':'INCONCLUSIVE_PARTIAL';
}
