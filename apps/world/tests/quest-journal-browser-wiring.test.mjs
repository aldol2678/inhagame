import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const workflow = new URL('../../../.github/workflows/quest-journal-controls-browser.yml', import.meta.url);
test('hosted quest controls gate uses exact head, read-only permissions and offline keyboard runner', () => {
  assert.ok(existsSync(workflow), 'dedicated exact-head browser gate exists');
  const source = readFileSync(workflow, 'utf8');
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /contents: read/);
  assert.match(source, /QUEST_CONTROLS_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /node apps\/world\/tests\/browser\/quest-journal-controls-smoke\.mjs/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(source, /pull_request_target|contents: write|deploy|SUPABASE_ACCESS_TOKEN/);
});
