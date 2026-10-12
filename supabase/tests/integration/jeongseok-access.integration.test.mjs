// JSL-A Jeongseok access + visitor pass against the disposable local Supabase stack.
// Players call the Data API (PostgREST) with minted JWTs exactly as the browser does, so racing
// purchases use real pooled connections. Fixtures, seed credits and readback use psql.
//
// The gate policy and pass product ship COMING_SOON. This file opens both on the local stack only
// and restores the shipped state afterwards.
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
const PASS = 'jeongseok.visitor.day';

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

async function server(fn, args) {
  const call = `select public.${fn}(${args.map((a) => typeof a === 'number' ? String(a) : lit(a)).join(', ')})::text`;
  const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`, call);
  return JSON.parse(out.split('\n').at(-1));
}
const credit = (user, amount) => server('world_wallet_credit_v1', [user, COIN, amount, 'REWARD', 'test', 'seed', `seed:${user}:${randomUUID()}`]);
const balance = async (user) => (await server('world_wallet_get_balance_v1', [user, COIN])).balance;
const count = (table, user, extra = '') => Number(sqlSync(`select count(*) from private.${table} where user_id = ${lit(user)} ${extra}`));
const debits = (user) => count('world_currency_transactions', user, `and source_type = 'jeongseok_pass'`);

const users = [];
function createUser({ email = null, banned = false } = {}) {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(email ?? `jsl-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`j${id.slice(0, 8)}`)}, ${banned})`);
  users.push(id);
  return id;
}
function jwt(sub, extraClaims = {}) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: false,
    session_id: randomUUID(), iat: now, exp: now + 600, ...extraClaims });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function rest(path, { token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  return { status: response.status, body: parsed };
}
const access = async (token) => {
  const r = await rest('/rest/v1/rpc/get_jeongseok_access_v1', { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
async function buy(token, key, passType = PASS, extra = {}) {
  const r = await rest('/rest/v1/rpc/purchase_jeongseok_pass_v1', { token, body: { p_pass_type: passType, p_idempotency_key: key, ...extra } });
  return r.status === 200 ? { ok: true, value: r.body } : { ok: false, status: r.status, error: r.body?.message ?? r.body };
}

test.before(() => {
  sqlSync(`update private.world_jeongseok_gate_policy set status = 'ACTIVE'`);
  sqlSync(`update private.world_jeongseok_pass_catalog set status = 'ACTIVE' where pass_type = ${lit(PASS)}`);
});
test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
  sqlSync(`update private.world_jeongseok_gate_policy set status = 'COMING_SOON'`);
  sqlSync(`update private.world_jeongseok_pass_catalog set status = 'COMING_SOON' where pass_type = ${lit(PASS)}`);
});

test('verified account enters free; general account buys once, a fresh session reads the same right', async () => {
  const verified = createUser({ email: `v-${randomUUID().slice(0, 8)}@inha.edu` });
  const v = await access(jwt(verified));
  assert.deepEqual([v.decision, v.via, v.offer], ['GRANTED', 'INHA_MAIL', null]);
  assert.equal((await buy(jwt(verified), `jsl:${randomUUID()}`)).error, 'FREE_ACCESS_ELIGIBLE');

  const user = createUser();
  await credit(user, 230);
  const before = await access(jwt(user));
  assert.deepEqual([before.decision, before.offer.price, before.offer.balance, before.offer.canPurchase], ['NEEDS_PASS', 100, 230, true]);
  const key = `jsl:${randomUUID()}`;
  const first = await buy(jwt(user), key);
  assert.ok(first.ok, JSON.stringify(first));
  assert.deepEqual([first.value.status, first.value.price, first.value.balanceAfter, first.value.access.via],
    ['SUCCESS', 100, 130, 'VISITOR_PASS']);
  const session = jwt(user);
  const after = await access(session);
  assert.deepEqual([after.decision, after.via, after.pass.expiresAt], ['GRANTED', 'VISITOR_PASS', first.value.expiresAt]);
  assert.equal(await balance(user), 130);
  assert.equal(debits(user), 1);
});

test('client cannot inject price, account or expiry into the purchase', async () => {
  const user = createUser();
  const other = createUser();
  await credit(user, 100);
  const forged = await buy(jwt(user), `jsl:${randomUUID()}`, PASS,
    { p_price: 1, p_user: other, p_expires_at: '2099-01-01T00:00:00Z' });
  assert.equal(forged.ok, false, 'PostgREST has no such overload');
  assert.equal(await balance(user), 100);
  assert.equal(debits(user) + debits(other), 0);
  const guest = await rest('/rest/v1/rpc/get_jeongseok_access_v1', {});
  assert.ok(guest.status >= 400, 'the anon role has no access read');
});

test('8 concurrent retries of one key: one debit, one receipt, converged results', async () => {
  const user = createUser();
  await credit(user, 100);
  const key = `jsl:${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => buy(jwt(user), key)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(results.filter((r) => r.value.status === 'SUCCESS').length, 1, 'exactly one real purchase');
  assert.equal(new Set(results.map((r) => r.value.purchaseId)).size, 1);
  assert.equal(await balance(user), 0);
  assert.equal(debits(user), 1);
  assert.equal(count('world_jeongseok_pass_purchases', user), 1);
});

