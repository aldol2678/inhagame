// Economy P0-C Reward Orchestrator against the disposable local Supabase stack. Each server call is
// its own psql process (own connection and transaction), so concurrent retries genuinely race, a
// killed backend is a real crash, and every readback comes from a fresh connection. Player reads and
// client forge attempts go through the local Data API with minted JWTs.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && JWT_SECRET, 'API_URL, ANON_KEY, DB_URL and JWT_SECRET come from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

const run = promisify(execFile);
const COIN = 'currency.induck_coin';
const MAIN_CLEAR = 'reward.event.mcm_2026_main_clear';
const RECOVERY_FIXTURE = 'reward.test.p0c_it_recovery';
const EXP_FIXTURE = 'reward.test.p0f1_it_exp';
const SERVICE = ['set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`];

async function psql(...commands) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', ...commands.flatMap((c) => ['-c', c])];
  try {
    return (await run('psql', [DB_URL, ...args], { encoding: 'utf8' })).stdout.trim();
  } catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return (await run('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8' })).stdout.trim();
  }
}
function sqlSync(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try {
    return execFileSync('psql', [DB_URL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return execFileSync('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8' }).trim();
  }
}
const lit = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const call = (fn, args) => `select public.${fn}(${args.map((a) => typeof a === 'number' ? String(a) : lit(a)).join(', ')})::text`;

/** A server (service_role) call on a fresh connection: { ok, value } or { ok: false, error }. */
async function server(fn, args) {
  try {
    const out = await psql(...SERVICE, call(fn, args));
    return { ok: true, value: JSON.parse(out.split('\n').at(-1)) };
  } catch (error) {
    const match = /ERROR:\s+([A-Z_]+)/.exec(String(error.stderr ?? error.message));
    return { ok: false, error: match ? match[1] : String(error.stderr ?? error.message) };
  }
}
const grantReward = (user, rewardId, key, { source = 'EVENT', sourceId = 'integration' } = {}) =>
  server('world_reward_grant_v1', [user, rewardId, source, sourceId, key]);
const balance = async (user) => (await server('world_wallet_get_balance_v1', [user, COIN])).value.balance;
const owned = async (user) => (await server('world_inventory_list_v1', [user])).value.items.map((i) => i.itemId).sort();
const progression = async (user) => (await server('world_progression_get_v1', [user])).value;
const count = (table, user) => Number(sqlSync(`select count(*) from private.${table} where user_id = ${lit(user)}`));

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`reward-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`r${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}
function jwt(sub) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false,
    session_id: randomUUID(), iat: now, exp: now + 600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function rest(path, { token, method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the raw error text */ }
  return { status: response.status, body: parsed };
}

test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
  sqlSync(`delete from private.world_reward_grants where reward_id in (${lit(RECOVERY_FIXTURE)}, ${lit(EXP_FIXTURE)})`);
  sqlSync(`delete from private.world_reward_definitions where reward_id in (${lit(RECOVERY_FIXTURE)}, ${lit(EXP_FIXTURE)})`);
});

test('vertical slice rewards persist across connections and player sessions', async () => {
  const user = createUser();
  const quest = await grantReward(user, 'reward.quest.first_campus', `grant:quest.first_campus:${user}`,
    { source: 'QUEST', sourceId: 'quest.first_campus' });
  assert.equal(quest.value.status, 'SUCCESS', JSON.stringify(quest));
  const key = `reward:event.mcm_2026:${user}:main_clear`;
  const event = await grantReward(user, MAIN_CLEAR, key, { sourceId: 'event.mcm_2026:main_clear' });
  assert.equal(event.value.status, 'SUCCESS', JSON.stringify(event));

  // Fresh connections read the real final state, not the RPC's own response.
  assert.equal(await balance(user), 80);
  assert.deepEqual(await owned(user), ['badge.main_gate', 'furniture.mcm_2026_poster', 'top.mcm_2026_survivor']);
  const ledger = JSON.parse(sqlSync(`select json_agg(t) from private.world_currency_transactions t where t.user_id = ${lit(user)}`));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].transaction_id, event.value.entries[0].childTransactionId, 'entry holds the wallet transaction identity');
  const stored = (await server('world_reward_get_result_v1', [key])).value;
  assert.deepEqual({ ...stored, replayed: false }, event.value, 'the reward record reads back identically');

  for (const token of [jwt(user), jwt(user)]) {
    const wallet = await rest('/rest/v1/rpc/get_my_world_wallet_v1', { token, body: {} });
    assert.deepEqual(wallet.body, { currencies: [{ id: COIN, balance: 80 }] });
    const inventory = await rest('/rest/v1/rpc/get_my_world_inventory_v1', { token, body: {} });
    assert.deepEqual(inventory.body.items.map((i) => i.itemId).sort(),
      ['badge.main_gate', 'furniture.mcm_2026_poster', 'top.mcm_2026_survivor']);
    const poster = inventory.body.items.find((i) => i.itemId === 'furniture.mcm_2026_poster');
    assert.deepEqual([poster.sourceType, poster.sourceRef, poster.eventId], ['EVENT', MAIN_CLEAR, 'event.mcm_2026']);
  }
});

