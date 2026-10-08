// QA-only diagnostic. Not a performance gate; never changes application source or budgets.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { boundedPerformancePhase } from './biryong-performance-diagnostics.mjs';
import { finalizeTraceDiagnostic } from './biryong-render-trace-cleanup.mjs';
import { TRACE_LIMITS, BoundedTrace, summarizeIntervals, assertResolutionControl, installWindowProbe, readTraceScene } from './biryong-render-trace-support.mjs';

const CONTROL_SHA = 'e49419c39d884515f2402a2f3a23fe4c754b8882';
const output = resolve(process.env.BIRYONG_TRACE_OUTPUT || 'test-results/biryong-render-trace');
const receipt = { schema: 'biryong-render-trace-v1', measurementClass: 'DIAGNOSTIC_ONLY',
  performanceAcceptance: 'NOT_EVALUATED', gpuTimeMeasured: false, status: 'RUNNING',
  limits: TRACE_LIMITS, source: null, samplerHead: process.env.GITHUB_SHA ?? null,
  note: 'CPU-wall spans include stalls; RAF/postrender are frame intervals, not GPU milliseconds. Profiling itself adds overhead. Single fresh browser, fixed LOW/Visual OFF, baseline-half-baseline is diagnostic only.',
  engineStatsWarning: 'Pinned production engine counters may be zero or uninitialized; hook spans and CPU profile are separate evidence. Draw calls from engine stats may lag one frame.',
  phases: [], windows: [] };
