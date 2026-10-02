import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { QUEST_ID, QUEST_OBJECTIVES, nextQuestStage, questEventForNpc } from './quest-contract.mjs';
import { createLocalQuestStore, createSupabaseQuestStore } from './quest-store.mjs';
import { createQuestCloudHandler } from './quest-cloud-handler.mjs';
import { createQuestClient } from './quest-client.mjs';
import { MCM_2026_EVENT_ID } from './mcm-2026-event-contract.mjs';

const id = 'INKYUNG-NPC-001', guide = 'INKYUNG-NPC-002';
assert.equal(questEventForNpc(0, id), 'start');
assert.equal(questEventForNpc(3, guide), 'talk_002');
assert.equal(questEventForNpc(4, id), 'talk_001');
assert.equal(questEventForNpc(2, guide), null);
assert.equal(QUEST_OBJECTIVES[5], '첫 캠퍼스 탐방 완료');
const events = ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001'];
let stage = 0;
for (const [index, event] of events.entries()) {
  if (stage < 4) assert.equal(nextQuestStage(stage, events.at(-1)), stage, 'out-of-order event stays put');
  stage = nextQuestStage(stage, event);
  assert.equal(stage, index + 1);
  assert.equal(nextQuestStage(stage, event), stage, 'duplicate event is idempotent');
}
assert.equal(nextQuestStage(5, 'start'), 5);
assert.throws(() => nextQuestStage(0, 'grant_reward'), /INVALID_QUEST_EVENT/);

const store = createLocalQuestStore();
assert.deepEqual(await store('user-a', 'status'), { quest_id: QUEST_ID, stage: 0 });
assert.equal((await store('user-a', 'visit_main_hall')).stage, 0);
for (const [index, event] of events.entries()) assert.equal((await store('user-a', event)).stage, index + 1);
assert.equal((await store('user-b', 'status')).stage, 0);

const hudObjective = { textContent: '' };
const hud = { hidden: true, querySelector: () => hudObjective };
const tour = { hidden: false };
const browserStore = createLocalQuestStore();
const npcPositions = new Map([[id, { x: 1, z: -98 }], [guide, { x: 130, z: 22 }]]);
const client = createQuestClient({ enabled: true, endpoint: '/npc-quest', getSession: async () => 'token',
  getNpcPosition: npcId => npcPositions.get(npcId) ?? null,
  hud, tour, fetcher: async (_url, options) => ({ ok: true,
    json: async () => browserStore('user-browser', JSON.parse(options.body).event) }) });
await client.setSignedIn(true);
assert.equal(client.stage, 0);
assert.equal(hud.hidden, false, 'Main 1 HUD is visible before the quest starts');
assert.equal(tour.hidden, true, 'legacy tour yields to the authored Main quest');
assert.equal(hudObjective.textContent, '정문에서 나나율과 대화');
assert.deepEqual(client.mapTarget(), {
  x: 1, z: -98, kind: 'quest-npc', npcId: id, stage: 0, label: '정문에서 나나율과 대화'
});
assert.equal(client.eventForNpc(id), 'start');
assert.equal((await client.advanceNpc(id)).stage, 1);
assert.equal(client.mapTarget()?.kind, 'destination');
assert.equal(hud.hidden, false);
assert.equal(tour.hidden, true);
assert.equal(hudObjective.textContent, '본관 앞 방문');
client.observePlace('AREA_MAIN_HALL', { x: 0, z: 0 });
assert.equal(client.stage, 1);
client.observePlace('AREA_MAIN_HALL', { x: 49.48, z: -4.71 });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 2);
client.observePlace('AREA_INKYUNG_STUDENT_CENTER', { x: 119, z: 20 });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(client.stage, 3);
assert.deepEqual(client.mapTarget(), {
  x: 130, z: 22, kind: 'quest-npc', npcId: guide, stage: 3, label: '인경호에서 가유담과 대화'
});
assert.equal((await client.advanceNpc(guide)).stage, 4);
assert.deepEqual(client.mapTarget(), {
  x: 1, z: -98, kind: 'quest-npc', npcId: id, stage: 4, label: '정문으로 돌아가 나나율과 대화'
});
const finalMain1 = await client.advanceNpc(id);
assert.equal(finalMain1.stage, 5);
assert.match(finalMain1.line, /후문/, 'Main 1 closing line points to the Main 2 guide');
assert.equal(hud.hidden, true, 'completed Main 1 HUD is suppressed');
assert.equal(tour.hidden, true, 'legacy tour stays suppressed after authored Main 1 completion');
assert.equal(client.mapTarget(), null);
assert.equal(client.eventForNpc(id), null);
await client.setSignedIn(false);
assert.equal(hud.hidden, true);
assert.equal(tour.hidden, false);

const degradedHudObjective = { textContent: '' };
const degradedHud = { hidden: true, querySelector: () => degradedHudObjective };
const degradedTour = { hidden: true };
let degradedCalls = 0;
const degradedClient = createQuestClient({
  enabled: true,
  endpoint: '/npc-quest',
  getSession: async () => 'token',
  getNpcPosition: npcId => npcPositions.get(npcId) ?? null,
  hud: degradedHud,
  tour: degradedTour,
  fetcher: async (_url, options) => {
    const event = JSON.parse(options.body).event;
    degradedCalls++;
    if (event === 'status' && degradedCalls === 1) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => browserStore('user-recovered', event) };
  }
});
await degradedClient.setSignedIn(true);
assert.equal(degradedClient.status().ready, false, 'failed initial status marks authored quest degraded');
assert.equal(degradedHud.hidden, true, 'degraded authored HUD does not block discovery');
assert.equal(degradedTour.hidden, false, 'local tour becomes the safe guided fallback');
assert.equal(degradedClient.mapTarget(), null, 'degraded authored quest does not compete with the tour on the map');
assert.equal((await degradedClient.advanceNpc(id)).stage, 1, 'NPC interaction can recover after a transient status failure');
assert.equal(degradedClient.status().ready, true, 'successful quest call restores authored guidance');
assert.equal(degradedHud.hidden, false);
assert.equal(degradedTour.hidden, true);

