import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../promo/capture-manifest.v1.json', import.meta.url), 'utf8'));
const runner = readFileSync(new URL('./browser/promo-capture.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../../.github/workflows/world-promo-capture.yml', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../promo/README.md', import.meta.url), 'utf8');

const ids = manifest.shots.map(shot => shot.id);

test('Promo Capture v1 manifest is bounded, semantic and deterministic', () => {
  assert.equal(manifest.schema, 'inha-world.promo-capture.v1');
  assert.deepEqual(manifest.environment, {time: 'day', weather: 'clear'});
  assert.deepEqual(manifest.output, {width: 1280, height: 720, timelineFps: 30, container: 'webm'});
  assert.ok(manifest.shots.length >= 3 && manifest.shots.length <= 12);
  assert.equal(new Set(ids).size, ids.length);
  for (const shot of manifest.shots) {
    assert.match(shot.id, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.ok(['walk', 'orbit', 'ui'].includes(shot.kind));
    assert.ok(Number.isInteger(shot.durationMs) && shot.durationMs >= 1000 && shot.durationMs <= 10_000);
    assert.ok(!('x' in shot) && !('z' in shot), `${shot.id}: manifest must use semantic targets, not brittle world coordinates`);
  }
  assert.ok(manifest.shots.some(shot => shot.kind === 'walk'));
  assert.ok(manifest.shots.some(shot => shot.kind === 'orbit'));
  assert.ok(manifest.shots.some(shot => shot.kind === 'ui'));
});

test('runner uses the existing offline real-render harness and emits edit metadata', () => {
  assert.match(runner, /startSmoke/);
  assert.match(runner, /recordVideo/);
  assert.match(runner, /offline-real-render/);
  assert.match(runner, /productionClaim:\s*false/);
  assert.match(runner, /capture-index\.json/);
  assert.match(runner, /edit = \{inMs, outMs, durationMs:/);
  assert.match(runner, /page\.keyboard\.down/);
  assert.match(runner, /full-map-set-destination/);
  assert.match(runner, /import\('\/src\/basic-campus\.js'\)/);
  assert.match(runner, /import\('\/src\/student-center-frame\.js'\)/);
  assert.doesNotMatch(runner, /https:\/\/inhagame\.app|vercel\.app|SUPABASE_SERVICE|secret/i);
});

test('capture workflow is manual, read-only and cannot deploy Production', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /EXPECTED_PROMO_HEAD/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.doesNotMatch(workflow, /pull_request:|push:|schedule:|contents: write|deploy|vercel|supabase|secrets\./i);
});

test('guide contains an explicit Opus handoff contract', () => {
  assert.match(guide, /Opus/i);
  assert.match(guide, /capture-index\.json/);
  assert.match(guide, /production/i);
  assert.match(guide, /inMs/);
  assert.match(guide, /outMs/);
});