let smoke, page, cdp, fatal, originalRatio, traceActive = false, profilerActive = false;
await mkdir(output, { recursive: true });
const persist = () => writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
async function phase(label, work, timeoutMs = TRACE_LIMITS.phaseMs, useFatal = true) {
  const record = { label, state: 'RUNNING', startedAt: new Date().toISOString(), startedMs: Date.now() };
  receipt.phases.push(record); await persist();
  try {
    const result = await boundedPerformancePhase(work, { label, timeoutMs, fatal: useFatal ? fatal : null });
    record.state = 'DONE'; return result;
  } catch (error) { record.state = 'ERROR'; record.error = String(error); throw error; }
  finally { record.elapsedMs = Date.now() - record.startedMs; await persist(); }
}
async function collect(label, scale, baseline) {
  const window = { label, scale, status: 'RUNNING', artifacts: {}, sceneBefore: null, sceneAfter: null };
  receipt.windows.push(window); await persist();
  const trace = new BoundedTrace();
  const onData = ({ value }) => trace.add(value);
  let bufferUsageMax = 0, traceCompletion = null;
  const onUsage = ({ percentFull = 0 }) => { bufferUsageMax = Math.max(bufferUsageMax, percentFull); };
  const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  cdp.on('Tracing.dataCollected', onData);
  cdp.on('Tracing.bufferUsage', onUsage);
  try {
    window.sceneBefore = await phase(`${label}:scene-before`, () => page.evaluate(readTraceScene));
    assertResolutionControl(baseline, window.sceneBefore, scale);
    await phase(`${label}:start-trace`, async () => {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: TRACE_LIMITS.cpuIntervalUs });
      await cdp.send('Profiler.start'); profilerActive = true;
      await cdp.send('Tracing.start', { transferMode: 'ReportEvents', bufferUsageReportingInterval: 1000,
        traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 8192,
          includedCategories: ['devtools.timeline', 'v8', 'blink.user_timing', 'gpu', 'cc', 'toplevel'], excludedCategories: ['*'] } });
      traceActive = true;
      window.marker = `biryong-trace:${label}`;
      window.clock = await page.evaluate(installWindowProbe, { maxSamples: TRACE_LIMITS.maxSamples });
      await page.evaluate(name => performance.mark(`${name}:start`), window.marker);
    });
    // Host clock bounds collection even when requestAnimationFrame is starved.
    await phase(`${label}:sample`, async () => {
      await delay(TRACE_LIMITS.windowMs);
      window.samples = await page.evaluate(name => {
        performance.mark(`${name}:end`);
        return window.__BIRYONG_TRACE_WINDOW__.stop();
      }, window.marker);
    });
    window.sceneAfter = await phase(`${label}:scene-after`, () => page.evaluate(readTraceScene));
    assertResolutionControl(baseline, window.sceneAfter, scale);
    assert.ok(window.samples.frames.length >= 2 && window.samples.raf.length >= 2 && window.samples.postrender.length >= 2, 'at least two samples per stream required');
    assert.ok(window.samples.frames.every(f => JSON.stringify(f.drawingBuffer) === JSON.stringify(window.sceneBefore.drawingBuffer)), 'drawing buffer drifted inside sample window');
    window.summary = { rafInterval: summarizeIntervals(window.samples.raf.map(s => s.intervalMs)),
      postrenderInterval: summarizeIntervals(window.samples.postrender.map(s => s.intervalMs)),
      updateCpuWall: summarizeIntervals(window.samples.frames.map(s => s.updateCpuWallMs)),
      renderSubmissionCpuWall: summarizeIntervals(window.samples.frames.map(s => s.renderSubmissionCpuWallMs)) };
    window.status = 'COLLECTED';
  } catch (error) {
    window.error = String(error); throw error;
  } finally {
    // Each artifact is saved independently, including when another shutdown step fails.
    const errors = [];
    if (!window.samples && window.clock) {
      try { window.samples = await phase(`${label}:recover-partial-samples`, () => page.evaluate(() => window.__BIRYONG_TRACE_WINDOW__?.stop()), TRACE_LIMITS.phaseMs, false); }
      catch (error) { errors.push(String(error)); }
    }
    if (profilerActive) {
      try {
        const { profile } = await phase(`${label}:stop-profile`, () => cdp.send('Profiler.stop'), TRACE_LIMITS.phaseMs, false);
        profilerActive = false;
        const data = JSON.stringify(profile), bytes = Buffer.byteLength(data);
        window.artifacts.cpuProfile = { bytes, capped: bytes > TRACE_LIMITS.maxProfileBytes };
        if (bytes <= TRACE_LIMITS.maxProfileBytes) {
          await writeFile(join(output, `${label}.cpuprofile`), data);
          window.artifacts.cpuProfile.file = `${label}.cpuprofile`;
        } else errors.push('CPU profile exceeded byte cap; omitted');
      } catch (error) { errors.push(String(error)); }
    }
    if (traceActive) {
      try { await phase(`${label}:stop-trace`, async () => { await cdp.send('Tracing.end'); traceCompletion = await completed; }, TRACE_LIMITS.phaseMs, false); traceActive = false; }
      catch (error) { errors.push(String(error)); }
    }
    cdp.off('Tracing.dataCollected', onData);
    cdp.off('Tracing.bufferUsage', onUsage);
    await writeFile(join(output, `${label}.trace.json`), JSON.stringify(trace.document()));
    window.artifacts.trace = { file: `${label}.trace.json`, bytes: trace.bytes, events: trace.events.length,
      truncated: trace.truncated, complete: !traceActive, bufferUsageMax, dataLossOccurred: traceCompletion?.dataLossOccurred ?? null };
    if (traceCompletion?.dataLossOccurred || bufferUsageMax >= .99) errors.push('Browser trace buffer filled or reported data loss; partial diagnostic only');
    if (trace.truncated || !trace.events.length) errors.push('Trace capped or empty; partial diagnostic only');
    if (window.status !== 'COLLECTED' || errors.length) window.status = 'PARTIAL';
    if (window.samples) window.samples.capped = {
      raf: window.samples.observedRaf - 1 > window.samples.raf.length,
      postrender: window.samples.observedPostrender - 1 > window.samples.postrender.length,
      frames: window.samples.observedFrames > window.samples.frames.length };
    window.artifactErrors = errors;
    await persist();
    if (errors.length) throw new Error(errors.join('; '));
  }
}
try {
  await phase('verify-source', async () => {
    assert.ok(process.env.BIRYONG_PERF_WORLD_ROOT, 'immutable control worldRoot is required');
    const root = resolve(process.env.BIRYONG_PERF_WORLD_ROOT);
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000 }).trim();
    receipt.source = { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
    assert.equal(receipt.source.head, CONTROL_SHA, 'trace only approved immutable main');
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'immutable control must have no tracked modifications');
  });
  smoke = await phase('start-offline-browser', () => startSmoke({ worldRoot: process.env.BIRYONG_PERF_WORLD_ROOT }), TIMEOUT_MS);
  await phase('create-fresh-page', async () => {
    page = await smoke.context.newPage(); fatal = smoke.watch(page);
    await page.addInitScript(() => localStorage.clear());
  });
  await phase('boot-fixed-low-off-scene', async () => {
    // Exact scenario from biryong-performance-smoke.mjs: no biryongVisual query.
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().loading?.finished === true, null, { timeout: TIMEOUT_MS });
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.biryongRealm.enter()), true);
    await page.waitForFunction(() => window.__INHAGAME_P0__?.biryongRealm?.inBiryong === true, null, { timeout: TIMEOUT_MS });
    await page.evaluate(() => {
      const r = window.__INHAGAME_P0__, p = r.player.getLocalPosition();
      r.player.setLocalPosition(0, p.y, 75);
      r.orbit.firstPerson = false; r.orbit.yaw = 0; r.orbit.pitch = Math.atan2(7.3, 18.5); r.orbit.distance = 3.5;
      r.graphics.setPreference('low');
    });
    await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus?.().graphics?.tier === 'low', null, { timeout: TIMEOUT_MS });
    await page.bringToFront();
  }, TIMEOUT_MS);
  cdp = await phase('create-cdp-session', () => smoke.context.newCDPSession(page));
  receipt.browser = await phase('browser-version', () => cdp.send('Browser.getVersion'));
  const settle = label => phase(`${label}:settle`, () => page.evaluate(() => new Promise(resolve => {
    let frames = 0; const next = () => ++frames >= 12 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next);
  })));
  await settle('initial');
  const baseline = await phase('baseline-scene', () => page.evaluate(readTraceScene));
  originalRatio = baseline.maxPixelRatio;
  assert.ok(baseline.cameraTransform.length === 7, 'active camera transform required');
  for (const [label, scale] of [['baseline-before', 1], ['half-resolution', .5], ['baseline-after', 1]]) {
    await phase(`${label}:resolution`, () => page.evaluate(({ ratio, scale }) => {
      // Only drawing buffer changes; preserve CSS viewport, graphics preferences and frame limiter.
      const app = window.__INHAGAME_P0__.app;
      app.graphicsDevice.maxPixelRatio = ratio * scale; app.resizeCanvas();
    }, { ratio: originalRatio, scale }));
    await settle(label);
    await collect(label, scale, baseline);
  }
  assert.deepEqual(smoke.problems, []);
  receipt.status = 'DIAGNOSTIC_COMPLETE';
} catch (error) {
  receipt.status = 'DIAGNOSTIC_PARTIAL'; receipt.error = String(error); process.exitCode = 1;
} finally {
  // Keep failures visible, and attempt bounded restoration before closing the fresh browser.
  fatal = null;
  if (page && originalRatio !== undefined) {
    try { await phase('restore-drawing-buffer', () => page.evaluate(ratio => {
      window.__BIRYONG_TRACE_WINDOW__?.stop();
      const app = window.__INHAGAME_P0__.app; app.graphicsDevice.maxPixelRatio = ratio; app.resizeCanvas();
    }, originalRatio)); } catch (error) { receipt.restoreError = String(error); receipt.status = 'DIAGNOSTIC_PARTIAL'; process.exitCode = 1; }
  }
  await finalizeTraceDiagnostic({ smoke, receipt, phase, persist,
    log: result => console.log('BIRYONG_RENDER_TRACE_RECEIPT', JSON.stringify(result)) });
}
