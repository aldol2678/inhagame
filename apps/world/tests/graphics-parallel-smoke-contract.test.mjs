import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [smoke, main, campus, harness] = await Promise.all([
  read('./browser/graphics-parallel-smoke.mjs'), read('../src/main.js'),
  read('../campus/index.html'), read('./browser/harness.mjs')
]);

// Execute the actual page.evaluate sampler with a deterministic clock and real
// event subscriptions, without importing the browser-launching smoke module.
function renderedSampleFixture() {
  const start = smoke.indexOf('async function renderedSample() {');
  const end = smoke.indexOf('\ntry {', start);
  assert.ok(start >= 0 && end > start, 'rendered sample function seam');
  const app = new EventEmitter(), timers = new Map(), callbacks = [];
  let now = 0, nextTimer = 0;
  const sample = runInNewContext(`${smoke.slice(start, end)}\nrenderedSample();`, {
    page: { evaluate: callback => callback() },
    window: { __INHAGAME_P0__: { app } },
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay }); callbacks.push(callback);
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  const update = app.listeners('update')[0], render = app.listeners('postrender')[0];
  const advance = target => {
    assert.ok(target >= now, 'clock is monotonic');
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at; timers.delete(id); timer.callback();
    }
    now = target;
  };
  return {
    app, timers, sample, advance,
    frame(at, withUpdate = true) {
      advance(at);
      if (withUpdate) app.emit('update');
      app.emit('postrender');
    },
    assertClean() {
      assert.equal(app.listenerCount('update'), 0);
      assert.equal(app.listenerCount('postrender'), 0);
      assert.equal(timers.size, 0);
    },
    invokeLateCallbacks() {
      // Even an already-queued event/timer cannot mutate the settled receipt.
      update(); render(); callbacks.forEach(callback => callback());
    },
    frameWithDelayedTimers(at) {
      now = at; update(); render();
    }
  };
}

function checkFramePacing(pacing, receipt = { checks: {} }) {
  const start = smoke.indexOf('  receipt.checks.framePacing = pacing;');
  const end = smoke.indexOf('\n\n', start);
  assert.ok(start >= 0 && end > start, 'pacing receipt and assertion seam');
  runInNewContext(smoke.slice(start, end), { pacing, receipt, assert });
  return receipt;
}

test('render sampler keeps the 2.5-second fast path and cleans up every callback', async () => {
  const fixture = renderedSampleFixture();
  for (let at = 40; at < 2500; at += 40) fixture.frame(at);
  assert.equal(fixture.app.listenerCount('postrender'), 1, 'three frames do not shorten observation');
  fixture.advance(2500);
  const pacing = await fixture.sample;
  assert.equal(pacing.endReason, 'sample-complete');
  assert.equal(pacing.minimumDurationMs, 2500);
  assert.equal(pacing.maximumDurationMs, 10000);
  assert.equal(pacing.minimumRenders, 3);
  assert.equal(pacing.elapsedMs, 2500);
  assert.equal(pacing.renders, 62);
  assert.equal(pacing.updates, 62);
  assert.equal(pacing.renderedFps, 62 * 1000 / 2500);
  assert.deepEqual([...pacing.intervals], Array(61).fill(40));
  assert.equal(pacing.p50Ms, 40); assert.equal(pacing.p95Ms, 40);
  checkFramePacing(pacing);
  fixture.assertClean();
  const saved = JSON.stringify(pacing);
  fixture.advance(20000); fixture.invokeLateCallbacks();
  assert.equal(JSON.stringify(pacing), saved);
  fixture.assertClean();
});

test('slow renderer completes on its third actual frame using the full elapsed observation', async () => {
  const fixture = renderedSampleFixture();
  fixture.frame(500); fixture.frame(2200); fixture.advance(2500);
  assert.equal(fixture.app.listenerCount('postrender'), 1, 'two frames keep the sampler open');
  assert.equal(fixture.timers.size, 1, 'only the fixed deadline remains');
  fixture.frame(7000);
  const pacing = await fixture.sample;
  assert.equal(pacing.endReason, 'sample-complete');
  assert.equal(pacing.renders, 3); assert.equal(pacing.updates, 3);
  assert.equal(pacing.elapsedMs, 7000);
  assert.equal(pacing.renderedFps, 3 * 1000 / 7000);
  assert.deepEqual([...pacing.intervals], [1700, 4800]);
  assert.equal(pacing.p50Ms, 4800); assert.equal(pacing.p95Ms, 4800);
  checkFramePacing(pacing);
  fixture.assertClean();
});

