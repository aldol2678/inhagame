import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNextDiscovery, selectNextDiscovery, NEXT_DISCOVERY_ID } from '../src/next-discovery.js';
import { createMain2QuestClient } from '../npc-factory/main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from '../npc-factory/main2-quest-contract.mjs';

const quest = { enabled: true, signedIn: true, ready: true, stage: 5 };
const main2Quest = { enabled: true, signedIn: true, ready: true, available: true, stage: 0 };
const progress = { quest, main2Quest };
function ui(onPrimary = () => true) {
  let click;
  const root = { hidden: false };
  const primaryButton = { addEventListener: (_type, fn) => { click = fn; }, setAttribute() {} };
  const controller = createNextDiscovery({ root, primaryButton, onPrimary });
  return { root, primaryButton, controller, click: () => click() };
}

test('both authoritative status reads are required; no reward callback is needed', () => {
  assert.equal(selectNextDiscovery(progress).id, NEXT_DISCOVERY_ID);
  assert.equal(selectNextDiscovery(), null);
  for (const field of ['enabled', 'signedIn', 'ready']) {
    assert.equal(selectNextDiscovery({ ...progress, quest: { ...quest, [field]: false } }), null);
    assert.equal(selectNextDiscovery({ ...progress, main2Quest: { ...main2Quest, [field]: false } }), null);
  }
  assert.equal(selectNextDiscovery({ ...progress, main2Quest: { ...main2Quest, available: false } }), null);
  assert.equal(selectNextDiscovery({ ...progress, quest: { ...quest, stage: 4 } }), null);
  assert.equal(selectNextDiscovery({ ...progress, main2Quest: { ...main2Quest, stage: 1 } }), null);
  assert.equal(selectNextDiscovery({ ...progress, main2Quest: { ...main2Quest, stage: 9 } }), null);
});

test('reconnecting restores the same next action without replaying a reward', () => {
  const first = ui();
  first.controller.syncProgress(progress);
  assert.equal(first.root.hidden, false);
  first.controller.syncProgress(null);
  assert.equal(first.root.hidden, true);
  const reconnected = ui();
  reconnected.controller.syncProgress(progress);
  assert.equal(reconnected.root.hidden, false);
  assert.equal(reconnected.primaryButton.textContent, '길 안내');
});

test('accepted, refused and throwing navigation remain retryable; no stage mutation', () => {
  for (const result of [true, false, 'throw']) {
    let calls = 0;
    const nodes = ui(item => {
      assert.equal(item.id, NEXT_DISCOVERY_ID);
      calls++;
      if (result === 'throw') throw Error('route unavailable');
      return result;
    });
    nodes.controller.syncProgress(progress);
    nodes.click(); nodes.click();
    assert.equal(calls, 2);
    assert.equal(nodes.root.hidden, false);
    assert.equal(main2Quest.stage, 0);
  }
});

test('starting Main 2 or signing out removes the action and blocks stale clicks', () => {
  let calls = 0;
  const nodes = ui(() => calls++);
  nodes.controller.syncProgress(progress);
  nodes.controller.syncProgress({ ...progress, main2Quest: { ...main2Quest, stage: 1 } });
  nodes.click();
  assert.equal(nodes.root.hidden, true);
  nodes.controller.syncProgress(progress);
  nodes.controller.syncProgress(null);
  nodes.click();
  assert.equal(nodes.primaryButton.disabled, true);
  assert.equal(calls, 0);
});

function clientHarness() {
  const requests = [];
  const client = createMain2QuestClient({ enabled: true, endpoint: '/quest', getSession: async () => 'token',
    fetcher: (_url, options) => new Promise(resolve => requests.push({ body: JSON.parse(options.body), resolve })) });
  const nodes = ui();
  client.onChange(state => nodes.controller.syncProgress({ quest, main2Quest: state }));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const reply = (index, available, stage = 0) => requests[index].resolve({ ok: true,
    json: async () => ({ quest_id: MAIN2_QUEST_ID, available, stage }) });
  return { client, nodes, requests, flush, reply };
}

test('real quest client restores from status; account switch rejects a late previous response', async () => {
  const h = clientHarness();
  const a = h.client.setSignedIn(true);
  await h.flush();
  assert.equal(h.client.status().ready, false);
  assert.equal(h.nodes.root.hidden, true);
  const b = h.client.setSignedIn(true);
  await h.flush();
  h.reply(0, true); await a;
  assert.equal(h.nodes.root.hidden, true, 'account A cannot offer a target to account B');
  h.reply(1, false); await b;
  assert.equal(h.nodes.root.hidden, true);
  const resumed = h.client.setSignedIn(true);
  await h.flush(); h.reply(2, true); await resumed;
  assert.equal(h.nodes.root.hidden, false, 'fresh page/session status restores the CTA');
});

test('Main 1 completion refresh queued during Main 2 status eventually restores the CTA', async () => {
  const h = clientHarness();
  const pending = h.client.setSignedIn(true);
  await h.flush();
  await h.client.refresh();
  h.reply(0, false); await pending; await h.flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.event, 'status');
  h.reply(1, true); await h.flush();
  assert.equal(h.nodes.root.hidden, false);
});

test('failed initial read never invents an available quest', async () => {
  const h = clientHarness();
  const pending = h.client.setSignedIn(true);
  await h.flush();
  h.requests[0].resolve({ ok: false });
  await pending;
  assert.equal(h.client.status().ready, false);
  assert.equal(h.nodes.root.hidden, true);
});

test('runtime publishes both progress states and the action has one inline HUD location', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');
  assert.match(runtime, /onQuestStateChange\(\{ quest: quest.status\(\), main2Quest: main2Quest.status\(\) \}\)/);
  assert.match(main, /onQuestStateChange: progress => nextDiscovery\?\.syncProgress\(progress\)/);
  assert.doesNotMatch(main, /offerFirstCampusReward|nextDiscovery\?\.dismiss/);
  const hud = html.match(/<section[^>]*id="quest-hud"[\s\S]*?<\/section>/)[0];
  assert.ok(hud.includes('id="next-discovery-primary"'));
  assert.equal((html.match(/id="next-discovery-primary"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="npc-quest"|id="main2-quest"|<aside[^>]*id="next-discovery"/);
});
