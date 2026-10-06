import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import {
  createNpcPlayerRelationshipClient,
  NPC_RELATIONSHIP_DIALOGUE_EVENT
} from '../npc-factory/npc-player-relationship-client.mjs';
import {
  createSupabaseNpcRelationshipStore,
  npcRelationshipKstDay
} from '../npc-factory/npc-player-relationship-store.mjs';
import { createNpcRelationshipCloudHandler } from '../npc-factory/npc-player-relationship-cloud-handler.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'x'.repeat(32);
const heroId = 'INKYUNG-NPC-001';
const relationship = (npcId = heroId, affinity = 2, tier = 'STRANGER') => ({
  npcId, affinity, tier, relationshipClass: 'HERO', definitionVersion: 1,
  encounterCount: 1, meaningfulInteractionCount: 0, revision: 1
});

test('relationship client is inert while disabled/signed out and never sends non-HERO ids', async () => {
  let calls = 0;
  const client = createNpcPlayerRelationshipClient({
    enabled: false,
    getSession: async () => TOKEN,
    fetcher: async () => { calls++; throw Error('must not fetch'); }
  });
  client.setSignedIn(true);
  assert.equal(await client.recordConversationOpen(heroId), null);
  client.setEnabled(true);
  assert.equal(await client.recordConversationOpen('INKYUNG-NPC-003'), null);
  assert.equal(calls, 0);
});

test('relationship client emits one open and one meaningful topic event per runtime session', async () => {
  const bodies = [];
  const client = createNpcPlayerRelationshipClient({
    enabled: true,
    getSession: async () => TOKEN,
    fetcher: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        status: 'APPLIED',
        relationship: relationship(options.body.includes('"TOPIC"') ? heroId : heroId)
      }) };
    }
  });
  client.setSignedIn(true);
  await client.recordConversationOpen(heroId);
  await client.recordConversationOpen(heroId);
  await client.recordMeaningfulDialogue(heroId);
  await client.recordMeaningfulDialogue(heroId);
  assert.deepEqual(bodies, [
    { npcId: heroId, event: NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN },
    { npcId: heroId, event: NPC_RELATIONSHIP_DIALOGUE_EVENT.TOPIC }
  ]);
  assert.equal(client.status().openSentCount, 1);
  assert.equal(client.status().topicSentCount, 1);
});

test('missing token or failed request does not permanently suppress a later retry', async () => {
  let token = null;
  let attempts = 0;
  const client = createNpcPlayerRelationshipClient({
    enabled: true,
    getSession: async () => token,
    fetcher: async () => {
      attempts++;
      if (attempts === 1) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ status: 'APPLIED', relationship: relationship() }) };
    }
  });
  client.setSignedIn(true);
  assert.equal(await client.recordConversationOpen(heroId), null);
  token = TOKEN;
  await assert.rejects(client.recordConversationOpen(heroId), /NPC_RELATIONSHIP_UNAVAILABLE/);
  assert.equal((await client.recordConversationOpen(heroId)).status, 'APPLIED');
  assert.equal(attempts, 2);
});

test('server store computes +2 first meeting and +1 daily dialogue without trusting browser deltas/signals', async () => {
  const requests = [];
  const now = () => new Date('2026-10-06T16:30:00.000Z'); // 2026-10-07 KST
  const store = createSupabaseNpcRelationshipStore({
    serviceRoleKey: 'server-secret',
    supabaseUrl: 'https://project.supabase.co',
    now,
    fetcher: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      const affinity = requests.length === 1 ? 2 : 3;
      return { ok: true, json: async () => ({
        status: 'APPLIED', relationship: relationship(heroId, affinity, 'STRANGER')
      }) };
    }
  });

  await store(USER_ID, heroId, NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN);
  await store(USER_ID, heroId, NPC_RELATIONSHIP_DIALOGUE_EVENT.TOPIC);

  assert.equal(npcRelationshipKstDay(now()), '2026-10-07');
  assert.equal(requests[0].url,
    'https://project.supabase.co/rest/v1/rpc/world_campus_npc_relationship_apply_v1');
  assert.deepEqual(requests[0].body, {
    p_user: USER_ID,
    p_npc_id: heroId,
    p_definition_version: 1,
    p_event_type: 'FIRST_MEETING',
    p_signal: null,
    p_occurrence: 1,
    p_requested_delta: 2,
    p_source_type: 'DIALOGUE',
    p_source_ref: 'dialogue:first_meeting',
    p_idempotency_key: `campus-npc-rel:${USER_ID}:${heroId}:first`
  });
  assert.equal(requests[1].body.p_event_type, 'MEANINGFUL_DIALOGUE');
  assert.equal(requests[1].body.p_requested_delta, 1);
  assert.equal(requests[1].body.p_signal, null);
  assert.equal(requests[1].body.p_source_ref, 'dialogue:meaningful:2026-10-07');
  assert.equal(requests[1].body.p_idempotency_key,
    `campus-npc-rel:${USER_ID}:${heroId}:dialogue:2026-10-07`);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer server-secret');
});

