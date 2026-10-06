import test from 'node:test';
import assert from 'node:assert/strict';
import { createMain2QuestClient } from '../npc-factory/main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';
import { createNextDiscovery } from '../src/next-discovery.js';
import { createQuestRuntime } from '../src/quest/quest-runtime.js';
import { createTrackedQuestHud } from '../src/quest/quest-hud.js';
import { createFakeDocument } from './support/fake-dom.mjs';

function harness({ delays = [1000, 3000, 8000] } = {}) {
  const document = createFakeDocument();
  const node = tag => document.createElement(tag);
  const hudRoot = node('section'), openButton = node('button'), heading = node('span');
  const objective = node('span'), bearing = node('span'), actionRoot = node('div'), primaryButton = node('button');
  hudRoot.append(openButton, heading, objective, bearing, actionRoot);
  actionRoot.append(primaryButton);
  const runtime = createQuestRuntime();
  const opened = [], navigated = [], published = [], requests = [], timers = new Map();
  let sequence = 0;
  const client = createMain2QuestClient({
    enabled: true, endpoint: '/fixture/quest', getSession: async () => 'synthetic-session',
    statusRetryDelays: delays,
    setTimer: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id),
    fetcher: (_url, init) => new Promise(resolve => requests.push({ event: JSON.parse(init.body).event, resolve }))
  });
  const hud = createTrackedQuestHud({ root: hudRoot, openButton, headingElement: heading,
    objectiveElement: objective, bearingElement: bearing, runtime,
    onOpenJournal: quest => opened.push(quest.questId) });
  const discovery = createNextDiscovery({ root: actionRoot, primaryButton,
    onPrimary: item => navigated.push(item.id), onRetry: () => client.refresh(),
    onProgress: progress => runtime.update(progress) });
  client.onChange(main2Quest => {
    published.push(main2Quest);
    discovery.syncProgress({ quest: { enabled: true, signedIn: true, ready: true, stage: 5, complete: true }, main2Quest });
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const reply = (index, available = true, stage = 0) => requests[index].resolve({ ok: true,
    json: async () => ({ quest_id: MAIN2_QUEST_ID, available, stage }) });
  const fail = index => requests[index].resolve({ ok: false });
  async function startFailure() {
    const pending = client.setSignedIn(true); await flush(); fail(requests.length - 1); await pending;
  }
  async function failNextRetry(delay) {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.ms, delay);
    timers.delete(id); timer.fn(); await flush(); fail(requests.length - 1); await flush();
  }
  async function exhaust() { await startFailure(); for (const delay of delays) await failNextRetry(delay); }
  return { client, runtime, hud, discovery, hudRoot, openButton, heading, objective, bearing, actionRoot,
    primaryButton, opened, navigated, published, requests, timers, flush, reply, fail, startFailure, failNextRetry, exhaust };
}

test('Main 2 publishes UNAVAILABLE after exactly four failed reads and offers a visible retry', async () => {
  const h = harness(); await h.exhaust();
  assert.equal(h.requests.length, 4);
  assert.deepEqual(h.requests.map(request => request.event), ['status', 'status', 'status', 'status']);
  assert.equal(h.timers.size, 0);
  assert.equal(h.client.status().statusState, 'UNAVAILABLE');
  assert.equal(h.published.at(-1).statusState, 'UNAVAILABLE', 'exhaustion must reach the subscribed UI');
  assert.equal(h.client.status().ready, false);
  assert.equal(h.client.status().available, false);
  assert.equal(h.client.mapTarget(), null);
  assert.equal(h.runtime.tracked(), null, 'recovery never invents quest progress');
  assert.equal(h.hudRoot.hidden, false, 'retry must not be inside a hidden tracked HUD');
  assert.equal(h.actionRoot.hidden, false);
  assert.equal(h.primaryButton.textContent, '다시 시도');
  assert.match(h.objective.textContent, /불러오지 못/);
  assert.equal(h.bearing.hidden, true);
  h.openButton.click(); assert.deepEqual(h.opened, []);
});

test('explicit retry resets the budget, prevents duplicate clicks and restores the existing guide CTA', async () => {
  const h = harness(); await h.exhaust();
  h.primaryButton.click(); h.primaryButton.click(); await h.flush();
  assert.equal(h.requests.length, 5, 'repeated clicks do not queue extra status reads');
  assert.equal(h.client.status().statusState, 'LOADING');
  assert.equal(h.client.status().retryAttempt, 0);
  assert.equal(h.actionRoot.hidden, true);
  assert.equal(h.primaryButton.disabled, true);
  assert.equal(h.hudRoot.hidden, false);
  h.fail(4); await h.flush();
  assert.equal(h.client.status().statusState, 'RETRY');
  await h.failNextRetry(1000); await h.failNextRetry(3000); await h.failNextRetry(8000);
  assert.equal(h.client.status().statusState, 'UNAVAILABLE');
  h.primaryButton.click(); await h.flush(); h.reply(8); await h.flush();
  assert.equal(h.client.status().statusState, 'READY');
  assert.equal(h.client.status().retryAttempt, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.hudRoot.hidden, false);
  assert.match(h.objective.textContent, /후문 안내 학생/);
  assert.equal(h.primaryButton.textContent, '길 안내');
  h.primaryButton.click(); assert.deepEqual(h.navigated, ['main2_back_gate_guide']);
});

