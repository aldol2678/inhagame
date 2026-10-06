import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const workflowUrl = new URL('../../../.github/workflows/shop-panel-focus-browser.yml', import.meta.url);
const smoke = readFileSync(new URL('./browser/shop-panel-focus-smoke.mjs', import.meta.url), 'utf8');

test('shop hosted browser workflow checks out the exact PR head with read-only permission', () => {
  assert.ok(existsSync(workflowUrl), 'shop native keyboard acceptance has a hosted gate');
  const workflow = readFileSync(workflowUrl, 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /SHOP_FOCUS_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /node apps\/world\/tests\/browser\/shop-panel-focus-smoke\.mjs/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: test-results\/shop-panel-focus/);
});

test('shop browser evidence verifies the expected head and trusted keyboard events', () => {
  assert.match(smoke, /assert\.equal\(report\.head, process\.env\.SHOP_FOCUS_HEAD_SHA\)/);
  assert.match(smoke, /report\.trustedKeyboard/);
  assert.match(smoke, /event\.trusted/);
  assert.match(smoke, /event\.shiftKey/);
  assert.match(smoke, /\['Tab', 'Enter', 'Escape'\]/);
});
