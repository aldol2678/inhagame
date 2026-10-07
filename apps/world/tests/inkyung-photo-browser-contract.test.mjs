import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('photo browser workflow runs isolated exact-head evidence with read-only permissions', () => {
  const path = new URL('../../../.github/workflows/inkyung-photo-browser.yml', import.meta.url);
  assert.equal(existsSync(path), true, 'a dedicated hosted gate exists');
  const workflow = readFileSync(path, 'utf8');
  assert.match(workflow, /contents: read/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /PHOTO_MODE_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /inkyung-photo-mode-smoke\.mjs/); assert.match(workflow, /inkyung-photo-campus-smoke\.mjs/);
  assert.match(workflow, /if: always\(\)/); assert.doesNotMatch(workflow, /secrets\.|pull_request_target|contents: write/);
});

test('synthetic photo smoke binds evidence to the requested head and permits the established hosted Chrome channel', () => {
  const source = read('./browser/inkyung-photo-mode-smoke.mjs');
  assert.match(source, /process\.env\.PHOTO_MODE_HEAD_SHA/);
  assert.match(source, /assert\.equal\(report\.head, expectedHead/);
  assert.match(source, /if \(!process\.env\.WORLD_SMOKE_BROWSER\)/);
  assert.match(source, /assert\.deepEqual\(served, report\.sourceHashes\)/);
});


test('PNG smoke decodes downloaded bytes and compares all pixels, with explicit renderer identity', () => {
  const source = read('./browser/inkyung-photo-png-smoke.mjs');
  const workflow = read('../../../.github/workflows/inkyung-photo-browser.yml');
  assert.match(source, /assert\.equal\(report\.head, expectedHead\)/);
  assert.match(source, /assert\.deepEqual\(served, report\.sourceHashes\)/);
  assert.match(source, /await download\.saveAs/);
  assert.match(source, /createImageBitmap\(new Blob/);
  assert.match(source, /assert\.equal\(decoded\.hash, decoded\.expected/);
  assert.match(source, /never silently count a fallback renderer/);
  assert.match(source, /'escape', 'account', 'pagehide', 'takeover'/);
  assert.match(workflow, /inkyung-photo-png-smoke\.mjs/);
});

test('actual campus smoke activates PNG save and decodes downloaded nonblank native-resolution bytes', () => {
  const source = read('./browser/inkyung-photo-campus-smoke.mjs');
  assert.match(source, /async function saveCampusPhoto\(page, name, mobile\)/);
  assert.match(source, /entry\.downloads = \[await saveCampusPhoto\(page, name, mobile\)\]/);
  assert.match(source, /createImageBitmap\(new Blob/);
  assert.match(source, /Actual-campus saved PNG must not be blank/);
  assert.match(source, /const \[download\] = await Promise\.all\(/);
  assert.match(source, /src\/photo\/photo-capture\.js/);
});
