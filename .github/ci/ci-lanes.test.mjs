import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, isDocs, LANES } from './ci-lanes.mjs';

const lanes = (files) => LANES.filter((lane) => classify(files)[lane]);

test('an unknown or empty change set runs every lane', () => {
  assert.deepEqual(lanes(null), LANES);
  assert.deepEqual(lanes([]), LANES);
});
test('docs-only changes run no lane', () => {
  assert.deepEqual(lanes(['README.md', 'apps/world/tml/README.md', 'docs/plan.txt', 'LICENSE', 'NOTICE.md']), []);
  assert.equal(isDocs('apps/world/src/main.js'), false);
  assert.equal(isDocs('ASSET_PROVENANCE.json'), false);
});
test('World runtime changes run every lane', () => {
  assert.deepEqual(lanes(['apps/world/src/main.js']), LANES);
  assert.deepEqual(lanes(['apps/world/data/music/music.json']), LANES);
});
test('NPC and TML changes run NPC and browser lanes on top of static and db', () => {
  assert.deepEqual(lanes(['apps/world/npc-factory/quest-store.mjs']), LANES);
  assert.deepEqual(lanes(['apps/world/tml/runtime/trace.mjs']), LANES);
  assert.deepEqual(lanes(['.github/ci/npc-factory-tests.sh']), ['static', 'db', 'npc']);
});
test('World pages outside the runtime tree skip the NPC lane', () => {
  assert.deepEqual(lanes(['apps/world/campus/index.html']), ['static', 'db', 'browser']);
  assert.deepEqual(lanes(['apps/world/tests/browser/harness.mjs']), LANES);
  assert.deepEqual(lanes(['apps/shared/supabase-public-config.js']), ['static', 'db', 'browser']);
  assert.deepEqual(lanes(['.github/ci/world-browser-smoke.sh']), ['static', 'db', 'browser']);
});
test('DB-only and legacy-game-only changes run static and db only', () => {
  assert.deepEqual(lanes(['supabase/migrations/20261003000000_x.sql']), ['static', 'db']);
  assert.deepEqual(lanes(['supabase/tests/database/01_grants_contract.test.sql']), ['static', 'db']);
  assert.deepEqual(lanes(['apps/classic/index.html', 'apps/survival/index.html']), ['static', 'db']);
  assert.deepEqual(lanes(['apps/induckup/src/main.ts', 'apps/induck-grow/index.html']), ['static', 'db']);
});
test('docs mixed with code follow the code', () => {
  assert.deepEqual(lanes(['README.md', 'supabase/functions/verify-inha-mail/index.ts']), ['static', 'db']);
});
test('editing the lane wiring runs every lane', () => {
  assert.deepEqual(lanes(['.github/workflows/public-ci.yml']), LANES);
  assert.deepEqual(lanes(['.github/ci/ci-lanes.mjs']), LANES);
});