test('manual retry respects an authoritative unavailable quest after Main 1 completion', async () => {
  const h = harness({ delays: [] }); await h.exhaust();
  h.primaryButton.click(); await h.flush(); h.reply(1, false); await h.flush();
  assert.equal(h.client.status().statusState, 'READY');
  assert.equal(h.client.status().available, false);
  assert.equal(h.client.mapTarget(), null);
  assert.equal(h.runtime.tracked(), null, 'Main 1 completion cannot override Main 2 availability');
  assert.equal(h.runtime.snapshot.quests.find(quest => quest.sequence === 2).state, 'LOCKED');
  assert.equal(h.hudRoot.hidden, true);
  assert.equal(h.actionRoot.hidden, true);
  assert.equal(h.openButton.disabled, true);
});

for (const lateResult of ['success', 'failure']) {
  test(`account switch ignores ${lateResult} from a manual retry and keeps the new account authoritative`, async () => {
    const h = harness({ delays: [] }); await h.exhaust();
    h.primaryButton.click(); await h.flush();
    assert.equal(h.requests.length, 2, 'manual retry starts an account-scoped request');
    const switched = h.client.setSignedIn(true); await h.flush();
    h.reply(2, false); await switched;
    if (lateResult === 'success') h.reply(1, true); else h.fail(1);
    await h.flush();
    assert.equal(h.client.status().statusState, 'READY');
    assert.equal(h.client.status().available, false);
    assert.equal(h.runtime.tracked(), null);
    assert.equal(h.hudRoot.hidden, true);
    assert.equal(h.discovery.status(), null);
    assert.equal(h.actionRoot.hidden, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.requests.length, 3);
  });
}

test('sign-out and disabling cancel retry timers and hide stale recovery controls', async () => {
  for (const action of ['sign-out', 'disable']) {
    const h = harness(); await h.startFailure();
    const staleTimer = h.timers.values().next().value.fn;
    if (action === 'sign-out') await h.client.setSignedIn(false); else await h.client.setEnabled(false);
    staleTimer(); await h.flush();
    assert.equal(h.timers.size, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.actionRoot.hidden, true);
    assert.equal(h.hudRoot.hidden, true);
    assert.equal(h.client.status().statusState, action === 'sign-out' ? 'SIGNED_OUT' : 'DISABLED');
  }
});

test('refresh during a scheduled retry replaces its timer with a fresh bounded read', async () => {
  const h = harness(); await h.startFailure();
  const refreshed = h.client.refresh(); await h.flush();
  assert.equal(h.timers.size, 0);
  assert.equal(h.client.status().statusState, 'LOADING');
  h.reply(1); await refreshed;
  assert.equal(h.requests.length, 2);
  assert.equal(h.client.status().statusState, 'READY');
  assert.equal(h.primaryButton.textContent, '길 안내');
});

test('unavailable Main 2 does not replace the active Main 1 task with a recovery action', () => {
  const h = harness();
  h.discovery.syncProgress({ quest: { enabled: true, signedIn: true, ready: true, stage: 2 },
    main2Quest: { enabled: true, signedIn: true, ready: false, statusState: 'UNAVAILABLE' } });
  assert.match(h.heading.textContent, /MAIN 01/);
  assert.equal(h.actionRoot.hidden, true);
});

test('refresh queued behind a failing status read resets its retry budget and cancels the old timer', async () => {
  const h = harness(); await h.startFailure();
  const [id, timer] = h.timers.entries().next().value;
  h.timers.delete(id); timer.fn(); await h.flush();
  await h.client.refresh(); await h.client.refresh();
  h.fail(1); await h.flush();
  assert.equal(h.requests.length, 3, 'coalesced refresh starts just one replacement read');
  assert.equal(h.timers.size, 0, 'the replaced retry chain cannot issue an extra read');
  assert.equal(h.client.status().retryAttempt, 0);
  assert.equal(h.client.status().statusState, 'LOADING');
  h.fail(2); await h.flush();
  assert.equal(h.timers.values().next().value.ms, 1000, 'replacement gets a fresh bounded budget');
  await h.failNextRetry(1000); await h.failNextRetry(3000); await h.failNextRetry(8000);
  assert.equal(h.client.status().statusState, 'UNAVAILABLE');
  assert.equal(h.timers.size, 0);
});
