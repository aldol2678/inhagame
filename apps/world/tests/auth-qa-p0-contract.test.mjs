// AUTH-QA-P0 contract-only checks: no browser, network, Auth provider or database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const smoke = readFileSync(new URL('./browser/auth-qa-p0-smoke.mjs', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../../../.github/workflows/auth-qa-p0-browser.yml', import.meta.url), 'utf8');

test('all eight exact scenario IDs have bounded browser implementations', () => {
  for (let i = 1; i <= 8; i++) {
    const id = `AUTH-${String(i).padStart(2, '0')}`;
    assert.match(smoke, new RegExp(`scenario\\('${id}'`), `${id} is absent`);
  }
  assert.match(smoke, /report\.cases\.length !== 8/);
  assert.match(smoke, /report\.cases\.some\(c => c\.status === 'FAIL'\)/);
  assert.match(smoke, /report\.cases\.some\(c => c\.status === 'HOLD'\)/);
});

test('exact-head gate and local-only Auth/DB enforce safe execution', () => {
  assert.match(smoke, /assert\.equal\(head, AUTH_QA_P0_HEAD/);
  assert.match(smoke, /loopback\(API_URL\)/);
  assert.match(smoke, /loopback\(DB_URL\)/);
  assert.match(smoke, /url\.origin === localAuth/);
  assert.match(smoke, /return route\.abort\('blockedbyclient'\)/);
  assert.doesNotMatch(smoke, /inhagame\.app|supabase\.co/);
});

test('real browser, actual Auth and Chromium BFCache evidence are required', () => {
  assert.match(smoke, /from 'playwright'/);
  assert.match(smoke, /\/auth\/v1\/admin\/users/);
  assert.match(smoke, /auth\.signInWithPassword/);
  assert.match(smoke, /Page\.navigateToHistoryEntry/);
  assert.match(smoke, /restores\.includes\(true\)/);
  assert.match(smoke, /BFCache was not restored/);
  assert.match(smoke, /refresh_token/);
});

test('no raw secrets are placed in the evidence report', () => {
  assert.match(smoke, /cases: \[\]/);
  assert.match(smoke, /sdkSha256/);
  assert.match(smoke, /report\.status/);
  assert.doesNotMatch(smoke, /report\.(?:access_token|refresh_token|password|serviceRoleKey)\s*=/);
  assert.match(smoke, /\[REDACTED\]/);
});

test('dedicated CI remains read-only to GitHub and scoped to auth changes', () => {
  assert.match(flow, /^name: AUTH-QA-P0 browser$/m);
  assert.match(flow, /^  pull_request:$/m);
  assert.match(flow, /apps\/world\/hub-account\.js/);
  assert.match(flow, /apps\/world\/tests\/browser\/auth-qa-p0-smoke\.mjs/);
  assert.match(flow, /apps\/world\/tests\/auth-qa-p0-contract\.test\.mjs/);
  assert.match(flow, /permissions:\n  contents: read/);
  assert.match(flow, /persist-credentials: false/);
  assert.match(flow, /AUTH_QA_P0_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(flow, /supabase stop --no-backup/);
  assert.doesNotMatch(flow, /workflow_dispatch|pull_request_target|contents: write|git push|deploy|supabase db push/);
});
