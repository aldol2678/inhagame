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
