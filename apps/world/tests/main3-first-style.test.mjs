import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createQuestRuntime } from '../src/quest/quest-runtime.js';
import { getQuestDefinitionByLegacyId } from '../src/quest/quest-registry.js';
import { createShopWorldInteraction, STUDENT_CENTER_SHOP_ENTRY as entry } from '../src/shop/shop-world-interaction.js';

const module = await import('../npc-factory/main3-quest-client.mjs').catch(() => ({}));
const ID = 'campus_first_style_v1';
const response = (stage, available = true) => ({ ok: true, json: async () => ({ quest_id: ID, stage, available }) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(fetcher) {
  assert.equal(typeof module.createMain3QuestClient, 'function', 'Main3 client is implemented');
  return module.createMain3QuestClient({ enabled: true, endpoint: '/quest', getSession: async () => 'fixture', fetcher, statusRetryDelays: [] });
}

test('Main3 client uses only validated server stages and single-flight start/visit', async () => {
  const calls = []; const started = deferred(); let visited;
  const client = harness(async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (body.event === 'start') return started.promise;
    if (body.event === 'visit_student_center') { visited = deferred(); return visited.promise; }
    return response(0);
  });
  await client.setSignedIn(true);
  const start = client.startFromGuide(); await tick();
  const duplicate = client.startFromGuide();
  assert.equal(client.stage, 0, 'CTA is not progress authority');
  started.resolve(response(1)); await Promise.all([start, duplicate]);
  assert.equal(client.stage, 1);
  const visit = client.visitStudentCenter(); await tick();
  const duplicateVisit = client.visitStudentCenter();
  assert.equal(client.stage, 1, 'entry open alone cannot mark visited');
  visited.resolve(response(2)); await Promise.all([visit, duplicateVisit]);
  assert.equal(client.stage, 2);
  assert.deepEqual(calls.map(c => c.event), ['status', 'start', 'visit_student_center']);
  assert.ok(calls.every(c => c.quest_id === ID && Object.keys(c).length === 2));
  assert.equal(client.status().complete, false);
});

test('Main3 locked, guest and disabled clients cannot send mutations', async () => {
  const calls = []; const client = harness(async (_u, o) => { calls.push(JSON.parse(o.body).event); return response(0, false); });
  await client.startFromGuide(); await client.visitStudentCenter();
  assert.deepEqual(calls, []);
  await client.setSignedIn(true);
  await client.startFromGuide(); await client.visitStudentCenter();
  assert.deepEqual(calls, ['status']);
  assert.equal(client.mapTarget(), null);
  await client.setEnabled(false); await client.visitStudentCenter();
  assert.deepEqual(calls, ['status']);
});

test('Main3 lost visit response recovers by server status without inferred completion', async () => {
  let savedStage = 1; let fail = true;
  const client = harness(async (_u, o) => {
    if (JSON.parse(o.body).event === 'visit_student_center') { savedStage = 2; if (fail) { fail = false; throw Error('network'); } }
    return response(savedStage);
  });
  await client.setSignedIn(true);
  await assert.rejects(client.visitStudentCenter(), /network/);
  assert.equal(client.stage, 1);
  await client.refresh();
  assert.equal(client.stage, 2);
  assert.equal(await client.visitStudentCenter(), null, 'already visited never repeats the visit');
});

test('Main3 account switch discards an older response and clears guidance immediately', async () => {
  const old = deferred(); let calls = 0;
  const client = harness(async () => ++calls === 1 ? old.promise : response(0, false));
  const pending = client.setSignedIn(true); await tick();
  await client.setSignedIn(true);
  old.resolve(response(2)); await pending;
  assert.equal(client.stage, 0); assert.equal(client.status().available, false);
  assert.equal(client.mapTarget(), null);
  await client.setSignedIn(false); assert.equal(client.status().ready, false);
});

test('Main3 rejected result cannot expose an invented stage or reward', async () => {
  for (const payload of [{ quest_id: 'wrong', stage: 2, available: true }, { quest_id: ID, stage: 2.1, available: true },
    { quest_id: ID, stage: 2, available: true, reward: { exp: 100 } }]) {
    const client = harness(async () => ({ ok: true, json: async () => payload }));
    await client.setSignedIn(true);
    assert.equal(client.status().ready, false); assert.equal(client.stage, 0);
  }
});

test('Main3 entry while status is loading is retained for the same account', async () => {
  const status = deferred(); const calls = [];
  const client = harness(async (_u, o) => { const event = JSON.parse(o.body).event; calls.push(event); return event === 'status' ? status.promise : response(2); });
  const read = client.setSignedIn(true); await tick();
  const visit = client.visitStudentCenter(); status.resolve(response(1));
  await Promise.all([read, visit]);
  assert.deepEqual(calls, ['status', 'visit_student_center']); assert.equal(client.stage, 2);
});

test('Main3 reuses canonical guide and student-center targets', async () => {
  let stage = 0; const client = harness(async () => response(stage));
  await client.setSignedIn(true); assert.equal(client.mapTarget().kind, 'quest-npc');
  stage = 1; await client.refresh();
  assert.equal(client.mapTarget().x, entry.x); assert.equal(client.mapTarget().z, entry.z);
});

test('Main3 registry uses server availability, four objectives and no speculative reward', () => {
  const def = getQuestDefinitionByLegacyId(ID);
  assert.ok(def, 'Main3 is registered'); assert.equal(def.sequence, 3);
  assert.deepEqual(def.rewardRefs, []); assert.equal(def.objectives.length, 4);
  assert.equal(def.objectives[1].navigationTarget, 'poi.student-center');
  const runtime = createQuestRuntime();
  const state = { quest: { signedIn: true, ready: true, stage: 5, complete: true }, main2Quest: { signedIn: true, ready: true, stage: 9, complete: true } };
  runtime.update({ ...state, main3Quest: { signedIn: true, ready: true, stage: 0, available: false } });
  assert.equal(runtime.tracked(), null, 'Main2 completion alone does not invent Main3 availability');
  runtime.update({ ...state, main3Quest: { signedIn: true, ready: true, stage: 1, available: true } });
  assert.equal(runtime.tracked().legacyProgressId, ID);
  assert.equal(runtime.tracked().currentObjective.text, '학생회관 굿즈샵으로 가 보자');
  runtime.update({ ...state, main3Quest: { signedIn: true, ready: true, stage: 2, available: true } });
  assert.equal(runtime.tracked().state, 'ACTIVE');
  assert.equal(runtime.tracked().currentObjective.text, '굿즈샵에서 마음에 드는 물건을 하나 골라 보자');
  runtime.update(null); assert.equal(runtime.tracked(), null);
});

test('only successful canonical world entry invokes visit observation; failures never block shop', () => {
  let visited = 0; let opens = 0;
  const world = createShopWorldInteraction({ getAvailable: () => true, openPanel: () => { opens++; return true; }, onEnter: () => { visited++; throw Error('quest offline'); } });
  assert.equal(world.open(), false);
  world.observe(entry, { placeZoneId: entry.placeZoneId });
  assert.equal(visited, 0, 'proximity alone is not entry');
  assert.equal(world.open(), true); assert.equal(visited, 1); assert.equal(opens, 1);
  const declined = createShopWorldInteraction({ getAvailable: () => true, openPanel: () => false, onEnter: () => visited++ });
  declined.observe(entry, { placeZoneId: entry.placeZoneId });
  assert.equal(declined.open(), false); assert.equal(visited, 1);
});

test('runtime wires Main3 account lifecycle, guide, world entry and existing tracked HUD', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const contract of ['createMain3QuestClient', 'main3Quest.setSignedIn', 'main3Quest.setEnabled', 'main3Quest.mapTarget', 'main3Quest: main3Quest.status()', 'firstStyleQuest: main3Quest']) assert.ok(runtime.includes(contract), contract);
  assert.match(main, /onEnter:.*visitStudentCenterShop/s);
  assert.match(main, /main3Quest: initialQuestStatus.main3Quest/);
});

