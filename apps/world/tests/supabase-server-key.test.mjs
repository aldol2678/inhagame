// Server credential selection (SUPABASE_SECRET_KEY first, legacy SUPABASE_SERVICE_ROLE_KEY
// fallback) and header shape: sb_secret_ keys go on `apikey` only; a legacy JWT keeps
// `apikey` + `Authorization: Bearer`. All values are fixtures, never real keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  SUPABASE_SERVER_KEY_INVALID, SUPABASE_SERVER_KEY_REQUIRED, isSupabaseSecretKey, readSupabaseServerKey,
  requireSupabaseServerKey, supabaseServerHeaders,
} from '../npc-factory/supabase-server-key.mjs';
import { createCollectionBookRpc } from '../server/collection-book-service.mjs';
import { createFishingRpc } from '../server/fishing-service.mjs';
import { createNpcAiQuota } from '../npc-factory/npc-ai-quota.mjs';
import { createSupabaseQuestStore } from '../npc-factory/quest-store.mjs';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';
import { createSupabaseNpcRelationshipStore } from '../npc-factory/npc-player-relationship-store.mjs';
import { NPC_RELATIONSHIP_DIALOGUE_EVENT } from '../npc-factory/npc-player-relationship-client.mjs';

const SECRET = 'sb_secret_fixture-not-a-real-key';
const LEGACY = 'eyJfixture.legacy-service-role.jwt';
const USER = '11111111-1111-4111-8111-111111111111';
const world = fileURLToPath(new URL('..', import.meta.url));

function assertSecretHeaders(headers, label) {
  assert.equal(headers.apikey, SECRET, label);
  assert.equal(headers.Authorization, undefined, `${label}: no Bearer for sb_secret_`);
  assert.ok(!Object.keys(headers).some((name) => /^authorization$/iu.test(name)), label);
  assert.equal(headers['Content-Type'], 'application/json', label);
}
function assertLegacyHeaders(headers, label) {
  assert.equal(headers.apikey, LEGACY, label);
  assert.equal(headers.Authorization, `Bearer ${LEGACY}`, label);
}

test('env order: SUPABASE_SECRET_KEY wins, legacy SUPABASE_SERVICE_ROLE_KEY is the fallback', () => {
  assert.deepEqual(readSupabaseServerKey({ SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: LEGACY }),
    { key: SECRET, source: 'SUPABASE_SECRET_KEY' });
  assert.deepEqual(readSupabaseServerKey({ SUPABASE_SERVICE_ROLE_KEY: LEGACY }),
    { key: LEGACY, source: 'SUPABASE_SERVICE_ROLE_KEY' });
  assert.deepEqual(readSupabaseServerKey({ SUPABASE_SECRET_KEY: '  ', SUPABASE_SERVICE_ROLE_KEY: LEGACY }),
    { key: LEGACY, source: 'SUPABASE_SERVICE_ROLE_KEY' }, 'blank new env rolls back to legacy');
  assert.equal(readSupabaseServerKey({ SUPABASE_SECRET_KEY: `${SECRET}\n` }).key, SECRET, 'trailing newline trimmed');
  assert.equal(readSupabaseServerKey({}), null);
  assert.equal(requireSupabaseServerKey({ SUPABASE_SECRET_KEY: SECRET }), SECRET);
});

