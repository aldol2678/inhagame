import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const workflow = new URL('../../../.github/workflows/daily-panel-focus-browser.yml', import.meta.url);
const smoke = new URL('./browser/daily-panel-focus-smoke.mjs', import.meta.url);

test('daily panel browser CI checks the exact PR head with read-only permissions and retains evidence', async () => {
  assert.equal(await access(workflow).then(() => true, () => false), true, 'dedicated workflow exists');
  const source = await readFile(workflow, 'utf8');
  assert.match(source, /contents: read/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /DAILY_PANEL_FOCUS_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /node apps\/world\/tests\/browser\/daily-panel-focus-smoke\.mjs/);
  assert.match(source, /if: always\(\)/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /if-no-files-found: error/);
  assert.doesNotMatch(source, /pull_request_target|secrets\.|contents: write/);
});

test('daily panel browser acceptance records and enforces expected head before launch', async () => {
  const source = await readFile(smoke, 'utf8');
  assert.match(source, /expectedHead: process\.env\.DAILY_PANEL_FOCUS_HEAD/);
  assert.match(source, /assert\.equal\(report\.head, report\.expectedHead/);
  assert.ok(source.indexOf('assert.equal(report.head, report.expectedHead') < source.indexOf('await chromium.launch'));
  assert.match(source, /assert\.deepEqual\(item\.servedSourceHashes, report\.sourceHashes\)/);
  for (const path of ['styles.css', 'npc-factory/quest-reward-shape.mjs', 'tests/browser/daily-panel-focus-fixture.mjs', 'tests/browser/daily-panel-focus-harness.html']) {
    assert.ok(source.includes(`'${path}'`), `receipt includes ${path}`);
  }
});

test('daily panel browser acceptance covers desktop, mobile portrait and mobile landscape', async () => {
  const source = await readFile(smoke, 'utf8');
  for (const label of ['desktop', 'mobile-portrait', 'mobile-landscape']) assert.match(source, new RegExp(`label: '${label}'`));
  assert.match(source, /width: 360, height: 800/);
  assert.match(source, /width: 800, height: 360/);
  assert.match(source, /for \(const kind of \['attendance', 'quiz'\]\) for \(const device of devices\)/);
  assert.match(source, /press\('Shift\+Tab'\)/);
  assert.match(source, /requests\.length\), 2/);
});