for (const frameTimes of [[], [500, 2200]]) {
  test(`stalled renderer with ${frameTimes.length} frames reaches its deadline and retains the failing receipt`, async () => {
    const fixture = renderedSampleFixture();
    frameTimes.forEach(at => fixture.frame(at));
    fixture.advance(9999);
    assert.equal(fixture.app.listenerCount('postrender'), 1);
    fixture.advance(10000);
    const pacing = await fixture.sample;
    assert.equal(pacing.endReason, 'deadline');
    assert.equal(pacing.elapsedMs, 10000);
    assert.equal(pacing.renders, frameTimes.length);
    assert.equal(pacing.updates, frameTimes.length);
    assert.equal(pacing.renderedFps, frameTimes.length * 1000 / 10000);
    const receipt = { checks: {} };
    assert.throws(() => checkFramePacing(pacing, receipt), /need actual rendered frames/);
    assert.equal(receipt.checks.framePacing, pacing, 'diagnostics survive the original minimum-frame assertion');
    fixture.assertClean();
    const saved = JSON.stringify(pacing);
    fixture.advance(20000); fixture.invokeLateCallbacks();
    assert.equal(JSON.stringify(pacing), saved, 'late callbacks cannot pollute the receipt');
    fixture.assertClean();
  });
}

test('a delayed deadline timer cannot admit a third frame outside the bounded sample', async () => {
  const fixture = renderedSampleFixture();
  fixture.frame(500); fixture.frame(2200); fixture.advance(2500);
  fixture.frameWithDelayedTimers(10500);
  const pacing = await fixture.sample;
  assert.equal(pacing.endReason, 'deadline');
  assert.equal(pacing.renders, 2);
  assert.equal(pacing.updates, 2);
  assert.equal(pacing.elapsedMs, 10500, 'reported elapsed time is actual, not clamped to the deadline');
  assert.equal(pacing.renderedFps, 2 * 1000 / 10500);
  assert.throws(() => checkFramePacing(pacing), /need actual rendered frames/);
  fixture.assertClean();
});

