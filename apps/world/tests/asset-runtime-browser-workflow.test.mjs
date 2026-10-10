import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file = new URL('../../../.github/workflows/asset-runtime-browser.yml', import.meta.url);
const source = () => readFileSync(file, 'utf8');
test('asset visual gate runs both real-engine fixtures without deployment privileges', () => {
  const text = source();
  assert.match(text, /pull_request:/);
  assert.match(text, /permissions:\s*\n\s+contents: read/);
  assert.match(text, /lane: \[fishing, life\]/);
  assert.match(text, /fail-fast: false/);
  assert.doesNotMatch(text, /pull_request_target|secrets\.|id-token:|contents: write|deploy|public-db\.sh/);
});
test('asset visual evidence is tied to exact PR head and preserved on failure', () => {
  const text = source();
  assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /EXPECTED_ASSET_RUNTIME_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(text, /if: always\(\)/);
  assert.match(text, /name: asset-runtime-\$\{\{ matrix\.lane \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(text, /if-no-files-found: error/);
});
test('asset visual gate uses installed pinned browser engine and explicit WebGL2 fixtures', () => {
  const text = source();
  assert.match(text, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(text, /npx --no-install playwright install --with-deps chromium/);
  assert.match(text, /WORLD_SMOKE_DISABLE_WEBGPU: '1'/);
  assert.match(text, /node apps\/world\/tests\/browser\/fishing-assets-smoke\.mjs/);
  assert.match(text, /node apps\/world\/tests\/browser\/life-props-browser-smoke\.mjs/);
  assert.match(text, /timeout-minutes: 15/);
});
