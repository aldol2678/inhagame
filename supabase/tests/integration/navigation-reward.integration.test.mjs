// Progression / Economy P1d · Main2 navigation reward over the real player path against the disposable
// local stack: HTTP POST /quest {quest_id, event} → createQuestCloudHandler → createSupabaseQuestStore →
// PostgREST advance_world_navigation_quest_v1 (service role) → private.world_reward_grant_v1 → Wallet
// ledger / EXP ledger. Then the first purchase loop through the Data API as the player: Shop cap 180 →
// wallet 0 → inventory → equip HEAD.
//
// Auth is checked locally (minted JWT signature) instead of the production Auth URL, as in
// first-campus-reward.integration.test.mjs.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { createQuestCloudHandler } from '../../../apps/world/npc-factory/quest-cloud-handler.mjs';
import { createSupabaseQuestStore } from '../../../apps/world/npc-factory/quest-store.mjs';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && JWT_SECRET, 'API_URL, ANON_KEY, DB_URL and JWT_SECRET come from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

function sql(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try {
    return execFileSync('psql', [DB_URL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return execFileSync('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8' }).trim();
  }
}
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sign(payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const playerJwt = (sub) => sign({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false,
  session_id: randomUUID(), iat: now(), exp: now() + 600 });
const SERVICE_JWT = sign({ role: 'service_role', iss: 'supabase-demo', iat: now(), exp: now() + 3600 });

// Local stand-in for verifyNpcAiUser: a signed, permanent, authenticated local session → its user id.
async function verifyLocalUser(authorization) {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
  const [head, body, mac] = token?.split('.') ?? [];
  if (!mac) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return claims.role === 'authenticated' && claims.is_anonymous === false && claims.exp > now() ? claims.sub : null;
}

const handler = createQuestCloudHandler({
  verifyUser: verifyLocalUser,
  store: createSupabaseQuestStore({ serviceRoleKey: SERVICE_JWT, supabaseUrl: API_URL,
    fetcher: (url, options) => fetch(url, { ...options, headers: { ...options.headers, apikey: ANON_KEY } }) })
});

/** One browser request through the real /quest handler: the body is only the event. */
async function quest(token, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const res = { status: 0, body: '', setHeader() {}, writeHead(code) { this.status = code; },
    end(value = '') { this.body = value; } };
  await handler(req, res);
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
}

const users = [];
function createUser() {
  const id = randomUUID();
  sql(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`p1d-${id}@example.test`)}, now(), false)`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`d${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}
test.after(() => {
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});

const MAIN2 = 'campus_navigation_intro_v1';
const MAIN2_PATH = ['start', 'set_building5_destination', 'start_auto_building5', 'pause_auto_building5',
  'resume_auto_building5', 'visit_building5', 'set_back_gate_destination', 'start_auto_back_gate'];
const progress = (user) => sql(`select (s->>'totalExp') || '/Lv.' || (s->>'level')
  from private.world_progression_snapshot_v1(${lit(user)}) s`);
const coins = (user) => Number(sql(`select coalesce(sum(balance), 0) from private.world_wallets
  where user_id = ${lit(user)} and currency_id = 'currency.induck_coin'`));
const navTx = (user) => Number(sql(`select count(*) from private.world_reward_transactions
  where user_id = ${lit(user)} and idempotency_key = ${lit(`grant:quest.navigation_intro:${user}`)}`));
const coinRows = (user, type = 'REWARD') => Number(sql(`select count(*) from private.world_currency_transactions
  where user_id = ${lit(user)} and type = ${lit(type)}`));
const expRows = (user) => Number(sql(`select count(*) from private.world_exp_transactions where user_id = ${lit(user)}`));
const owned = (user, item) => Number(sql(`select coalesce(sum(quantity), 0) from private.world_player_items
  where user_id = ${lit(user)} and item_id = ${lit(item)}`));

async function rest(token, fn, body) {
  const response = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function completeMain1(token) {
  for (const event of ['start', 'visit_main_hall', 'visit_inkyung', 'talk_002', 'talk_001']) {
    assert.equal((await quest(token, { event })).status, 200, event);
  }
}
async function walkMain2To8(token) {
  for (const [index, event] of MAIN2_PATH.entries()) {
    const result = await quest(token, { quest_id: MAIN2, event });
    assert.equal(result.status, 200, event);
    assert.deepEqual(result.body, { quest_id: MAIN2, stage: index + 1, available: true }, `${event} carries no reward`);
  }
}

test('First Campus → Main2 over /quest: 200 EXP (Lv.2) and 180 coins, once; then the first purchase', async () => {
  const user = createUser();
  const token = playerJwt(user);
  await completeMain1(token);
  assert.equal(progress(user), '100/Lv.2');
  assert.equal(coins(user), 0);
  await walkMain2To8(token);
  assert.equal(navTx(user), 0, 'no reward before completion');

  const done = await quest(token, { quest_id: MAIN2, event: 'visit_back_gate' });
  assert.equal(done.status, 200);
  assert.equal(done.body.stage, 9);
  assert.equal(done.body.available, true);
  const reward = done.body.reward;
  assert.equal(reward.rewardId, 'reward.quest.navigation_intro');
  assert.equal(reward.status, 'SUCCESS');
  assert.equal(reward.replayed, false);
  assert.deepEqual(reward.entries.map(({ grantType, targetId, granted, status }) => [grantType, targetId, granted, status]),
    [['CURRENCY', 'currency.induck_coin', 180, 'GRANTED'], ['EXP', 'exp.campus', 100, 'GRANTED']]);
  for (const key of ['userId', 'user_id', 'idempotencyKey', 'idempotency_key']) assert.equal(key in reward, false);
  assert.equal(progress(user), '200/Lv.2', 'still Lv.2 (Lv.3 is 300)');
  assert.equal(coins(user), 180);
  assert.equal(navTx(user), 1);
  assert.equal(coinRows(user), 1);
  assert.equal(expRows(user), 2, 'First Campus + Main2');

  for (const event of ['visit_back_gate', 'status', 'visit_back_gate', 'start']) {
    const again = await quest(token, { quest_id: MAIN2, event });
    assert.deepEqual(again.body, { quest_id: MAIN2, stage: 9, available: true }, `${event} replays without a reward`);
  }
  assert.deepEqual([progress(user), coins(user), navTx(user), coinRows(user), expRows(user)], ['200/Lv.2', 180, 1, 1, 2]);

  // First purchase loop (local stack only): the player buys head.induck_cap for exactly 180 and equips it.
  const purchase = await rest(token, 'purchase_world_shop_listing_v1',
    { p_listing_id: 'offer.student_center.induck_cap', p_idempotency_key: `shop:${randomUUID()}` });
  assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
  assert.equal(purchase.body.status, 'SUCCESS', JSON.stringify(purchase.body));
  assert.equal(coins(user), 0, 'wallet 180 → 0');
  assert.equal(coinRows(user, 'PURCHASE'), 1);
  assert.equal(owned(user, 'head.induck_cap'), 1);
  const equip = await rest(token, 'equip_my_world_item_v1',
    { p_slot: 'HEAD', p_item_id: 'head.induck_cap', p_idempotency_key: `equip:${randomUUID()}` });
  assert.equal(equip.status, 200, JSON.stringify(equip.body));
  const loadout = await rest(token, 'get_my_world_appearance_loadout_v1', {});
  assert.equal(loadout.status, 200);
  assert.match(JSON.stringify(loadout.body), /head\.induck_cap/, 'the cap is equipped in the HEAD slot');
});

test('the browser cannot name a reward, amount or user for Main2', async () => {
  const user = createUser();
  const token = playerJwt(user);
  for (const body of [{ quest_id: MAIN2, event: 'grant_reward' }, { quest_id: MAIN2, event: 'visit_back_gate', stage: 9 },
    { quest_id: MAIN2, event: 'visit_back_gate', reward: 'x' }, { quest_id: MAIN2, event: 'visit_back_gate', amount: 180 }]) {
    assert.equal((await quest(token, body)).status, 400, JSON.stringify(body));
  }
  const direct = await rest(token, 'world_reward_grant_v1', { p_user: user, p_reward_id: 'reward.quest.navigation_intro',
    p_source_type: 'QUEST', p_source_id: 'quest.navigation_intro', p_idempotency_key: `grant:quest.navigation_intro:${user}` });
  assert.ok(direct.status >= 400, 'the Reward core is not exposed to players');
  const rpc = await rest(token, 'advance_world_navigation_quest_v1', { p_user: user, p_event: 'visit_back_gate' });
  assert.ok(rpc.status >= 400, 'players cannot call the Main2 RPC directly');
  assert.deepEqual([coins(user), navTx(user)], [0, 0]);
});

test('8 concurrent final visits produce one transition and one reward', async () => {
  const user = createUser();
  const token = playerJwt(user);
  await completeMain1(token);
  await walkMain2To8(token);
  const results = await Promise.all(Array.from({ length: 8 }, () => quest(token, { quest_id: MAIN2, event: 'visit_back_gate' })));
  assert.ok(results.every((r) => r.status === 200 && r.body.stage === 9), JSON.stringify(results.map((r) => r.status)));
  assert.equal(results.filter((r) => r.body.reward).length, 1, 'only the winning call carries the reward');
  assert.deepEqual([navTx(user), coinRows(user), expRows(user), coins(user), progress(user)], [1, 1, 2, 180, '200/Lv.2']);
});

test('another account is untouched', async () => {
  const a = createUser();
  const b = createUser();
  await completeMain1(playerJwt(a));
  await walkMain2To8(playerJwt(a));
  await quest(playerJwt(a), { quest_id: MAIN2, event: 'visit_back_gate' });
  assert.deepEqual((await quest(playerJwt(b), { quest_id: MAIN2, event: 'status' })).body, { quest_id: MAIN2, stage: 0, available: false });
  assert.deepEqual([coins(b), navTx(b), progress(b)], [0, 0, '0/Lv.1']);
});