test('8 concurrent retries of one reward key move value once', async () => {
  const user = createUser();
  const key = `reward:event.mcm_2026:${user}:main_clear`;
  const results = await Promise.all(Array.from({ length: 8 }, () => grantReward(user, MAIN_CLEAR, key)));
  assert.ok(results.every((r) => r.ok && r.value.status === 'SUCCESS'), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(results.filter((r) => r.value.replayed === false).length, 1, 'exactly one execution');
  assert.equal(new Set(results.map((r) => r.value.rewardTransactionId)).size, 1, 'one reward transaction');
  assert.equal(await balance(user), 80);
  assert.equal(count('world_currency_transactions', user), 1);
  assert.equal(count('world_item_grants', user), 2);
  assert.equal(count('world_reward_transactions', user), 1);
});

test('8 concurrent retries of a reward with EXP apply every child exactly once', async () => {
  sqlSync(`insert into private.world_reward_definitions(reward_id, status, description)
    values (${lit(EXP_FIXTURE)}, 'ACTIVE', 'P0-F1 integration EXP fixture') on conflict do nothing`);
  sqlSync(`insert into private.world_reward_grants values
    (${lit(EXP_FIXTURE)}, 'currency.induck_coin', 0, 'CURRENCY', ${lit(COIN)}, 10),
    (${lit(EXP_FIXTURE)}, 'item.furniture.induck_cushion', 1, 'ITEM', 'furniture.induck_cushion', 1),
    (${lit(EXP_FIXTURE)}, 'exp.campus', 2, 'EXP', 'exp.campus', 25)
    on conflict do nothing`);

  const user = createUser();
  const key = `reward:p0f1:${user}:exp`;
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    grantReward(user, EXP_FIXTURE, key, { source: 'SYSTEM', sourceId: 'p0f1.integration' })));

  assert.ok(results.every((r) => r.ok && r.value.status === 'SUCCESS'),
    JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(results.filter((r) => r.value.replayed === false).length, 1, 'exactly one parent execution');
  assert.equal(new Set(results.map((r) => r.value.rewardTransactionId)).size, 1, 'one reward transaction');
  assert.equal(await balance(user), 10);
  assert.deepEqual(await owned(user), ['furniture.induck_cushion']);
  assert.deepEqual(
    { totalExp: (await progression(user)).totalExp, level: (await progression(user)).level },
    { totalExp: 25, level: 1 });
  assert.equal(count('world_currency_transactions', user), 1);
  assert.equal(count('world_item_grants', user), 1);
  assert.equal(count('world_exp_transactions', user), 1);
  assert.equal(count('world_reward_transactions', user), 1);

  const stored = (await server('world_reward_get_result_v1', [key])).value;
  const expEntry = stored.entries.find((e) => e.grantType === 'EXP');
  const expTx = JSON.parse(sqlSync(`select row_to_json(t) from private.world_exp_transactions t
    where t.user_id = ${lit(user)}`));
  assert.equal(expEntry.childTransactionId, expTx.transaction_id, 'Reward entry points at the P0-F0 EXP ledger row');
  assert.equal(expTx.idempotency_key, expEntry.childIdempotencyKey, 'Reward child key is the EXP ledger idempotency key');
  assert.equal(expTx.source_type, 'reward');
  assert.match(expTx.source_id, /^reward\.test\.p0f1_it_exp:[0-9a-f-]+:exp\.campus$/);
});