test('event-driven sampling retains the original simulation and 30 FPS ceiling gates', async () => {
  const tooFast = renderedSampleFixture();
  for (let at = 10; at < 2500; at += 10) tooFast.frame(at);
  tooFast.advance(2500);
  const fastPacing = await tooFast.sample;
  assert.throws(() => checkFramePacing(fastPacing), /30 FPS ceiling with scheduling tolerance/);
  tooFast.assertClean();
  const noUpdates = renderedSampleFixture();
  [100, 200, 300].forEach(at => noUpdates.frame(at, false));
  noUpdates.advance(2500);
  const noUpdatePacing = await noUpdates.sample;
  assert.throws(() => checkFramePacing(noUpdatePacing), /pacing must not stop simulation updates/);
  noUpdates.assertClean();
  assert.match(smoke, /const pacing = await renderedSample\(\);\s+receipt\.checks\.framePacing = pacing;\s+assert\.ok\(pacing\.renders > 2/);
  checkFramePacing({ updates: 85, renders: 85, renderedFps: 34 });
  assert.throws(() => checkFramePacing({ updates: 85, renders: 85, renderedFps: 34.001 }), /30 FPS ceiling/);
});
test('graphics smoke parses without launching browser', () => {
  const result = spawnSync(process.execPath, ['--check', new URL('./browser/graphics-parallel-smoke.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('mock clock replaces exactly one construction seam and retains offline harness', () => {
  assert.equal(main.split('const worldClock = previewHost ? null : createNpcWorldClock();').length, 2);
  assert.match(smoke, /from '\.\/harness\.mjs'/);
  assert.match(smoke, /main\.replace\(needle/);
  assert.match(harness, /route\.abort\("blockedbyclient"\)/);
  assert.match(harness, /supabase-js stubbed/);
});
test('all fixed smoke ID selectors exist exactly once in campus markup', () => {
  const ids = new Set([...smoke.matchAll(/locator\('#([\w-]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size >= 10);
  for (const id of ids) assert.equal(campus.split(`id="${id}"`).length, 2, id);
});
test('smoke covers four workstreams, saves failure receipts and labels CI surrogate', () => {
  for (const marker of ['checks.settings', 'checks.framePacing', 'checks.contact', 'checks.daylight', 'checks.biryong',
    "receipt.status = 'FAIL'", 'report.json', "realDevice: false", 'CI_BROWSER_SURROGATE'])
    assert.ok(smoke.includes(marker), marker);
  assert.match(smoke, /app\.on\('postrender', render\)/);
  assert.match(smoke, /app\.off\('postrender', render\)/);
  assert.match(smoke, /returnToCampus\(\)/);
});
test('five-tier QA exercises the live graphics selector and persisted ULTRA choice', () => {
  for (const value of ["'very_low'", "'low'", "'medium'", "'high'", "'ultra'",
    'receipt.checks.fiveTiers', "graphics-five-tier-ultra",
    "assert.equal(sample.maxPixelRatio,ratio", "assert.equal(sample.shadowResolution,shadowResolution",
    "receipt.checks.fiveTiers.persistedUltra = true"]) {
    assert.ok(smoke.includes(value), value);
  }
});

test('settings dismissal checks ownership and native movement without forcibly releasing claims', () => {
  for (const marker of ['beforeFocus.owners.viewSettings, false', "beforeFocus.topOwners.includes('view-settings')",
    'beforeFocus.movement, true', "page.keyboard.down('w')", "page.keyboard.up('w')",
    "verifyMovementRestored('after-detail-controls')", "verifyMovementRestored('after-reset-and-quality')"])
    assert.ok(smoke.includes(marker), marker);
  assert.doesNotMatch(smoke, /inputFocus\.(?:release|clear)|controller\.setInputEnabled\(true\)/);
});
test('contact screenshots target an actual canonical garden receiver and restore temporary camera', async () => {
  const {campusBaseContactGeometry}=await import('../src/campus-contact-shading-layout.js');
  const {GARDEN_BENCHES}=await import('../src/library-garden-layout.js');
  const id=GARDEN_BENCHES[0].id;
  assert.ok(campusBaseContactGeometry().sources.some(s=>s.id===id&&s.receivers.includes('garden')));
  for(const marker of ['contact.activeMeshes>0', "b.name==='campus_contact_base'", 'source.id===view.benchId',
    'assert.deepEqual(await cameraState(),onCamera', "findByName('GraphicsContactQaCamera')?.destroy()",
    'd.player.enabled=s.playerEnabled', 'camera.enabled=s.cameraEnabled', "app.once('postrender',rendered)"])
    assert.ok(smoke.includes(marker),marker);
});
test('launch failures reach receipt finally and region return asserts visual settings', () => {
  assert.match(smoke, /try \{\n  if \(process\.env\.EXPECTED_GRAPHICS_HEAD\) assert\.equal[^\n]+\n  smoke = await startSmoke/);
  assert.ok(smoke.includes('smoke?.problems ?? []')); assert.ok(smoke.includes('await smoke?.close()'));
  assert.ok(smoke.includes('assert.equal(restored.canvasFilter,campusPresentation.canvasFilter'));
  assert.ok(smoke.includes('assert.equal(restored.toneMapping,campusPresentation.toneMapping'));
});

test('graphics browser QA runs independently of optimizer performance gates on the exact PR head', async () => {
  const workflow = await read('../../../.github/workflows/graphics-integration-browser.yml');
  const optimizer = await read('../../../.github/workflows/world-asset-optimizer.yml');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /EXPECTED_GRAPHICS_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.doesNotMatch(workflow, /needs:|continue-on-error|secrets\.|pull_request_target/);
  assert.doesNotMatch(optimizer, /run: node apps\/world\/tests\/browser\/graphics-parallel-smoke.mjs/);
  assert.match(smoke, /execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(smoke, /assert.equal\(receipt.exactHead, process.env.EXPECTED_GRAPHICS_HEAD/);
});
