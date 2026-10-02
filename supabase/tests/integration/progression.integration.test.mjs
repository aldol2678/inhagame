// Economy P0-F0 Progression against the disposable local Supabase stack.
// Separate psql connections provide real concurrency; player reads and attack attempts go through PostgREST.
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

const run = promisify(execFile);

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
  try {
    const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`, call);
    return { ok: true, value: JSON.parse(out.split('\n').at(-1)) };
  } catch (error) {
    const match = /ERROR:\s+([A-Z_]+)/.exec(String(error.stderr ?? error.message));
    return { ok: false, error: match ? match[1] : String(error.stderr ?? error.message) };
  }
}
const grant = (user, amount, key, source = 'integration_test') =>
  server('world_exp_grant_v1', [user, amount, source, key, key]);
const progression = async (user) => (await server('world_progression_get_v1', [user])).value;
const ledger = (user) => JSON.parse(sqlSync(`select coalesce(json_agg(t order by t.created_at), '[]')
  from private.world_exp_transactions t where t.user_id = ${lit(user)}`));

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(id)},'authenticated','authenticated',${lit(`progress-${id}@example.test`)},now(),false)`);
  sqlSync(`insert into public.profiles(user_id,nickname,is_banned)
    values (${lit(id)},${lit(`p${id.slice(0,8)}`)},false)`);
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
  try { parsed = text ? JSON.parse(text) : null; } catch { /* raw error */ }
  return { status: response.status, body: parsed };
}

test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(',')})`);
});

test('concurrent +60 and +40 from a fresh account end at exactly 100 / Lv2', async () => {
  const user = createUser();
  const pair = await Promise.all([
    grant(user, 60, `it:${user}:60`),
    grant(user, 40, `it:${user}:40`),
  ]);
  assert.ok(pair.every((r) => r.ok && r.value.status === 'SUCCESS'), JSON.stringify(pair));
  const state = await progression(user);
  assert.equal(state.totalExp, 100);
  assert.equal(state.level, 2);
  const rows = ledger(user).sort((a, b) => a.exp_before - b.exp_before);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].exp_before, 0);
  assert.equal(rows[1].exp_before, rows[0].exp_after);
  assert.equal(rows[1].exp_after, 100);
});

test('20 concurrent +5 grants produce a gapless 0..100 ledger with no lost update', async () => {
  const user = createUser();
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    grant(user, 5, `it:${user}:burst${i}`)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  const state = await progression(user);
  assert.equal(state.totalExp, 100);
  assert.equal(state.level, 2);
  const rows = ledger(user);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map((r) => r.exp_before).sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, i) => i * 5));
});

test('concurrent retries of one idempotency key apply EXP exactly once', async () => {
  const user = createUser();
  const key = `it:${user}:same`;
  const results = await Promise.all(Array.from({ length: 8 }, () => grant(user, 25, key)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(results.filter((r) => r.value.status === 'SUCCESS').length, 1);
  assert.equal(results.filter((r) => r.value.status === 'ALREADY_PROCESSED').length, 7);
  assert.equal(new Set(results.map((r) => r.value.transactionId)).size, 1);
  assert.equal((await progression(user)).totalExp, 25);
  assert.equal(ledger(user).length, 1);
});

test('progression persists across connections and player sessions', async () => {
  const user = createUser();
  await grant(user, 340, `it:${user}:persist`);
  assert.deepEqual(
    { totalExp: (await progression(user)).totalExp, level: (await progression(user)).level },
    { totalExp: 340, level: 3 });

  for (const session of [jwt(user), jwt(user)]) {
    const read = await rest('/rest/v1/rpc/get_my_world_progression_v1', { token: session, body: {} });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.totalExp, 340);
    assert.equal(read.body.level, 3);
    assert.equal(read.body.currentLevelStartExp, 300);
    assert.equal(read.body.nextLevelExp, 600);
  }
});

test('clients cannot forge EXP or inspect another account through Data API', async () => {
  const owner = createUser();
  const other = createUser();
  await grant(owner, 120, `it:${owner}:seed`);
  const token = jwt(other);
  const attempts = [
    ['player grant RPC', '/rest/v1/rpc/world_exp_grant_v1', { token, body: {
      p_user: other, p_amount: 9999, p_source_type: 'client', p_source_id: 'forge',
      p_idempotency_key: `client:${other}:1` } }],
    ['player server read', '/rest/v1/rpc/world_progression_get_v1', { token, body: { p_user: owner } }],
    ['player progression INSERT', '/rest/v1/world_player_progression', { token,
      headers: { 'Content-Profile': 'private' }, body: { user_id: other, total_exp: 9999 } }],
    ['player progression UPDATE', `/rest/v1/world_player_progression?user_id=eq.${other}`, {
      token, method: 'PATCH', headers: { 'Content-Profile': 'private' }, body: { total_exp: 9999 } }],
    ['player raw progression read', `/rest/v1/world_player_progression?user_id=eq.${owner}`, {
      token, method: 'GET', headers: { 'Accept-Profile': 'private' } }],
    ['player raw EXP ledger read', `/rest/v1/world_exp_transactions?user_id=eq.${owner}`, {
      token, method: 'GET', headers: { 'Accept-Profile': 'private' } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  assert.equal((await progression(owner)).totalExp, 120);
  assert.equal((await progression(other)).totalExp, 0);
  const own = await rest('/rest/v1/rpc/get_my_world_progression_v1', { token, body: {} });
  assert.equal(own.status, 200);
  assert.equal(own.body.totalExp, 0, 'player can read only own progression');
});

test('account deletion cascades progression and EXP ledger', async () => {
  const user = createUser();
  await grant(user, 10, `it:${user}:delete`);
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  assert.equal(sqlSync(`select count(*) from private.world_player_progression where user_id = ${lit(user)}`), '0');
  assert.equal(ledger(user).length, 0);
});
