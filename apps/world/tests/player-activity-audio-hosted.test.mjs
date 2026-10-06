import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('activity hosted QA is read-only, exact-head and restricted to its slice', () => {
  const workflow = read('../../../.github/workflows/player-activity-audio-browser.yml');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /EXPECTED_ACTIVITY_AUDIO_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /player-activity-audio-smoke\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|secrets\.|npm publish|vercel|supabase/);
});

test('browser evidence verifies immutable head and records generated output without microphone access', () => {
  const smoke = read('browser/player-activity-audio-smoke.mjs');
  const fixture = read('browser/player-activity-audio-harness.html');
  assert.match(smoke, /assert\.equal\(head, expectedHead/);
  assert.match(smoke, /sourceHashes/);
  assert.match(smoke, /captureDemo/);
  assert.match(fixture, /createMediaStreamDestination/);
  assert.match(fixture, /new MediaRecorder/);
  assert.match(fixture, /getFloatTimeDomainData/);
  assert.doesNotMatch(fixture, /getUserMedia|getDisplayMedia/);
});

test('mute evidence attenuates an active known signal through the real master bus', () => {
  const smoke = read('browser/player-activity-audio-smoke.mjs');
  const fixture = read('browser/player-activity-audio-harness.html');
  assert.match(fixture, /source\.connect\(gain\); gain\.connect\(master\)/);
  assert.match(fixture, /source\.stop\(context\.currentTime \+ 2\)/);
  assert.match(smoke, /probeMaster\(\)/);
  const probe = smoke.indexOf('probeMaster()');
  const mute = smoke.indexOf("page.locator('#mute').click()", probe);
  const rms = smoke.indexOf('const mutedRms', mute);
  const stop = smoke.indexOf('stopProbe()', rms);
  assert.ok(probe >= 0 && mute > probe && rms > mute && stop > rms);
});