test('an already owned UNIQUE item is skipped and the rest of the reward still lands', async () => {
  const user = createUser();
  const pre = await server('world_inventory_grant_item_v1', [user, 'furniture.mcm_2026_poster', 1, 'SHOP', 'shop.earlier', `it:${user}:poster`]);
  assert.equal(pre.value.status, 'GRANTED');
  const result = await grantReward(user, MAIN_CLEAR, `reward:event.mcm_2026:${user}:main_clear`);
  assert.equal(result.value.status, 'PARTIAL_SUCCESS');
  assert.deepEqual(result.value.entries.map((e) => [e.targetId, e.status, e.reason]), [
    [COIN, 'GRANTED', null], ['top.mcm_2026_survivor', 'GRANTED', null], ['furniture.mcm_2026_poster', 'SKIPPED', 'ALREADY_OWNED'],
    ['exp.campus', 'GRANTED', null]]);
  assert.equal(await balance(user), 80, 'no coin refund for the duplicate');
  const poster = (await server('world_inventory_get_item_v1', [user, 'furniture.mcm_2026_poster'])).value.item;
  assert.equal(poster.sourceRef, 'shop.earlier', 'the earlier provenance stays');
});

test('a crash mid-execution rolls the attempt back and a retry applies it once', async () => {
  const user = createUser();
  const key = `reward:event.mcm_2026:${user}:crash`;
  const app = `p0c_crash_${user.slice(0, 8)}`;
  // The reward runs inside an open transaction that is killed before it can commit.
  const doomed = psql(`set application_name = '${app}'`, ...SERVICE, 'begin',
    call('world_reward_grant_v1', [user, MAIN_CLEAR, 'EVENT', 'integration', key]), 'select pg_sleep(10)', 'commit');
  let killed = false;
  for (let i = 0; i < 100 && !killed; i += 1) {
    killed = sqlSync(`select coalesce(bool_or(pg_terminate_backend(pid)), false) from pg_stat_activity
      where application_name = '${app}' and query like '%pg_sleep%' and state = 'active'`) === 't';
    if (!killed) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(killed, 'the backend running the reward was terminated');
  await assert.rejects(doomed, 'the crashed session never committed');
  assert.equal(count('world_reward_transactions', user), 0, 'no reward record survived the crash');
  assert.equal(await balance(user), 0, 'no coin survived the crash');
  assert.deepEqual(await owned(user), [], 'no item survived the crash');

  const retry = await grantReward(user, MAIN_CLEAR, key);
  assert.deepEqual([retry.value.status, retry.value.replayed, retry.value.attempts], ['SUCCESS', false, 1]);
  assert.equal(await balance(user), 80);
  assert.equal(count('world_currency_transactions', user), 1);
});

test('an adapter failure mid-reward is resumed by retrying the same key', async () => {
  sqlSync(`insert into private.world_reward_definitions(reward_id, status, description)
    values (${lit(RECOVERY_FIXTURE)}, 'ACTIVE', 'integration recovery fixture') on conflict do nothing`);
  sqlSync(`insert into private.world_reward_grants values
    (${lit(RECOVERY_FIXTURE)}, 'item.furniture.mcm_2026_poster', 0, 'ITEM', 'furniture.mcm_2026_poster', 1),
    (${lit(RECOVERY_FIXTURE)}, 'currency.induck_coin', 1, 'CURRENCY', ${lit(COIN)}, 30),
    (${lit(RECOVERY_FIXTURE)}, 'item.furniture.induck_cushion', 2, 'ITEM', 'furniture.induck_cushion', 1)
    on conflict do nothing`);
  const user = createUser();
  // Fault injection on this account only: a wallet one credit away from bigint overflow.
  sqlSync(`insert into private.world_wallets(user_id, currency_id, balance) values (${lit(user)}, ${lit(COIN)}, 9223372036854775800)`);
  const key = `reward:test:${user}:recovery`;

  const first = await grantReward(user, RECOVERY_FIXTURE, key, { source: 'SYSTEM' });
  assert.equal(first.value.status, 'FAILED', JSON.stringify(first));
  assert.deepEqual(first.value.entries.map((e) => [e.targetId, e.status]),
    [['furniture.mcm_2026_poster', 'GRANTED'], [COIN, 'FAILED'], ['furniture.induck_cushion', 'GRANTED']]);
  assert.match(first.value.entries[1].reason, /out of range/);
  assert.equal(count('world_currency_transactions', user), 0, 'the failed credit left no ledger row');
  assert.deepEqual(await owned(user), ['furniture.induck_cushion', 'furniture.mcm_2026_poster']);

  sqlSync(`delete from private.world_wallets where user_id = ${lit(user)}`); // the fault is repaired
  const retry = await grantReward(user, RECOVERY_FIXTURE, key, { source: 'SYSTEM' });
  assert.deepEqual([retry.value.status, retry.value.attempts, retry.value.rewardTransactionId],
    ['SUCCESS', 2, first.value.rewardTransactionId]);
  assert.deepEqual(retry.value.entries.map((e) => [e.targetId, e.status, e.attempts]),
    [['furniture.mcm_2026_poster', 'GRANTED', 1], [COIN, 'GRANTED', 2], ['furniture.induck_cushion', 'GRANTED', 1]]);
  assert.equal(await balance(user), 30);
  assert.equal(count('world_currency_transactions', user), 1);
  assert.equal(count('world_item_grants', user), 2, 'granted items were not granted again');

  const replay = await grantReward(user, RECOVERY_FIXTURE, key, { source: 'SYSTEM' });
  assert.deepEqual([replay.value.status, replay.value.replayed], ['SUCCESS', true]);
});

test('clients cannot run, forge or read rewards through the Data API', async () => {
  const user = createUser();
  const token = jwt(user);
  const attempts = [
    ['player grantReward', '/rest/v1/rpc/world_reward_grant_v1', { token, body: {
      p_user: user, p_reward_id: MAIN_CLEAR, p_source_type: 'EVENT', p_source_id: 'x', p_idempotency_key: `client:${user}:1` } }],
    ['guest grantReward', '/rest/v1/rpc/world_reward_grant_v1', { body: {
      p_user: user, p_reward_id: MAIN_CLEAR, p_source_type: 'EVENT', p_source_id: 'x', p_idempotency_key: `client:${user}:2` } }],
    ['player picks an amount', '/rest/v1/rpc/world_reward_grant_v1', { token, body: {
      p_user: user, p_reward_id: MAIN_CLEAR, p_source_type: 'EVENT', p_source_id: 'x', p_idempotency_key: `client:${user}:3`,
      p_amount: 999999, p_item_id: 'furniture.mini_induck' } }],
    ['player reads reward records', '/rest/v1/rpc/world_reward_get_result_v1', { token, body: { p_idempotency_key: `client:${user}:1` } }],
    ['player defines a reward', '/rest/v1/world_reward_definitions', { token, headers: { 'Content-Profile': 'private' },
      body: { reward_id: 'reward.client.free', status: 'ACTIVE', description: 'x' } }],
    ['player forges a transaction', '/rest/v1/world_reward_transactions', { token, headers: { 'Content-Profile': 'private' },
      body: { user_id: user, reward_id: MAIN_CLEAR, reward_version: 1, source_type: 'EVENT', source_id: 'x',
        idempotency_key: `client:${user}:4`, status: 'SUCCESS' } }],
    ['player edits an entry', '/rest/v1/world_reward_transaction_entries', { token, method: 'PATCH',
      headers: { 'Content-Profile': 'private' }, body: { status: 'GRANTED' } }],
    ['player reads definitions', '/rest/v1/world_reward_grants', { token, method: 'GET', headers: { 'Accept-Profile': 'private' } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  assert.equal(await balance(user), 0);
  assert.deepEqual(await owned(user), []);
  assert.equal(count('world_reward_transactions', user), 0);
});

test('account deletion removes reward records with the value they granted', async () => {
  const user = createUser();
  await grantReward(user, MAIN_CLEAR, `reward:event.mcm_2026:${user}:delete`);
  assert.equal(count('world_reward_transactions', user), 1);
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  for (const table of ['world_reward_transactions', 'world_currency_transactions', 'world_player_items']) {
    assert.equal(count(table, user), 0, table);
  }
});