test('6 different keys racing: one pass issued, nobody else charged', async () => {
  const user = createUser();
  await credit(user, 600);
  const results = await Promise.all(Array.from({ length: 6 }, () => buy(jwt(user), `jsl:${randomUUID()}`)));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.error), Array(5).fill('PASS_ALREADY_ACTIVE'));
  assert.equal(await balance(user), 500);
  assert.equal(debits(user), 1);
  assert.equal(count('world_jeongseok_pass_entitlements', user), 1);
});

test('lost response: replaying the stored key recovers the receipt without a second debit', async () => {
  const user = createUser();
  await credit(user, 150);
  const key = `jsl:${randomUUID()}`;
  void (await buy(jwt(user), key)); // the client "never saw" this response
  const recovered = await buy(jwt(user), key);
  assert.deepEqual([recovered.value.status, recovered.value.balanceAfter, recovered.value.access.decision],
    ['ALREADY_PROCESSED', 50, 'GRANTED']);
  assert.equal(await balance(user), 50);
  assert.equal(debits(user), 1);
});

test('insufficient funds and account isolation', async () => {
  const a = createUser();
  const b = createUser();
  await credit(a, 99);
  const poor = await buy(jwt(a), `jsl:${randomUUID()}`);
  assert.deepEqual([poor.ok, poor.error], [false, 'INSUFFICIENT_FUNDS']);
  const readA = await access(jwt(a));
  assert.deepEqual([readA.offer.shortfall, readA.offer.canPurchase], [1, false]);
  await credit(a, 1);
  const key = `jsl:${randomUUID()}`;
  assert.ok((await buy(jwt(a), key)).ok);
  const readB = await access(jwt(b));
  assert.deepEqual([readB.decision, readB.pass, readB.offer.balance, readB.userId], ['NEEDS_PASS', null, 0, b]);
  const stolen = await buy(jwt(b), key);
  assert.deepEqual([stolen.ok, stolen.error], [false, 'IDEMPOTENCY_CONFLICT']);
  assert.equal(debits(b), 0);
});

test('anonymous and banned sessions are refused; expiry is decided by the server clock', async () => {
  const anon = createUser();
  const anonRead = await access(jwt(anon, { is_anonymous: true }));
  assert.equal(anonRead.decision, 'AUTH_REQUIRED');
  assert.equal((await buy(jwt(anon, { is_anonymous: true }), `jsl:${randomUUID()}`)).error, 'PERMANENT_ACCOUNT_REQUIRED');
  const banned = createUser({ banned: true });
  assert.equal((await access(jwt(banned))).decision, 'ACCOUNT_BLOCKED');
  assert.equal((await buy(jwt(banned), `jsl:${randomUUID()}`)).error, 'ACCOUNT_UNAVAILABLE');

  const user = createUser();
  await credit(user, 200);
  assert.ok((await buy(jwt(user), `jsl:${randomUUID()}`)).ok);
  sqlSync(`update private.world_jeongseok_pass_entitlements set issued_at = now() - interval '25 hours',
    expires_at = now() - interval '1 second' where user_id = ${lit(user)}`);
  const expired = await access(jwt(user));
  assert.deepEqual([expired.decision, expired.granted, expired.pass.active], ['EXPIRED', false, false]);
  assert.ok((await buy(jwt(user), `jsl:${randomUUID()}`)).ok, 'expired pass renews');
  assert.equal(await balance(user), 0);
});
