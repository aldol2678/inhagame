import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('manual P0-C preview stays isolated from production NPC authority', async () => {
  const [html, page, worker] = await Promise.all([
    read('recast-crowd-preview.html'),
    read('recast-crowd-preview.mjs'),
    read('recast-crowd-preview-worker.mjs')
  ]);
  assert.match(html, /P0-C · MANUAL DEVICE PREVIEW/);
  assert.match(html, /data-tier="48"/);
  assert.match(html, /data-tier="100"/);
  assert.match(html, /data-tier="200"/);
  assert.match(page, /new Worker\(new URL\('\.\/recast-crowd-preview-worker\.mjs'/);
  assert.match(page, /__INHA_NATIVE_P0C__/);
  assert.match(worker, /authorityEffect: 'NONE'/);
  assert.match(worker, /productionCutover: false/);
  assert.match(worker, /validateRecastArtifact/);
  assert.match(worker, /loadPinnedRecast/);
  assert.match(worker, /new core\.Crowd/);
  assert.doesNotMatch(worker, /dev-runtime\.mjs/);
});
