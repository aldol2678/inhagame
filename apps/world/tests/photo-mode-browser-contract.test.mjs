import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('photo browser workflow runs isolated exact-head evidence with read-only permissions', () => {
  const path = new URL('../../../.github/workflows/photo-mode-browser.yml', import.meta.url);
  assert.equal(existsSync(path), true, 'a dedicated hosted gate exists');
  const workflow = readFileSync(path, 'utf8');
  assert.match(workflow, /contents: read/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /PHOTO_MODE_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  for (const smoke of ['photo-mode-smoke.mjs', 'photo-mode-png-smoke.mjs', 'photo-mode-campus-smoke.mjs']) assert.match(workflow, new RegExp(smoke.replace('.', '\\.')));
  assert.match(workflow, /node --test apps\/world\/tests\/photo-\*\.test\.mjs/);
  assert.match(workflow, /if: always\(\)/); assert.doesNotMatch(workflow, /secrets\.|pull_request_target|contents: write|PHOTO_MODE_QA_CASES/);
  assert.equal(existsSync(new URL('../../../.github/workflows/inkyung-photo-browser.yml', import.meta.url)), false, 'the lake-only gate is retired');
});

test('synthetic controls smoke binds evidence to the requested head and covers desktop, portrait and landscape', () => {
  const source = read('./browser/photo-mode-smoke.mjs');
  assert.match(source, /process\.env\.PHOTO_MODE_HEAD_SHA/);
  assert.match(source, /assert\.equal\(report\.head, expectedHead/);
  assert.match(source, /if \(!process\.env\.WORLD_SMOKE_BROWSER\)/);
  assert.match(source, /assert\.deepEqual\(served, report\.sourceHashes\)/);
  assert.match(source, /\['portrait', \{ width: 390, height: 844 \}\], \['landscape', \{ width: 844, height: 390 \}\]/);
  assert.match(source, /Input\.dispatchTouchEvent/);
  assert.match(source, /entry frame is the play frame/);
  assert.match(source, /Shift precision travel ratio/);
  assert.match(source, /report\.status = only\.size === 3 \? 'PASS' : 'PARTIAL'/, 'a filtered local run never reports PASS');
});

test('PNG smoke decodes downloaded bytes and compares all pixels with the grid on, with explicit renderer identity', () => {
  const source = read('./browser/photo-mode-png-smoke.mjs');
  assert.match(source, /assert\.equal\(report\.head, expectedHead\)/);
  assert.match(source, /assert\.deepEqual\(served, report\.sourceHashes\)/);
  assert.match(source, /await download\.saveAs/);
  assert.match(source, /createImageBitmap\(new Blob/);
  assert.match(source, /panel\.setGrid\('thirds'\)/);
  assert.match(source, /assert\.equal\(decoded\.hash, decoded\.expected/);
  assert.match(source, /never silently count a fallback renderer/);
  assert.match(source, /'escape', 'account', 'pagehide', 'takeover'/);
});

test('actual campus smoke opens anywhere, saves a decoded native-resolution PNG and covers every viewport', () => {
  const source = read('./browser/photo-mode-campus-smoke.mjs');
  assert.match(source, /async function placeAnywhere\(page\)/);
  assert.match(source, /Math\.hypot\(x - lake\.position\.x, z - lake\.position\.z\) < 40/, 'deliberately away from the lake');
  assert.match(source, /async function capture\(page, entry, trigger, name\)/);
  assert.match(source, /createImageBitmap\(new Blob/);
  assert.match(source, /Actual-campus saved PNG must not be blank/);
  assert.match(source, /rooms\.enter\('ROOM_CLUBHOUSE_01'\)/);
  assert.match(source, /touchCase\(startSmoke, TIMEOUT_MS, 'portrait'/); assert.match(source, /touchCase\(startSmoke, TIMEOUT_MS, 'landscape'/);
  assert.match(source, /src\/photo\/photo-camera-controller\.js/);
});