test('server store rejects non-HERO ids before touching Supabase', async () => {
  let fetched = 0;
  const store = createSupabaseNpcRelationshipStore({
    serviceRoleKey: 'server-secret',
    fetcher: async () => { fetched++; throw Error('must not fetch'); }
  });
  await assert.rejects(store(USER_ID, 'INKYUNG-NPC-003', NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN),
    /NPC_RELATIONSHIP_NPC_NOT_ALLOWED/);
  assert.equal(fetched, 0);
});

const response = () => ({
  status: null, body: '', headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  writeHead(status) { this.status = status; },
  end(value = '') { this.body = value; }
});

async function cloudRequest(body, { userId = USER_ID, store = async (_u, npcId) => ({
  status: 'APPLIED', relationship: relationship(npcId)
}) } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
  const res = response();
  await createNpcRelationshipCloudHandler({
    store,
    verifyUser: async () => userId
  })(req, res);
  return res;
}

test('Cloud Run relationship handler authenticates, validates HERO ids and passes only semantic event', async () => {
  let captured = null;
  const ok = await cloudRequest({ npcId: heroId, event: 'OPEN' }, {
    store: async (...args) => {
      captured = args;
      return { status: 'APPLIED', relationship: relationship(heroId) };
    }
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(captured, [USER_ID, heroId, 'OPEN']);
  assert.equal((await cloudRequest({ npcId: 'INKYUNG-NPC-003', event: 'OPEN' })).status, 400);
  assert.equal((await cloudRequest({ npcId: heroId, event: 'OPEN' }, { userId: null })).status, 401);
});

test('Vercel gateway exposes an opt-in flag and proxies bearer/body to /relationship', async () => {
  const oldEnabled = process.env.NPC_RELATIONSHIP_ENABLED;
  const oldUrl = process.env.NPC_AI_CLOUD_RUN_URL;
  process.env.NPC_RELATIONSHIP_ENABLED = '1';
  process.env.NPC_AI_CLOUD_RUN_URL = 'https://npc.example.run.app';
  const require = createRequire(import.meta.url);
  const resolved = require.resolve('../api/npc-relationship.js');
  delete require.cache[resolved];
  const gateway = require('../api/npc-relationship.js');
  const makeRes = () => ({
    statusCode: 200, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  });
  const flag = makeRes();
  await gateway({ method: 'GET', headers: {} }, flag);
  assert.deepEqual(flag.body, { enabled: true });

  const originalFetch = globalThis.fetch;
  let forwarded = null;
  globalThis.fetch = async (url, options) => {
    forwarded = { url, options, body: JSON.parse(options.body) };
    return { status: 200, json: async () => ({ status: 'APPLIED', relationship: relationship(heroId) }) };
  };
  try {
    const res = makeRes();
    await gateway({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'inhagame.app',
        origin: 'https://inhagame.app',
        authorization: `Bearer ${TOKEN}`
      },
      body: { npcId: heroId, event: 'TOPIC' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(forwarded.url, 'https://npc.example.run.app/relationship');
    assert.equal(forwarded.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(forwarded.body, { npcId: heroId, event: 'TOPIC' });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldEnabled === undefined) delete process.env.NPC_RELATIONSHIP_ENABLED;
    else process.env.NPC_RELATIONSHIP_ENABLED = oldEnabled;
    if (oldUrl === undefined) delete process.env.NPC_AI_CLOUD_RUN_URL;
    else process.env.NPC_AI_CLOUD_RUN_URL = oldUrl;
    delete require.cache[resolved];
  }
});
