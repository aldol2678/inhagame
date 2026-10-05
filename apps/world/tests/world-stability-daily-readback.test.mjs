import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createFakeDocument } from './support/fake-dom.mjs';

const helperUrl = new URL('./browser/world-stability-daily-reward-fixture.mjs', import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('../src/main.js');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];

async function setup(kind, scenario) {
  assert.ok(existsSync(helperUrl), 'daily browser fixture must exist');
  const { createDailyRewardFixture, extractDailyComposition } = await import(helperUrl);
  const doc = createFakeDocument(), root = doc.createElement('section'), timers = new Map();
  let timerId = 0;
  const fixture = createDailyRewardFixture({ root, doc, kind, scenario,
    mainComposition: extractDailyComposition(main),
    timerOptions: { setTimer: fn => { timers.set(++timerId, fn); return timerId; }, clearTimer: id => timers.delete(id), rewardRetryDelays: [10, 20, 30] } });
  await fixture.bind('fixture-A');
  fixture.open(); await flush();
  const click = text => {
    const button = walk(root).find(node => node.tagName === 'BUTTON' && node.textContent === text);
    assert.ok(button, `real panel must offer ${text}`); button.click();
  };
  return { fixture, timers, click, mutate: () => click(kind === 'attendance' ? '오늘 출석하기' : '정답 선택') };
}

for (const kind of ['attendance', 'quiz']) {
  for (const scenario of ['lost-response', 'malformed-response', 'read-failure-retry']) {
    test(`daily browser fixture: ${kind} real panel ${scenario} silently repairs actual main read-models`, async () => {
      const h = await setup(kind, scenario);
      assert.equal(h.fixture.snapshot().writes, 0, 'opening must never mutate');
      h.mutate(); await flush();
      if (scenario === 'read-failure-retry') {
        const failed = h.fixture.snapshot();
        assert.equal(failed.state, 'UNAVAILABLE'); assert.equal(failed.wallet, null);
        assert.equal(h.timers.size, kind === 'quiz' ? 2 : 1);
        h.click('다시 시도'); await flush();
        for (const [id, fn] of [...h.timers]) { h.timers.delete(id); fn(); }
        await flush();
      }
      const r = h.fixture.snapshot();
      assert.equal(r.state, 'READY'); assert.equal(r.completed, kind === 'attendance' ? true : 'PASSED');
      assert.equal(r.wallet, 110); assert.equal(r.exp, kind === 'quiz' ? 120 : 90);
      assert.match(r.walletText, /110/); assert.match(r.hudText, kind === 'quiz' ? /Lv\.2 120 \/ 300 EXP/ : /Lv\.1 90 \/ 100 EXP/);
      assert.equal(r.writes, 1); assert.equal(r.serverCommits, 1); assert.equal(r.rewardToasts, 0); assert.equal(r.levelToasts, 0);
      assert.equal(r.mutationOutcome, 'FAILED'); assert.equal(r.mutationClicks, 1);
      assert.equal(r.trustedMutationClicks, 0, 'Node fake DOM must never claim native browser evidence');
      h.fixture.dispose(); assert.equal(h.timers.size, 0);
    });
  }
  for (const scenario of ['late-write', 'late-readback']) {
    for (const accounts of [['fixture-B'], ['fixture-B', 'fixture-A'], [null]]) {
      test(`daily browser fixture: ${kind} ${scenario} respects generation ${JSON.stringify(accounts)}`, async () => {
        const h = await setup(kind, scenario);
        h.mutate(); await flush();
        assert.equal(h.fixture.snapshot().heldResponses, scenario === 'late-write' ? 1 : kind === 'quiz' ? 3 : 2);
        for (const account of accounts) await h.fixture.bind(account);
        const before = h.fixture.snapshot();
        await h.fixture.releaseHeld(); await flush();
        const after = h.fixture.snapshot();
        assert.equal(after.calls.length, before.calls.length, 'late old work cannot issue another RPC');
        assert.equal(after.changes.length, before.changes.length, 'old reads cannot publish into a newer generation');
        assert.equal(after.wallet, before.wallet); assert.equal(after.exp, before.exp);
        assert.equal(after.writes, 1); assert.equal(after.serverCommits, 1);
        assert.equal(after.rewardToasts, 0); assert.equal(after.levelToasts, 0);
        if (scenario === 'late-write') assert.equal(after.mutationOutcome, 'STALE');
        h.fixture.dispose();
      });
    }
  }
}

