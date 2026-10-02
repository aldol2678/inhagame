// Progression P1c · First Campus reward over the real player path against the disposable local stack:
// HTTP POST /quest → createQuestCloudHandler → createSupabaseQuestStore → PostgREST
// advance_world_quest_v1 (service role) → private.world_reward_grant_v1 → Inventory / EXP ledger.
//
// The production handler verifies the Supabase session at the production Auth URL, so here the
// handler gets a verifyUser that checks the minted local JWT's signature instead. The store posts to
// the local API with a minted service-role JWT; Kong only needs the local publishable key as apikey.
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
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`p1c-${id}@example.test`)}, now(), false)`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`c${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}
test.after(() => {
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});

const progress = (user) => sql(`select (s->>'totalExp') || '/Lv.' || (s->>'level')
  from private.world_progression_snapshot_v1(${lit(user)}) s`);
const owned = (user, item) => Number(sql(`select coalesce(sum(quantity), 0) from private.world_player_items
  where user_id = ${lit(user)} and item_id = ${lit(item)}`));
const rewardTx = (user) => Number(sql(`select count(*) from private.world_reward_transactions
  where user_id = ${lit(user)} and idempotency_key = ${lit(`grant:quest.first_campus:${user}`)}`));
const expRows = (user) => Number(sql(`select count(*) from private.world_exp_transactions where user_id = ${lit(user)}`));
const coins = (user) => Number(sql(`select coalesce(sum(balance), 0) from private.world_wallets where user_id = ${lit(user)}`))
  + Number(sql(`select count(*) from private.world_currency_transactions where user_id = ${lit(user)}`));

async function walkTo4(token) {
  for (const [event, stage] of [['start', 1], ['visit_main_hall', 2], ['visit_inkyung', 3], ['talk_002', 4]]) {
    const result = await quest(token, { event });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { quest_id: 'campus_first_walk_v1', stage }, `${event} carries no reward`);
  }
}

test('a fresh account completes the walk over /quest and receives badge + 100 EXP once', async () => {
  const user = createUser();
  const token = playerJwt(user);
  assert.equal(progress(user), '0/Lv.1');
  await walkTo4(token);
  assert.equal(rewardTx(user), 0, 'no reward before completion');

  const done = await quest(token, { event: 'talk_001' });
  assert.equal(done.status, 200);
  assert.equal(done.body.stage, 5);
  const reward = done.body.reward;
  assert.equal(reward.rewardId, 'reward.quest.first_campus');
  assert.equal(reward.status, 'SUCCESS');
  assert.equal(reward.replayed, false);
  assert.deepEqual(reward.entries.map(({ grantType, targetId, granted, status }) => [grantType, targetId, granted, status]),
    [['ITEM', 'badge.main_gate', 1, 'GRANTED'], ['EXP', 'exp.campus', 100, 'GRANTED']]);
  for (const key of ['userId', 'user_id', 'idempotencyKey', 'idempotency_key']) assert.equal(key in reward, false);

  assert.equal(progress(user), '100/Lv.2');
  assert.equal(owned(user, 'badge.main_gate'), 1);
  assert.equal(coins(user), 0, 'no wallet change');
  assert.equal(rewardTx(user), 1);
  assert.equal(expRows(user), 1);

  for (const event of ['talk_001', 'status', 'talk_001']) {
    const again = await quest(token, { event });
    assert.deepEqual(again.body, { quest_id: 'campus_first_walk_v1', stage: 5 }, `${event} replays without a reward`);
  }
  assert.equal(progress(user), '100/Lv.2');
  assert.equal(rewardTx(user), 1);
  assert.equal(expRows(user), 1);
});

test('the browser cannot name a reward, amount or user', async () => {
  const user = createUser();
  const token = playerJwt(user);
  for (const body of [{ event: 'grant_reward' }, { event: 'talk_001', stage: 5 }, { event: 'talk_001', reward: 'x' },
    { event: 'talk_001', user_id: user }]) {
    assert.equal((await quest(token, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await quest('not-a-token', { event: 'status' })).status, 401);
  const direct = await fetch(`${API_URL}/rest/v1/rpc/world_reward_grant_v1`, { method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: user, p_reward_id: 'reward.quest.first_campus', p_source_type: 'QUEST',
      p_source_id: 'quest.first_campus', p_idempotency_key: `grant:quest.first_campus:${user}` }) });
  assert.ok(direct.status >= 400, 'the Reward core is not exposed to players');
  const quest1 = await fetch(`${API_URL}/rest/v1/rpc/advance_world_quest_v1`, { method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: user, p_event: 'start' }) });
  assert.ok(quest1.status >= 400, 'players cannot call the quest RPC directly');
  assert.equal(rewardTx(user), 0);
  assert.equal(progress(user), '0/Lv.1');
});

test('8 concurrent final talks produce one transition and one reward', async () => {
  const user = createUser();
  const token = playerJwt(user);
  await walkTo4(token);
  const results = await Promise.all(Array.from({ length: 8 }, () => quest(token, { event: 'talk_001' })));
  assert.ok(results.every((r) => r.status === 200 && r.body.stage === 5));
  assert.equal(results.filter((r) => r.body.reward).length, 1, 'only the winning call carries the reward');
  assert.equal(rewardTx(user), 1);
  assert.equal(expRows(user), 1);
  assert.equal(owned(user, 'badge.main_gate'), 1);
  assert.equal(progress(user), '100/Lv.2');
});

test('another account is untouched', async () => {
  const a = createUser();
  const b = createUser();
  await walkTo4(playerJwt(a));
  await quest(playerJwt(a), { event: 'talk_001' });
  assert.deepEqual((await quest(playerJwt(b), { event: 'status' })).body, { quest_id: 'campus_first_walk_v1', stage: 0 });
  assert.equal(progress(b), '0/Lv.1');
  assert.equal(owned(b, 'badge.main_gate'), 0);
  assert.equal(rewardTx(b), 0);
});
