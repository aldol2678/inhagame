import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { QUEST_ID } from './quest-contract.mjs';
import { MAIN2_QUEST_ID } from './main2-quest-contract.mjs';
import {
  MAIN3_QUEST_ID,
  MAIN3_QUEST_EVENTS,
  MAIN3_QUEST_OBJECTIVES,
  nextMain3QuestStage
} from './main3-quest-contract.mjs';
import { createLocalQuestStore, createSupabaseQuestStore } from './quest-store.mjs';
import { createQuestCloudHandler } from './quest-cloud-handler.mjs';

assert.equal(MAIN3_QUEST_ID, 'campus_first_style_v1');
assert.deepEqual(MAIN3_QUEST_EVENTS, ['status', 'start']);
assert.equal(MAIN3_QUEST_OBJECTIVES.length, 5);
assert.equal(MAIN3_QUEST_OBJECTIVES[1], '학생회관 굿즈샵으로 가 보자');
assert.equal(nextMain3QuestStage(0, 'start', { available: false }), 0);
assert.equal(nextMain3QuestStage(0, 'start', { available: true }), 1);
assert.equal(nextMain3QuestStage(1, 'start', { available: true }), 1);
assert.throws(() => nextMain3QuestStage(1, 'purchase_done'), /INVALID_QUEST_EVENT/);

const local = createLocalQuestStore();
const user = 'main3-local-a';
assert.deepEqual(await local(user, 'status', MAIN3_QUEST_ID),
  { quest_id: MAIN3_QUEST_ID, stage: 0, available: false });
assert.equal((await local(user, 'start', MAIN3_QUEST_ID)).stage, 0,
  'Main 3 cannot start before Main 2');

for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001'])
  await local(user, event, QUEST_ID);
for (const event of [
  'start', 'set_building5_destination', 'start_auto_building5', 'pause_auto_building5',
  'resume_auto_building5', 'visit_building5', 'set_back_gate_destination',
  'start_auto_back_gate', 'visit_back_gate'
]) await local(user, event, MAIN2_QUEST_ID);

assert.deepEqual(await local(user, 'status', MAIN3_QUEST_ID),
  { quest_id: MAIN3_QUEST_ID, stage: 0, available: true });
assert.equal((await local(user, 'start', MAIN3_QUEST_ID)).stage, 1);
assert.deepEqual(await local(user, 'status', MAIN3_QUEST_ID),
  { quest_id: MAIN3_QUEST_ID, stage: 1, available: true },
  'local status restores the persisted Main 3 stage');
assert.equal((await local(user, 'start', MAIN3_QUEST_ID)).stage, 1, 'duplicate start is idempotent');
assert.equal((await local('main3-local-b', 'status', MAIN3_QUEST_ID)).stage, 0,
  'local accounts are isolated');
await assert.rejects(local(user, 'purchase_done', MAIN3_QUEST_ID), /INVALID_QUEST_EVENT/);

let sent;
const remote = createSupabaseQuestStore({
  serviceRoleKey: 'server-only-test',
  supabaseUrl: 'http://127.0.0.1:54321',
  fetcher: async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ quest_id: MAIN3_QUEST_ID, stage: 1, available: true }) };
  }
});
assert.deepEqual(await remote('main3-remote-a', 'status', MAIN3_QUEST_ID),
  { quest_id: MAIN3_QUEST_ID, stage: 1, available: true });
assert.equal(sent.url,
  'http://127.0.0.1:54321/rest/v1/rpc/advance_world_first_style_quest_v1');
assert.deepEqual(JSON.parse(sent.options.body), { p_user: 'main3-remote-a', p_event: 'status' });
await assert.rejects(remote('main3-remote-a', 'purchase_done', MAIN3_QUEST_ID), /INVALID_QUEST_EVENT/);

async function request(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', authorization: 'Bearer test' };
  const res = {
    status: 0, body: '', setHeader() {},
    writeHead(code) { this.status = code; },
    end(value = '') { this.body = value; }
  };
  await createQuestCloudHandler({
    store: local,
    verifyUser: async () => user
  })(req, res);
  return res;
}

const status = await request({ quest_id: MAIN3_QUEST_ID, event: 'status' });
assert.equal(status.status, 200);
assert.equal(JSON.parse(status.body).stage, 1);
assert.equal((await request({ quest_id: MAIN3_QUEST_ID, event: 'purchase_done' })).status, 400);
assert.equal((await request({ quest_id: MAIN3_QUEST_ID, event: 'status', stage: 4 })).status, 400);

console.log('World Main 3 M3.1 contract, persistence routing and account isolation: PASS');