test('daily composition extraction rejects missing or duplicate production boundaries', async () => {
  assert.ok(existsSync(helperUrl), 'daily browser fixture must exist');
  const { extractDailyComposition } = await import(helperUrl);
  assert.match(extractDailyComposition(main), /onRecoveryReadback/);
  assert.throws(() => extractDailyComposition(''), /composition/);
  assert.throws(() => extractDailyComposition(main + main), /composition/);
});

test('hosted daily readback is wired into the pinned existing stability browser job', () => {
  const smoke = read('./browser/world-stability-smoke.mjs');
  assert.match(smoke, /runDailyRewardAcceptance/);
  assert.match(smoke, /sourceHashes/);
  assert.match(smoke, /networkIsolation/);
  assert.match(smoke, /assert.equal\(isClientBlockedError\(blockedProbes\[0\].error\),true/);
  assert.match(read('./browser/harness.mjs'), /route.abort\("blockedbyclient"\)/);
  const fixture = read('./browser/world-stability-fixture.mjs');
  assert.match(fixture, /createDailyRewardFixture/);
  const flow = read('../../../.github/workflows/world-stability-browser.yml');
  for (const path of ['apps/world/src/wallet/**', 'apps/world/src/progression/**', 'apps/world/src/main.js', 'apps/world/tests/daily-reward-readback.test.mjs', 'apps/world/tests/world-stability-daily-readback.test.mjs']) assert.ok(flow.includes(path), `workflow must cover ${path}`);
  assert.doesNotMatch(flow, /pull_request_target|secrets\.|contents: write/);
  assert.match(read('./browser/world-stability-harness.html'), /daily-reward-surface/);
});

test('existing browser fixture mounts and disposes the daily surface through its public test API', async t => {
  const previous = Object.fromEntries(['window', 'document', 'HTMLElement'].map(key => [key, globalThis[key]]));
  t.after(() => Object.assign(globalThis, previous));
  const doc = createFakeDocument(); doc.body = doc.createElement('body');
  const elements = Object.fromEntries(['shop-panel', 'daily-reward-surface', 'joystick', 'joystick-knob', 'jump', 'run', 'descend', 'receipt'].map(id => [id, doc.createElement('div')]));
  for (const el of Object.values(elements)) { el.style = {}; el.clientWidth = 120; el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120 }); el.hasPointerCapture = () => false; }
  elements['joystick-knob'].clientWidth = 40; doc.getElementById = id => elements[id] ?? null;
  globalThis.document = doc; globalThis.window = { addEventListener() {}, dispatchEvent() {} }; globalThis.HTMLElement = class {};
  await import('./browser/world-stability-fixture.mjs');
  const f = window.__WORLD_STABILITY__, { extractDailyComposition } = await import(helperUrl);
  const options = { mainComposition: extractDailyComposition(main), kind: 'quiz', scenario: 'lost-response' };
  await f.prepareDailyReward(options);
  walk(elements['daily-reward-surface']).find(node => node.tagName === 'BUTTON' && node.textContent === '정답 선택').click();
  await flush(); assert.equal(f.dailyReward.snapshot().wallet, 110); assert.equal(f.dailyReward.snapshot().exp, 120);
  await f.prepareShop(); assert.equal(f.dailyReward, null); assert.equal(elements['daily-reward-surface'].hidden, true);
});

// Both spellings were observed from Chromium's explicit route.abort("blockedbyclient").
// A rejected fetch alone is insufficient: DNS and unrelated request failures must fail QA.
test('blocked-request proof accepts only exact Chromium client-block errors', async () => {
  const { isClientBlockedError } = await import(helperUrl);
  assert.equal(typeof isClientBlockedError, 'function', 'browser evidence needs a strict client-block classifier');
  for (const error of ['net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_CLIENT.Inspector']) {
    assert.equal(isClientBlockedError(error), true, error);
  }
  for (const error of [
    undefined, null, '', 0, false, {}, new String('net::ERR_BLOCKED_BY_CLIENT'),
    'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_FAILED', 'net::ERR_ABORTED',
    'ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_CLIENT.', 'net::ERR_BLOCKED_BY_CLIENT.InspectorExtra',
    'net::ERR_BLOCKED_BY_CLIENT.inspector', 'net::ERR_BLOCKED_BY_CLIENT.Other',
    'prefix-net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_CLIENT trailing',
    ' net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_CLIENT\n', 'net::ERR_BLOCKED_BY_CLIENT.Inspector\n'
  ]) assert.equal(isClientBlockedError(error), false, `must reject ${String(error)}`);
});
