import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseQuestStore } from '../npc-factory/quest-store.mjs';
import { createQuestClient } from '../npc-factory/quest-client.mjs';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';
import { MAIN_NPC_ID } from '../npc-factory/npc-presence.mjs';

const USER = '00000000-0000-4000-8000-000000000001';
const KEY = `grant:quest.first_campus:${USER}`;
const fresh = {
  rewardId: 'reward.quest.first_campus', rewardVersion: 2, rewardTransactionId: 'receipt-1',
  status: 'SUCCESS', replayed: false, completedAt: '2026-09-30T00:00:00Z',
  entries: [
    { grantType: 'ITEM', targetId: 'badge.main_gate', requested: 1, granted: 1, status: 'GRANTED', reason: null },
    { grantType: 'EXP', targetId: 'exp.campus', requested: 100, granted: 100, status: 'GRANTED', reason: null }
  ]
};
const replay = { ...fresh, replayed: true };
const stored = {
  ...replay, userId: USER, idempotencyKey: KEY, sourceType: 'QUEST', sourceId: 'quest.first_campus',
  attempts: 1, entries: replay.entries.map(entry => ({ ...entry, childIdempotencyKey: 'private-child-key' }))
};
const done = { quest_id: QUEST_ID, stage: 5 };
const ok = body => ({ ok: true, json: async () => body });

function server({ result = done, receipt = stored, lookupFailure = false } = {}) {
  const calls = [];
  const store = createSupabaseQuestStore({ serviceRoleKey: 'unit-test-only', supabaseUrl: 'https://example.invalid',
    fetcher: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/advance_world_quest_v1')) return ok(result);
      assert.match(url, /\/world_reward_get_result_v1$/, 'recovery reads, never grants');
      if (lookupFailure) throw Error('network unavailable');
      return ok(receipt);
    }
  });
  return { store, calls };
}
function browser(respond) {
  const rewards = [], requests = [];
  const client = createQuestClient({ enabled: true, endpoint: '/api/world-quest', getSession: async () => 'test-token',
    onReward: reward => rewards.push(reward), fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return ok(await respond(body));
    }
  });
  return { client, rewards, requests };
}

