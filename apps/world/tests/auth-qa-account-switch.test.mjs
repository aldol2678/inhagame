import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Test the actual smoke helper under delayed Hub bootstrap. This is a synthetic
// harness regression, not evidence of real Supabase or Chromium authentication.
const source = readFileSync(new URL('./browser/auth-qa-p0-smoke.mjs', import.meta.url), 'utf8');
const helper = source.match(/  async function signOutCurrentAccount\(page\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(helper);

function fixture(initialId, { failLogout = false, readError = null } = {}) {
  let id = initialId, booted = false, clicks = 0;
  const visits = [];
  const window = { InhaHubAccountClient: { auth: { async getUser() {
    return { data: { user: id ? { id } : null }, error: readError };
  } } } };
  const page = {
    async goto(url) { visits.push(url); booted = false; },
    async waitForFunction() {},
    async evaluate(fn) { return vm.runInNewContext(`(${fn.toString()})()`, { window, Error }); },
    locator(selector) {
      return {
        async waitFor() { booted = true; },
        async click() {
          assert.equal(selector, '#hub-sign-out');
          assert.equal(booted, true, 'must wait for the sign-out UI to initialize');
          clicks++;
          if (!failLogout) id = null;
        }
      };
    }
  };
  const run = vm.runInNewContext(`${helper}\nsignOutCurrentAccount`, { origin: 'http://127.0.0.1:1', window, assert, Error });
  return { run: () => run(page), visits, get clicks() { return clicks; } };
}

test('each signed-in account waits for bootstrap, then signs out before switching', async () => {
  for (const account of ['A', 'B', 'A']) {
    const f = fixture(account);
    await f.run();
    assert.equal(f.clicks, 1);
    assert.deepEqual(f.visits, ['http://127.0.0.1:1/#account']);
  }
});

test('a missing session waits for the login UI without clicking hidden sign-out', async () => {
  const f = fixture(null);
  await f.run();
  assert.equal(f.clicks, 0);
});

test('logout that leaves a session fails instead of attempting the next login', async () => {
  await assert.rejects(fixture('A', { failLogout: true }).run(), /must complete logout/);
});

test('an auth read error cannot be treated as signed-out', async () => {
  const f = fixture(null, { readError: { name: 'AuthRetryableFetchError' } });
  await assert.rejects(f.run(), /Hub auth read failed/);
  assert.equal(f.clicks, 0);
});