let sent;
const remoteStore = createSupabaseQuestStore({ serviceRoleKey: 'server-only-test', fetcher: async (url, options) => {
  sent = { url, options };
  return { ok: true, json: async () => ({ quest_id: QUEST_ID, stage: 2 }) };
} });
assert.equal((await remoteStore('user-a', 'visit_main_hall')).stage, 2);
assert.match(sent.url, /advance_world_quest_v1$/);
assert.equal(sent.options.headers.Authorization, 'Bearer server-only-test');
assert.deepEqual(JSON.parse(sent.options.body), { p_user: 'user-a', p_event: 'visit_main_hall' });
await assert.rejects(remoteStore('user-a', 'grant_reward'), /INVALID_QUEST_EVENT/);

const mcmLocal = createLocalQuestStore();
assert.equal((await mcmLocal('mcm-user', 'status', MCM_2026_EVENT_ID)).progress.stage, 'NOT_STARTED');
await mcmLocal('mcm-user', 'start', MCM_2026_EVENT_ID);
await mcmLocal('mcm-user', 'investigate_dancing', MCM_2026_EVENT_ID);
await mcmLocal('mcm-user', 'investigate_staggering', MCM_2026_EVENT_ID);
const mcmLocalFinal = await mcmLocal('mcm-user', 'investigate_hungry', MCM_2026_EVENT_ID);
assert.equal(mcmLocalFinal.progress.stage, 'VENUE_UNLOCKED');
assert.deepEqual(mcmLocalFinal.progress.investigated, ['dancing', 'hungry', 'staggering']);

let mcmSent;
const mcmRemote = createSupabaseQuestStore({ serviceRoleKey: 'server-only-test', fetcher: async (url, options) => {
  mcmSent = { url, options };
  return { ok: true, json: async () => ({ eventId: MCM_2026_EVENT_ID, eventState: 'ACTIVE',
    progress: { stage: 'STARTED', investigated: [] }, landlord: { firstClearedAt: null, activeRun: null } }) };
} });
assert.equal((await mcmRemote('mcm-user', 'start', MCM_2026_EVENT_ID)).progress.stage, 'STARTED');
assert.match(mcmSent.url, /advance_mcm_2026_event_v1$/);
assert.deepEqual(JSON.parse(mcmSent.options.body), { p_user: 'mcm-user', p_event: 'start' });

async function request(body, verifiedUser = 'user-a') {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json', authorization: 'Bearer test' };
  const res = { status: 0, body: '', setHeader() {}, writeHead(code) { this.status = code; },
    end(value = '') { this.body = value; } };
  await createQuestCloudHandler({ store, verifyUser: async () => verifiedUser })(req, res);
  return res;
}
assert.equal((await request({ event: 'status' }, null)).status, 401);
assert.equal((await request({ event: 'grant_reward' })).status, 400);
assert.equal((await request({ event: 'status', stage: 5 })).status, 400);
assert.equal(JSON.parse((await request({ event: 'status' })).body).stage, 5);
const mcmHandlerResult = JSON.parse((await request({ quest_id: MCM_2026_EVENT_ID, event: 'start' }, 'mcm-cloud-user')).body);
assert.equal(mcmHandlerResult.eventId, MCM_2026_EVENT_ID);
assert.equal(mcmHandlerResult.progress.stage, 'STARTED');

process.env.NPC_QUEST_ENABLED = '1';
process.env.NPC_AI_CLOUD_RUN_URL = 'https://npc.example.run.app';
const require = createRequire(import.meta.url);
const proxy = require('../api/world-quest.js');
const response = () => ({ code: 0, value: null, setHeader() {}, status(code) { this.code = code; return this; },
  json(value) { this.value = value; return this; }, end() { return this; } });
const statusResponse = response();
await proxy({ method: 'GET', headers: {} }, statusResponse);
assert.deepEqual(statusResponse.value, { enabled: true });
let forwarded;
const fetchBefore = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  forwarded = { url, options };
  return { status: 200, json: async () => ({ quest_id: QUEST_ID, stage: 1 }) };
};
try {
  const blocked = response();
  await proxy({ method: 'POST', headers: { host: 'inhagame.example', origin: 'https://other.example',
    'content-type': 'application/json', authorization: `Bearer ${'x'.repeat(20)}` },
  body: { event: 'start' } }, blocked);
  assert.equal(blocked.code, 403);
  const ok = response();
  await proxy({ method: 'POST', headers: { host: 'inhagame.example', origin: 'https://inhagame.example',
    'content-type': 'application/json', authorization: `Bearer ${'x'.repeat(20)}` },
  body: { event: 'start' } }, ok);
  assert.equal(ok.code, 200);
  assert.equal(forwarded.url, 'https://npc.example.run.app/quest');
} finally {
  globalThis.fetch = fetchBefore;
  delete process.env.NPC_QUEST_ENABLED;
  delete process.env.NPC_AI_CLOUD_RUN_URL;
}
console.log('World first-walk quest state and authenticated transport: PASS');
