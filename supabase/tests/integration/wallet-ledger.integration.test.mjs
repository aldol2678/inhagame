// Economy P0-A Wallet + Ledger against the disposable local Supabase stack, where a single pgTAP
// transaction cannot reach: every server call below is its own psql process, so its own database
// connection and transaction, and parallel calls genuinely race for the same wallet. Player reads
// and client write attempts go through the local Data API (PostgREST) with minted JWTs.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL, 'API_URL, ANON_KEY and DB_URL come from the local stack');
assert.ok(JWT_SECRET, 'JWT_SECRET comes from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

const COIN = 'currency.induck_coin';
const run = promisify(execFile);

/** One psql process = one connection. Resolves stdout; rejects with psql's stderr. */
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

/** A server (service_role) WalletService call on a fresh connection: { ok, value } or { ok: false, error }. */
async function server(fn, args) {
  const call = `select public.${fn}(${args.map((a) => typeof a === 'number' ? String(a) : lit(a)).join(', ')})::text`;
  try {
    const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`, call);
    return { ok: true, value: JSON.parse(out.split('\n').at(-1)) };
  } catch (error) {
    const match = /ERROR:\s+([A-Z_]+)/.exec(String(error.stderr ?? error.message));
    return { ok: false, error: match ? match[1] : String(error.stderr ?? error.message) };
  }
}
const credit = (user, amount, key, type = 'REWARD') =>
  server('world_wallet_credit_v1', [user, COIN, amount, type, 'integration_test', key, key]);
const debit = (user, amount, key, type = 'PURCHASE') =>
  server('world_wallet_debit_v1', [user, COIN, amount, type, 'integration_test', key, key]);
const balance = async (user) => (await server('world_wallet_get_balance_v1', [user, COIN])).value.balance;
const ledger = (user) => JSON.parse(sqlSync(`select coalesce(json_agg(t order by t.created_at), '[]')
  from private.world_currency_transactions t where t.user_id = ${lit(user)}`));

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`wallet-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`w${id.slice(0, 8)}`)}, false)`);
  users.push(id);
  return id;
}
/** Hold the wallet row lock on another connection while `work` starts, so every call must queue. */
async function whileWalletLocked(user, work) {
  const holder = psql(`begin; select 1 from private.world_wallets where user_id = ${lit(user)} for update;
    select pg_sleep(1.5); commit;`);
  // Race the calls only once the holder's row lock is visible.
  const lockHeld = () => Number(sqlSync(`select count(*) from pg_locks l join pg_class c on c.oid = l.relation
    where c.relname = 'world_wallets' and l.mode = 'RowShareLock' and l.granted`)) > 0;
  for (let i = 0; !lockHeld(); i += 1) {
    assert.ok(i < 40, 'lock holder never took the wallet row lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const results = await work();
  await holder;
  return results;
}
/** A fixture wallet at balance 0 with no history, so contention starts from an existing row. */
const openWallet = (user) => sqlSync(`insert into private.world_wallets(user_id, currency_id) values (${lit(user)}, ${lit(COIN)})`);

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
});

test('concurrent +20 / +30 from 0 end at exactly 50 (no lost update)', async () => {
  const fresh = createUser();
  const raced = await Promise.all([credit(fresh, 20, `it:${fresh}:c20`), credit(fresh, 30, `it:${fresh}:c30`)]);
  assert.ok(raced.every((r) => r.ok && r.value.status === 'SUCCESS'), JSON.stringify(raced));
  assert.equal(await balance(fresh), 50, 'first-write race on a wallet that did not exist yet');

  const queued = createUser();
  openWallet(queued);
  const gated = await whileWalletLocked(queued, () =>
    Promise.all([credit(queued, 20, `it:${queued}:c20`), credit(queued, 30, `it:${queued}:c30`)]));
  assert.ok(gated.every((r) => r.ok && r.value.status === 'SUCCESS'), JSON.stringify(gated));
  assert.equal(await balance(queued), 50, 'both credits queued on the same row lock');
  const chain = ledger(queued).sort((a, b) => a.balance_before - b.balance_before);
  assert.equal(chain.length, 2);
  assert.equal(chain[0].balance_before, 0);
  assert.equal(chain[1].balance_before, chain[0].balance_after, 'the second credit started from the first result');
  assert.equal(chain[1].balance_after, 50);
});

test('20 parallel +5 credits end at exactly 100', async () => {
  const user = createUser();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => credit(user, 5, `it:${user}:burst${i}`)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(await balance(user), 100);
  const rows = ledger(user);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map((r) => r.balance_before).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i * 5),
    'every credit saw the previous balance: a gapless chain 0,5,...,95');
});

test('competing debits never overdraw or lose an update', async () => {
  const user = createUser();
  assert.equal((await credit(user, 100, `it:${user}:seed`)).value.balanceAfter, 100);
  const pair = await whileWalletLocked(user, () =>
    Promise.all([debit(user, 70, `it:${user}:d70`), debit(user, 60, `it:${user}:d60`)]));
  assert.equal(pair.filter((r) => r.ok).length, 1, JSON.stringify(pair));
  assert.deepEqual(pair.filter((r) => !r.ok).map((r) => r.error), ['INSUFFICIENT_FUNDS']);
  const after = await balance(user);
  assert.ok(after === 30 || after === 40, `balance ${after}`);

  const rush = await Promise.all(Array.from({ length: 10 }, (_, i) => debit(user, 15, `it:${user}:rush${i}`)));
  const expectedWins = Math.floor(after / 15);
  assert.equal(rush.filter((r) => r.ok).length, expectedWins, JSON.stringify(rush));
  assert.ok(rush.filter((r) => !r.ok).every((r) => r.error === 'INSUFFICIENT_FUNDS'));
  assert.equal(await balance(user), after - 15 * expectedWins);
  const rows = ledger(user);
  assert.equal(rows.reduce((sum, r) => sum + r.amount, 0), await balance(user), 'wallet = sum(ledger)');
  assert.ok(rows.every((r) => r.balance_after >= 0));
});

test('the same request retried concurrently is applied once', async () => {
  const user = createUser();
  const key = `economy-test:${user}:credit001`;
  const retries = await Promise.all(Array.from({ length: 8 }, () => credit(user, 25, key)));
  assert.ok(retries.every((r) => r.ok), JSON.stringify(retries));
  assert.equal(retries.filter((r) => r.value.status === 'SUCCESS').length, 1);
  assert.equal(retries.filter((r) => r.value.status === 'ALREADY_PROCESSED').length, 7);
  assert.equal(new Set(retries.map((r) => r.value.transactionId)).size, 1, 'every retry reports the one transaction');
  assert.equal(await balance(user), 25);
  assert.equal(ledger(user).length, 1);

  const debitKey = `economy-test:${user}:debit001`;
  const debits = await Promise.all(Array.from({ length: 5 }, () => debit(user, 10, debitKey)));
  assert.equal(debits.filter((r) => r.ok && r.value.status === 'SUCCESS').length, 1, JSON.stringify(debits));
  assert.equal(await balance(user), 15);
  assert.equal(ledger(user).length, 2);
});

test('balance persists across connections and player sessions', async () => {
  const user = createUser();
  await credit(user, 120, `it:${user}:persist`);
  await debit(user, 20, `it:${user}:persist-spend`);
  // A brand-new server connection reads what an earlier one wrote.
  assert.equal(await balance(user), 100);
  // Two separate player sessions (fresh tokens) read it back through the Data API.
  for (const session of [jwt(user), jwt(user)]) {
    const read = await rest('/rest/v1/rpc/get_my_world_wallet_v1', { token: session, body: {} });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.deepEqual(read.body, { currencies: [{ id: COIN, balance: 100 }] });
  }
});

test('clients cannot write or read other wallets through the Data API', async () => {
  const owner = createUser();
  const other = createUser();
  await credit(owner, 40, `it:${owner}:seed`);
  const token = jwt(other);
  const attempts = [
    ['player credit RPC', '/rest/v1/rpc/world_wallet_credit_v1', { token, body: {
      p_user: other, p_currency_id: COIN, p_amount: 1000, p_type: 'REWARD', p_source_type: 'client',
      p_source_id: 'x', p_idempotency_key: `client:${other}:1` } }],
    ['player debit RPC on another account', '/rest/v1/rpc/world_wallet_debit_v1', { token, body: {
      p_user: owner, p_currency_id: COIN, p_amount: 40, p_type: 'PURCHASE', p_source_type: 'client',
      p_source_id: 'x', p_idempotency_key: `client:${other}:2` } }],
    ['guest credit RPC', '/rest/v1/rpc/world_wallet_credit_v1', { body: {
      p_user: other, p_currency_id: COIN, p_amount: 1000, p_type: 'REWARD', p_source_type: 'client',
      p_source_id: 'x', p_idempotency_key: `client:${other}:3` } }],
    ['player wallet INSERT', '/rest/v1/world_wallets', { token, headers: { 'Content-Profile': 'private' },
      body: { user_id: other, currency_id: COIN, balance: 1000 } }],
    ['player ledger INSERT', '/rest/v1/world_currency_transactions', { token, headers: { 'Content-Profile': 'private' },
      body: { user_id: other, currency_id: COIN, type: 'REWARD', amount: 1000, balance_before: 0, balance_after: 1000,
        source_type: 'client', source_id: 'x', idempotency_key: `client:${other}:4` } }],
    ['player wallet UPDATE', `/rest/v1/world_wallets?user_id=eq.${other}`, { token, method: 'PATCH',
      headers: { 'Content-Profile': 'private' }, body: { balance: 1000 } }],
    ['player wallet DELETE', `/rest/v1/world_wallets?user_id=eq.${owner}`, { token, method: 'DELETE',
      headers: { 'Content-Profile': 'private' } }],
    ['player raw wallet read', `/rest/v1/world_wallets?user_id=eq.${owner}`, { token, method: 'GET',
      headers: { 'Accept-Profile': 'private' } }],
    ['player raw ledger read', `/rest/v1/world_currency_transactions?user_id=eq.${owner}`, { token, method: 'GET',
      headers: { 'Accept-Profile': 'private' } }],
    ['player reads another balance via server API', '/rest/v1/rpc/world_wallet_get_balance_v1', { token, body: {
      p_user: owner, p_currency_id: COIN } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  assert.equal(await balance(owner), 40, 'owner wallet unchanged');
  assert.equal(await balance(other), 0, 'attacker wallet unchanged');
  assert.equal(ledger(other).length, 0);
  const own = await rest('/rest/v1/rpc/get_my_world_wallet_v1', { token, body: {} });
  assert.deepEqual(own.body, { currencies: [{ id: COIN, balance: 0 }] }, 'a player reads only their own wallet');
});

test('account deletion removes the wallet and its ledger', async () => {
  const user = createUser();
  await credit(user, 10, `it:${user}:delete`);
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  assert.equal(sqlSync(`select count(*) from private.world_wallets where user_id = ${lit(user)}`), '0');
  assert.equal(ledger(user).length, 0);
});