for (const event of ['talk_001']) {
  test(`completed ${event} reads the existing receipt with the server-derived key`, async () => {
    const { store, calls } = server();
    const result = await store(USER, event);
    assert.deepEqual(result, { ...done, rewardReceipt: replay });
    assert.equal('reward' in result, false, 'legacy reward keeps its completing-call-only contract');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body, { p_idempotency_key: KEY });
    assert.match(calls[1].url, /\/world_reward_get_result_v1$/);
    assert.doesNotMatch(JSON.stringify(result), /userId|idempotencyKey|childIdempotencyKey|sourceType|attempts/);
  });
}
test('fresh completion remains unchanged and makes no extra receipt read', async () => {
  const result = { ...done, reward: fresh };
  const { store, calls } = server({ result });
  assert.deepEqual(await store(USER, 'talk_001'), result);
  assert.equal(calls.length, 1);
});
test('incomplete final talk makes no receipt read', async () => {
  const result = { quest_id: QUEST_ID, stage: 4 };
  const { store, calls } = server({ result });
  assert.deepEqual(await store(USER, 'talk_001'), result);
  assert.equal(calls.length, 1);
});
test('legacy completion without a receipt is not backfilled or fabricated', async () => {
  const { store, calls } = server({ receipt: null });
  assert.deepEqual(await store(USER, 'talk_001'), done);
  assert.equal(calls.length, 2);
});
test('receipt lookup failure does not hide committed quest progress', async () => {
  const { store, calls } = server({ lookupFailure: true });
  assert.deepEqual(await store(USER, 'talk_001'), done);
  assert.equal(calls.length, 2);
});
for (const [name, receipt] of [
  ['different account', { ...stored, userId: 'other-account' }],
  ['different key', { ...stored, idempotencyKey: 'other-key' }],
  ['different reward', { ...stored, rewardId: 'reward.other' }],
  ['not a replay', { ...stored, replayed: false }],
  ['malformed entries', { ...stored, entries: [] }]
]) {
  test(`untrusted stored receipt (${name}) is not exposed`, async () => {
    const { store, calls } = server({ receipt });
    assert.deepEqual(await store(USER, 'talk_001'), done);
    assert.equal(calls.length, 2, 'the invalid receipt was actually read');
  });
}
test('completed status is unchanged: returning players are not reported as new reward recipients', async () => {
  const { store, calls } = server();
  const { client, rewards } = browser(({ event }) => store(USER, event));
  await client.setSignedIn(true);
  assert.equal(client.stage, 5);
  assert.deepEqual(rewards, []);
  assert.equal(calls.length, 1);
});
test('new browser forwards a validated final-talk receipt without computing rewards', async () => {
  const { client, rewards, requests } = browser(({ event }) => event === 'status'
    ? { quest_id: QUEST_ID, stage: 4 } : { ...done, rewardReceipt: replay });
  await client.setSignedIn(true);
  await client.advanceNpc(MAIN_NPC_ID);
  assert.equal(client.stage, 5);
  assert.deepEqual(rewards, [replay]);
  assert.deepEqual(requests, [{ event: 'status' }, { event: 'talk_001' }]);
});
test('new browser remains compatible with an old server returning stage only', async () => {
  const { client, rewards } = browser(() => done);
  await client.setSignedIn(true);
  assert.equal(client.stage, 5);
  assert.deepEqual(rewards, []);
});
for (const [name, payload] of [
  ['different reward', { ...done, rewardReceipt: { ...replay, rewardId: 'reward.other' } }],
  ['fresh receipt', { ...done, rewardReceipt: fresh }],
  ['incomplete stage', { ...done, stage: 4, rewardReceipt: replay }],
  ['missing transaction', { ...done, rewardReceipt: { ...replay, rewardTransactionId: '' } }],
  ['empty entries', { ...done, rewardReceipt: { ...replay, entries: [] } }],
  ['ambiguous fresh and replay', { ...done, reward: fresh, rewardReceipt: replay }]
]) {
  test(`browser rejects invalid final-talk receipt (${name})`, async () => {
    const { client, rewards } = browser(({ event }) => event === 'status' ? { quest_id: QUEST_ID, stage: 4 } : payload);
    await client.setSignedIn(true);
    await assert.rejects(client.advanceNpc(MAIN_NPC_ID), /QUEST_UNAVAILABLE/);
    assert.equal(client.stage, 4);
    assert.deepEqual(rewards, []);
  });
}
test('late receipt is discarded after sign-out', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { client, rewards } = browser(({ event }) => event === 'status' ? { quest_id: QUEST_ID, stage: 4 } : gate);
  await client.setSignedIn(true);
  const pending = client.advanceNpc(MAIN_NPC_ID);
  await Promise.resolve();
  await client.setSignedIn(false);
  release({ ...done, rewardReceipt: replay });
  assert.equal(await pending, null);
  assert.equal(client.status().signedIn, false);
  assert.deepEqual(rewards, []);
});
test('late receipt cannot leak into another account generation', async () => {
  let release, statuses = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { client, rewards } = browser(({ event }) => event === 'status'
    ? { quest_id: QUEST_ID, stage: ++statuses === 1 ? 4 : 0 } : gate);
  await client.setSignedIn(true);
  const oldRequest = client.advanceNpc(MAIN_NPC_ID);
  await Promise.resolve();
  await client.setSignedIn(true);
  release({ ...done, rewardReceipt: replay });
  assert.equal(await oldRequest, null);
  assert.equal(client.stage, 0);
  assert.equal(client.status().ready, true);
  assert.deepEqual(rewards, []);
});
test('guest makes no quest request and receives no receipt', async () => {
  const { client, rewards, requests } = browser(() => { throw Error('must not fetch'); });
  await client.setSignedIn(false);
  assert.equal(await client.advanceNpc(MAIN_NPC_ID), null);
  assert.deepEqual(requests, []);
  assert.deepEqual(rewards, []);
});
test('lost completion response recovers on retry without a second grant', async () => {
  let stage = 4, grants = 0, dropFirstCompletion = true;
  const rpcCalls = [];
  const store = createSupabaseQuestStore({ serviceRoleKey: 'unit-test-only', supabaseUrl: 'https://example.invalid',
    fetcher: async (url, options) => {
      rpcCalls.push(url);
      if (url.endsWith('/world_reward_get_result_v1')) return ok(stored);
      assert.match(url, /\/advance_world_quest_v1$/);
      const { p_event: event } = JSON.parse(options.body);
      if (event === 'talk_001' && stage === 4) {
        stage = 5; grants++;
        return ok({ ...done, reward: fresh });
      }
      return ok({ quest_id: QUEST_ID, stage });
    }
  });
  const { client, rewards, requests } = browser(async ({ event }) => {
    const result = await store(USER, event);
    if (event === 'talk_001' && dropFirstCompletion) {
      dropFirstCompletion = false;
      throw Error('response lost after server commit');
    }
    return result;
  });
  await client.setSignedIn(true);
  await assert.rejects(client.advanceNpc(MAIN_NPC_ID), /response lost/);
  assert.equal(client.stage, 4);
  assert.equal((await client.advanceNpc(MAIN_NPC_ID)).stage, 5);
  assert.deepEqual(rewards, [replay]);
  assert.equal(grants, 1);
  assert.equal(rpcCalls.filter(url => url.endsWith('/world_reward_get_result_v1')).length, 1);
  for (const body of requests) assert.deepEqual(Object.keys(body), ['event']);
});
