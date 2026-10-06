import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const file = new URL('./browser/biryong-resume-smoke.mjs', import.meta.url);
test('regional resume has exact-head hosted-only offline acceptance without local browser fallback', () => {
  assert.equal(existsSync(file), true, 'the resume acceptance script exists');
  const source = readFileSync(file, 'utf8');
  assert.ok(source.indexOf('assertHostedBrowserExecution(process.env)') < source.indexOf("await import('./harness.mjs')"));
  assert.match(source, /EXPECTED_BIRYONG_HEAD/);
  assert.match(source, /await page.reload/);
  assert.match(source, /savedAt > seededAt/);
  assert.match(source, /BIRYONG_REALM/);
  assert.match(source, /invalid/);
  assert.match(source, /invalid\.position\.z - MAIN_GATE_SPAWN\.z/);
  const workflow = readFileSync(new URL('../../../.github/workflows/biryong-map-guidance-browser.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node apps\/world\/tests\/browser\/biryong-resume-smoke.mjs/);
});
