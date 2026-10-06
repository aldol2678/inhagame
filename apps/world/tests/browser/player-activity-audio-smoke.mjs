// Real Web Audio scheduling/cleanup with synthetic controller motion; no network writes.
// A human still needs to listen on headphones and phone/laptop speakers before audio sign-off.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output = path.resolve(process.env.ACTIVITY_AUDIO_QA_OUTPUT || 'test-results/player-activity-audio');
await mkdir(output, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const expectedHead = process.env.EXPECTED_ACTIVITY_AUDIO_HEAD;
assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/, 'EXPECTED_ACTIVITY_AUDIO_HEAD must identify the immutable candidate');
assert.equal(head, expectedHead, 'browser must test the exact candidate head');
const report = { head, expectedHead, status: 'RUNNING', audibleQa: 'NOT_PERFORMED', viewports: [], sourceHashes: {} };
for (const file of ['src/audio/activity-cues.js', 'src/audio/activity-surfaces.js', 'src/audio/player-activity-audio.js',
  'src/audio/world-audio.js', 'src/player-controller.js', 'src/main.js', 'tests/browser/player-activity-audio-harness.html',
  'tests/browser/player-activity-audio-smoke.mjs']) {
  report.sourceHashes[file] = createHash('sha256').update(await readFile(new URL(`../../${file}`, import.meta.url))).digest('hex');
}
try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const smoke = await startSmoke({ viewport });
    try {
      const page = await smoke.context.newPage(), fatal = smoke.watch(page);
      await page.goto(`${smoke.origin}/tests/browser/player-activity-audio-harness.html`);
      await Promise.race([page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__, null, { timeout: TIMEOUT_MS }), fatal]);
      const snapshot = () => page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.snapshot());
      const frames = options => page.evaluate(options => window.__ACTIVITY_AUDIO_QA__.frames(120, options), options);
      assert.equal((await snapshot()).audio.context, 'locked');
      assert.equal((await frames()).activity.steps, 0);
      await page.locator('#unlock').click();
      await page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__.snapshot().audio.context === 'running');
      await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.rms());
      const wall = await frames({ blocked: true });
      assert.equal(wall.activity.steps, 0);
      // Measure while the short burst is live in one browser turn, so a slow CDP
      // round trip cannot miss a correctly rendered 120 ms cue.
      const walk = await page.evaluate(async () => {
        const qa = window.__ACTIVITY_AUDIO_QA__;
        qa.frames(120);
        let peakRms = 0;
        const end = performance.now() + 250;
        while (performance.now() < end) {
          peakRms = Math.max(peakRms, qa.rms());
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        return { ...qa.snapshot(), peakRms };
      });
      assert.ok(walk.activity.steps > 0);
      assert.ok(walk.peakRms > .0001, 'generated activity signal reaches the master output');
      const audibleRms = walk.peakRms;
      assert.ok(walk.activity.activeSources <= 3);
      assert.equal(walk.contextCount, 1);
      await page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__.snapshot().activity.activeSources === 0);
      // Keep a known signal alive while muting: zero output must prove master-bus
      // attenuation, not merely an empty activity source set.
      await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.probeMaster());
      await page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__.rms() > .005);
      await page.locator('#mute').click();
      assert.equal((await frames()).activity.steps, walk.activity.steps);
      await page.waitForTimeout(400);
      const mutedRms = await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.rms());
      assert.equal((await snapshot()).masterProbeActive, true, 'mute RMS measured before the bounded probe ends');
      assert.ok(mutedRms < .00001, `muted generated output RMS ${mutedRms}`);
      await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.stopProbe());
      await page.locator('#mute').click();
      for (const surface of ['hard-outdoor', 'soft-outdoor', 'indoor-hard', 'indoor-soft']) {
        await page.locator('#surface').selectOption(surface);
        for (const gait of ['WALK', 'RUN']) {
          await page.locator('#gait').selectOption(gait);
          const before = (await snapshot()).activity.steps;
          const moved = await frames();
          assert.ok(moved.activity.steps > before);
          assert.equal(moved.activity.surface, surface);
          assert.equal(moved.activity.gait, gait);
          await page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__.snapshot().activity.activeSources === 0);
        }
      }
      for (const button of ['glass', 'wood', 'threshold']) await page.locator(`#${button}`).click();
      assert.equal((await snapshot()).activity.doors, 5);
      assert.ok((await snapshot()).activity.activeSources <= 3);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      assert.equal((await snapshot()).activity.activeSources, 0);
      const hidden = await snapshot(); await frames();
      assert.equal((await snapshot()).activity.steps, hidden.activity.steps);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      assert.equal((await snapshot()).contextCount, 1);
      await page.screenshot({ path: path.join(output, `${viewport.width}-activity.png`) });
      if (viewport.width === 1280) {
        const recording = await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.captureDemo());
        if (recording.base64) {
          for (const segment of recording.segments.filter(segment => Number.isInteger(segment.expectedSteps))) {
            assert.equal(segment.steps, segment.expectedSteps, segment.label);
            assert.ok(segment.maxRms > .0001, `${segment.label} has real output`);
            assert.ok(segment.peakSources <= 3, `${segment.label} respects the source cap`);
          }
          const bytes = Buffer.from(recording.base64, 'base64');
          assert.ok(bytes.length > 1000);
          await writeFile(path.join(output, 'generated-activity-demo.webm'), bytes);
          delete recording.base64;
          recording.file = 'generated-activity-demo.webm';
          recording.sha256 = createHash('sha256').update(bytes).digest('hex');
        }
        report.generatedAudio = recording;
      }
      await page.evaluate(() => window.__ACTIVITY_AUDIO_QA__.dispose());
      assert.equal((await snapshot()).activity.activeSources, 0);
      await page.waitForFunction(() => window.__ACTIVITY_AUDIO_QA__.snapshot().audio.context === 'closed');
      assert.deepEqual(smoke.problems, []);
      report.viewports.push({ ...viewport, status: 'PASS', audibleRms, mutedRms, final: await snapshot() });
    } finally { await smoke.close(); }
  }
  report.status = 'PASS';
} catch (error) { report.status = 'BLOCKED_OR_FAILED'; report.error = String(error?.stack ?? error); throw error; }
finally { await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); }