test('missing or misconfigured credentials fail closed with fixed codes and no key value', () => {
  assert.throws(() => requireSupabaseServerKey({}), new RegExp(`^Error: ${SUPABASE_SERVER_KEY_REQUIRED}$`));
  assert.throws(() => requireSupabaseServerKey({ SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }),
    new RegExp(SUPABASE_SERVER_KEY_REQUIRED));
  for (const env of [{ SUPABASE_SECRET_KEY: 'sb_publishable_fixture' }, { SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_fixture' },
    { SUPABASE_SECRET_KEY: 'sb_secret_a b' }]) {
    try { readSupabaseServerKey(env); assert.fail('expected throw'); }
    catch (error) {
      assert.equal(error.message, SUPABASE_SERVER_KEY_INVALID);
      assert.doesNotMatch(String(error.stack), /fixture|sb_secret_a/);
    }
  }
  assert.throws(() => supabaseServerHeaders(''), new RegExp(SUPABASE_SERVER_KEY_REQUIRED));
  assert.throws(() => supabaseServerHeaders(undefined), new RegExp(SUPABASE_SERVER_KEY_REQUIRED));
});

test('header builder: sb_secret_ -> apikey only; legacy JWT -> apikey + Bearer', () => {
  assert.equal(isSupabaseSecretKey(SECRET), true);
  assert.equal(isSupabaseSecretKey(LEGACY), false);
  assertSecretHeaders(supabaseServerHeaders(SECRET, { 'Content-Type': 'application/json' }), 'secret');
  assertLegacyHeaders(supabaseServerHeaders(LEGACY, { 'Content-Type': 'application/json' }), 'legacy');
  const stripped = supabaseServerHeaders(SECRET, { authorization: 'Bearer leak', APIKEY: 'other', 'Content-Type': 'application/json' });
  assertSecretHeaders(stripped, 'caller-supplied auth headers are dropped');
  assert.equal(stripped.APIKEY, undefined);
});

const okJson = (body) => async () => ({ ok: true, json: async () => body });

test('every server consumer sends sb_secret_ on apikey only and keeps legacy apikey + Bearer', async () => {
  for (const [key, check] of [[SECRET, assertSecretHeaders], [LEGACY, assertLegacyHeaders]]) {
    const sent = [];
    const capture = (body) => async (url, options) => { sent.push({ url, headers: options.headers }); return okJson(body)(); };

    await createCollectionBookRpc({ url: 'https://db.example', serviceKey: key, fetcher: capture({ userId: USER, entries: [] }) })(
      'world_collection_list_v1', { p_user: USER });
    await createFishingRpc({ url: 'https://db.example', serviceKey: key, fetcher: capture({ attempt: null }) })(
      'world_fishing_read_v1', { p_user: USER });
    await createNpcAiQuota({ serviceRoleKey: key, fetcher: capture('OK') })(USER);
    await createSupabaseQuestStore({ serviceRoleKey: key, supabaseUrl: 'https://db.example',
      fetcher: capture({ quest_id: QUEST_ID, stage: 2 }) })(USER, 'visit_main_hall');
    await createSupabaseNpcRelationshipStore({ serviceRoleKey: key, supabaseUrl: 'https://db.example',
      now: () => new Date('2026-10-06T16:30:00.000Z'),
      fetcher: capture({ status: 'APPLIED', relationship: { npcId: 'INKYUNG-NPC-001', affinity: 2, tier: 'STRANGER',
        relationshipClass: 'HERO', definitionVersion: 1, encounterCount: 1, meaningfulInteractionCount: 0, revision: 1 } }) })(
      USER, 'INKYUNG-NPC-001', NPC_RELATIONSHIP_DIALOGUE_EVENT.OPEN);

    assert.equal(sent.length, 5);
    for (const { url, headers } of sent) check(headers, `${key === SECRET ? 'secret' : 'legacy'} ${url}`);
  }
});

test('npc-ai-quota no longer mixes a publishable apikey with a service-role Bearer', async () => {
  let headers;
  await createNpcAiQuota({ serviceRoleKey: SECRET, fetcher: async (_url, options) => { headers = options.headers; return okJson('OK')(); } })(USER);
  assert.equal(headers.apikey, SECRET);
  assert.doesNotMatch(String(headers.apikey), /^sb_publishable_/);
  assert.equal(headers.Authorization, undefined);
});

test('Vercel entry points prefer SUPABASE_SECRET_KEY and 503 with a fixed code when no key is set', async () => {
  const require = createRequire(import.meta.url);
  const names = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'WORLD_FISHING_API_ENABLED'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch, originalError = console.error;
  const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; },
    end() { return this; }, json(data) { this.data = data; return this; } });
  const logged = [];
  try {
    Object.assign(process.env, { SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: LEGACY,
      SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', WORLD_FISHING_API_ENABLED: '1' });
    const rpcHeaders = [];
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: USER, is_anonymous: false }) };
      rpcHeaders.push(options.headers);
      if (url.endsWith('world_collection_list_v1')) return { ok: true, json: async () => ({ userId: USER, entries: [] }) };
      return { ok: true, json: async () => ({ attempt: null, inventory: { quantity: 0 } }) };
    };
    const book = require('../api/world-collection-book.js');
    const fishing = require('../api/world-fishing.js');
    const auth = { authorization: `Bearer ${'v'.repeat(30)}`, host: 'world.test' };
    const okBook = res(); await book({ method: 'GET', url: '/api/world-collection-book', headers: auth }, okBook);
    assert.equal(okBook.code, 200);
    assert.equal(rpcHeaders.length, 1);
    assertSecretHeaders(rpcHeaders[0], 'collection book entry uses the new key');

    // Fresh module instances so the cached handler promise does not hide the missing-key path.
    for (const path of ['../api/world-collection-book.js', '../api/world-fishing.js']) delete require.cache[require.resolve(path)];
    delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.error = (...args) => logged.push(args.join(' '));
    const missingBook = res(); await require('../api/world-collection-book.js')({ method: 'GET', url: '/', headers: auth }, missingBook);
    assert.equal(missingBook.code, 503);
    assert.deepEqual(missingBook.data, { error: 'COLLECTION_BOOK_UNAVAILABLE' });
    const missingFish = res();
    const fishReq = { method: 'POST', url: '/api/world-fishing', headers: { ...auth, 'content-type': 'application/json' }, body: { op: 'read' } };
    await require('../api/world-fishing.js')(fishReq, missingFish);
    assert.equal(missingFish.code, 503);
    assert.deepEqual(logged, [SUPABASE_SERVER_KEY_REQUIRED, SUPABASE_SERVER_KEY_REQUIRED]);
    assert.equal(typeof fishing, 'function');
  } finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});

test('NPC AI container starts with only SUPABASE_SECRET_KEY and refuses a publishable key in the server slot', async () => {
  const base = { PATH: process.env.PATH, NPC_AI_ENABLED: '1', NPC_AI_PROJECT: 'local-test-project',
    SUPABASE_URL: 'https://dummy-ref.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy' };
  const refused = spawnSync(process.execPath, ['npc-factory/npc-ai-cloud-run.mjs'], {
    cwd: world, encoding: 'utf8', env: { ...base, SUPABASE_SECRET_KEY: 'sb_publishable_dummy' }, timeout: 10_000 });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /NPC_AI_PRODUCTION_CONFIG_REQUIRED/);
  assert.doesNotMatch(refused.stderr, /sb_publishable_dummy/);

  const port = String(20000 + Math.floor(Math.random() * 20000));
  const child = spawn(process.execPath, ['npc-factory/npc-ai-cloud-run.mjs'], { cwd: world,
    env: { ...base, PORT: port, SUPABASE_SECRET_KEY: SECRET }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    let listening = false;
    for (let i = 0; i < 50 && !listening && child.exitCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      listening = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    }
    assert.ok(listening, `entrypoint did not listen: ${stderr}`);
  } finally { child.kill(); }
});