test('Main2 completion refresh rechecks after an older in-flight unavailable status', async () => {
  const stale = deferred(); let reads = 0;
  const client = harness(async () => ++reads === 1 ? stale.promise : response(0, true));
  const initial = client.setSignedIn(true); await tick();
  const completionRefresh = client.refresh();
  stale.resolve(response(0, false));
  await Promise.all([initial, completionRefresh]);
  assert.equal(reads, 2, 'completion evidence requires a newer read than an already-running request');
  assert.equal(client.status().available, true);
});

test('Main3 HUD cannot advertise active progress when server availability is false', () => {
  const runtime = createQuestRuntime();
  for (const stage of [1, 2, 3]) {
    runtime.update({ main3Quest: { signedIn: true, ready: true, stage, available: false } });
    assert.equal(runtime.tracked(), null);
    assert.equal(runtime.snapshot.quests[0].state, 'LOCKED');
    assert.equal(runtime.snapshot.quests[0].currentObjective, null);
  }
});

test('guide start waits for background status instead of dropping the CTA', async () => {
  const updating = deferred(); let count = 0; const calls = [];
  const client = harness(async (_u,o) => { const event=JSON.parse(o.body).event; calls.push(event); if(event==='start') return response(1); return ++count===1 ? response(0) : updating.promise; });
  await client.setSignedIn(true); const refresh=client.refresh(); await tick();
  const start=client.startFromGuide(); updating.resolve(response(0));
  await Promise.all([refresh,start]); assert.equal(client.stage,1); assert.deepEqual(calls,['status','status','start']);
});

test('world entry drains a queued completion refresh before submitting the visit', async () => {
  const first=deferred(), second=deferred(); let reads=0; const calls=[];
  const client=harness(async (_u,o) => { const event=JSON.parse(o.body).event; calls.push(event); return event==='visit_student_center' ? response(2) : ++reads===1 ? first.promise : second.promise; });
  const initial=client.setSignedIn(true); await tick(); const refresh=client.refresh(); const visit=client.visitStudentCenter();
  first.resolve(response(1)); await tick(); second.resolve(response(1));
  await Promise.all([initial,refresh,visit]); assert.equal(client.stage,2); assert.deepEqual(calls,['status','status','visit_student_center']);
});
