import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const file = new URL('../workflows/main3-shop-visit.yml', import.meta.url);
const workflow = existsSync(file) ? readFileSync(file, 'utf8') : '';
const jobs = name => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';

test('Main3 acceptance is a narrow pull-request-only read-only workflow', () => {
  assert.match(workflow, /^on:\n  pull_request:\n    paths:/m);
  for (const path of ['apps/world/npc-factory/main3-*', 'apps/world/src/quest/**', 'apps/world/src/shop/**', 'supabase/migrations/**', 'supabase/tests/database/**', '.github/workflows/main3-shop-visit.yml', '.github/ci/main3-workflow-contract.test.mjs']) {
    assert.ok(workflow.includes(`'${path}'`), `${path} must trigger its acceptance`);
  }
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch|secrets\.|contents: write|id-token:|environment:|gcloud|supabase (?:link|db push)|deploy|preview/i);
});

test('database and browser jobs each bind to the exact head without persisted credentials', () => {
  assert.match(workflow, /EXPECTED_MAIN3_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /MAIN3_QA_OUTPUT: test-results\/main3-shop-visit/);
  for (const name of ['database', 'chromium']) {
    const job = jobs(name);
    assert.ok(job, `${name} job exists`);
    assert.match(job, /runs-on: ubuntu-latest/);
    assert.match(job, /timeout-minutes: \d+/);
    assert.match(job, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
    assert.match(job, /persist-credentials: false/);
    assert.match(job, /node-version: '24\.19\.0'/);
    assert.match(job, /git rev-parse HEAD/);
    assert.match(job, /git rev-parse 'HEAD\^\{tree\}'/);
    assert.match(job, /test "\$source_sha" = "\$EXPECTED_MAIN3_HEAD"/);
    assert.ok(job.indexOf('source.json') < job.indexOf('test "$source_sha"'), 'retain the receipt even for a head mismatch');
  }
});

test('database gate replays the complete disposable database suite with pinned CLI', () => {
  const job = jobs('database');
  assert.match(job, /uses: supabase\/setup-cli@v3\n\s+with:\n\s+version: 2\.117\.0/);
  assert.match(job, /node \.github\/ci\/migration-lint\.mjs/);
  assert.match(job, /node \.github\/ci\/migration-contract-lint\.mjs/);
  assert.match(job, /set -euo pipefail\n\s+bash scripts\/public-db\.sh 2>&1 \| tee/);
  assert.match(job, /database\.log/);
});

test('append-only enforcement uses the immutable PR base and fails closed if unavailable', () => {
  const job = jobs('database');
  assert.match(job, /EXPECTED_MAIN3_BASE: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(job, /git fetch --no-tags --depth=1 origin "\$EXPECTED_MAIN3_BASE"/);
  assert.match(job, /git cat-file -e "\$EXPECTED_MAIN3_BASE\^\{commit\}"/);
  assert.match(job, /node \.github\/ci\/migration-lint\.mjs "\$EXPECTED_MAIN3_BASE"/);
  assert.ok(job.indexOf('git cat-file -e') < job.indexOf('node .github/ci/migration-lint.mjs'), 'base must exist before append-only validation');
});

test('browser gate uses existing pinned dependencies, installed Chrome and Korean fonts', () => {
  const job = jobs('chromium');
  assert.match(job, /MAIN3_BROWSER_CHANNEL: chrome/);
  assert.match(job, /working-directory: apps\/world\/tests\/browser\n\s+run: npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(job, /fonts-noto-cjk/);
  assert.match(job, /google-chrome --version/);
  assert.match(job, /node --test \.github\/ci\/main3-workflow-contract\.test\.mjs/);
  for (const script of ['main3-guide-null-smoke.mjs', 'main3-shop-visit-smoke.mjs', 'main3-campus-smoke.mjs']) assert.ok(job.includes(script), script);
  assert.match(job, /MAIN3_HOSTED_QA: '1'/);
  assert.match(job, /MAIN3_EXPECTED_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(job, /MAIN3_CAMPUS_OUTPUT_DIR: test-results\/main3-shop-visit\/campus/);
  assert.doesNotMatch(job, /playwright install|npm install/);
});

test('both jobs always upload evidence including source and failure logs', () => {
  for (const name of ['database', 'chromium']) {
    const job = jobs(name);
    assert.match(job, /if: always\(\)\n\s+uses: actions\/upload-artifact@v4/);
    assert.match(job, new RegExp(`name: main3-shop-visit-${name}-evidence`));
    assert.match(job, /path: test-results\/main3-shop-visit\//);
    assert.match(job, /if-no-files-found: error/);
    assert.match(job, /retention-days: 7/);
    assert.match(job, /source-worktree\.txt/);
  }
});
