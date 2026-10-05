// Progression / Economy P1f · 캠퍼스 출석부 against the disposable local stack. The player acts only
// through the Data API (PostgREST) with a minted JWT; psql is used for fixtures and ledger reads.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

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
function jwt(sub, { anonymous = false } = {}) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: anonymous,
    session_id: randomUUID(), iat: now, exp: now + 600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
async function rpc(token, fn, body = {}) {
  const response = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the raw text */ }
  return { status: response.status, body: parsed, text };
}
const status = (token) => rpc(token, 'get_my_world_attendance_v1');
const claim = (token) => rpc(token, 'claim_my_world_attendance_v1');
const today = () => sql(`select to_char(private.world_attendance_today_v1(), 'YYYY-MM-DD')`);

const users = [];
function createUser({ anonymous = false, banned = false } = {}) {
  const id = randomUUID();
  sql(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${anonymous ? 'null' : lit(`p1f-${id}@example.test`)}, now(), ${anonymous})`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`a${id.slice(0, 8)}`)}, ${banned})`);
  users.push(id);
  return id;
}
test.after(() => {
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});
const coins = (user) => Number(sql(`select coalesce(sum(balance), 0) from private.world_wallets where user_id = ${lit(user)}`));
const count = (query) => Number(sql(query));
const rows = (user) => count(`select count(*) from private.world_attendance_days where user_id = ${lit(user)}`);
const tx = (user, reward) => count(`select count(*) from private.world_reward_transactions where user_id = ${lit(user)} and reward_id = ${lit(reward)}`);
const ledger = (user) => count(`select count(*) from private.world_currency_transactions where user_id = ${lit(user)}`);
const noSecrets = (body) => assert.doesNotMatch(JSON.stringify(body), /userId|user_id|idempotency|childTransactionId|attempts|grantEntryId/);

test('A: status unclaimed → explicit claim +10 → replay +0', async () => {
  const user = createUser();
  const token = jwt(user);
  const before = await status(token);
  assert.equal(before.status, 200, before.text);
  assert.equal(before.body.rewardDate, today());
  assert.equal(before.body.claimedToday, false);
  assert.equal(before.body.attendedDays, 0);
  assert.deepEqual(before.body.nextMilestone, { days: 3, bonusCoin: 30 });
  assert.equal(rows(user), 0, 'reading never claims');

  const first = await claim(token);
  assert.equal(first.status, 200, first.text);
  noSecrets(first.body);
  assert.deepEqual([first.body.claimed, first.body.replayed, first.body.claimedToday, first.body.attendedDays], [true, false, true, 1]);
  assert.deepEqual(first.body.attendedDates, [today()]);
  assert.equal(first.body.rewards.length, 1);
  assert.equal(first.body.rewards[0].rewardId, 'reward.attendance.daily');
  assert.deepEqual(first.body.rewards[0].entries.map(({ grantType, targetId, granted }) => [grantType, targetId, granted]),
    [['CURRENCY', 'currency.induck_coin', 10]]);
  assert.deepEqual([coins(user), rows(user)], [10, 1]);
  assert.equal(sql(`select idempotency_key from private.world_reward_transactions where user_id = ${lit(user)}`),
    `attendance:daily:${user}:${today()}`);

  const again = await claim(token);
  assert.deepEqual([again.body.claimed, again.body.replayed, again.body.rewards.length, again.body.attendedDays], [false, true, 0, 1]);
  assert.deepEqual([coins(user), rows(user), tx(user, 'reward.attendance.daily')], [10, 1, 1]);
  // The public API has no date parameter.
  const dated = await rpc(token, 'claim_my_world_attendance_v1', { p_date: '2030-01-01' });
  assert.ok(dated.status >= 400, 'no date argument exists');
});

test('B: two earlier days this month → third claim pays daily + milestone 3 (+40)', async (t) => {
  const day = Number(today().slice(8, 10));
  if (day < 3) { t.skip(`KST day ${day}: no two earlier days in this month`); return; }
  const user = createUser();
  const token = jwt(user);
  // Fixture: two earlier attended days this month through the private dated claim (real rewards).
  const month = today().slice(0, 7);
  for (const d of ['01', '02']) sql(`select private.world_attendance_claim_v1(${lit(user)}, ${lit(`${month}-${d}`)})`);
  assert.deepEqual([coins(user), rows(user)], [20, 2]);
  const third = await claim(token);
  assert.equal(third.status, 200, third.text);
  assert.equal(third.body.attendedDays, 3);
  assert.deepEqual(third.body.rewards.map((r) => [r.rewardId, r.entries[0].granted]),
    [['reward.attendance.daily', 10], ['reward.attendance.monthly_3', 30]]);
  assert.deepEqual(third.body.milestones.map((m) => [m.days, m.claimed, m.bonusCoin]),
    [[3, true, 30], [7, false, 50], [14, false, 100], [21, false, 150]]);
  assert.deepEqual(third.body.nextMilestone, { days: 7, bonusCoin: 50 });
  assert.equal(coins(user), 60, '20 + 10 + 30');
  assert.equal(sql(`select idempotency_key from private.world_reward_transactions where user_id = ${lit(user)} and reward_id = 'reward.attendance.monthly_3'`),
    `attendance:monthly:${user}:${month}:3`);
});

test('C: concurrent claim ×8 → one row, one daily reward, one ledger row (and one milestone on a milestone day)', async () => {
  const user = createUser();
  const token = jwt(user);
  const results = await Promise.all(Array.from({ length: 8 }, () => claim(token)));
  assert.ok(results.every((r) => r.status === 200), results.map((r) => r.text).join('\n'));
  assert.equal(results.filter((r) => r.body.claimed).length, 1);
  assert.equal(results.filter((r) => r.body.replayed).length, 7);
  assert.deepEqual([rows(user), tx(user, 'reward.attendance.daily'), ledger(user), coins(user)], [1, 1, 1, 10]);

  const day = Number(today().slice(8, 10));
  if (day >= 3) {
    const other = createUser();
    const month = today().slice(0, 7);
    for (const d of ['01', '02']) sql(`select private.world_attendance_claim_v1(${lit(other)}, ${lit(`${month}-${d}`)})`);
    const burst = await Promise.all(Array.from({ length: 8 }, () => claim(jwt(other))));
    assert.equal(burst.filter((r) => r.body.claimed).length, 1);
    assert.deepEqual([rows(other), tx(other, 'reward.attendance.daily'), tx(other, 'reward.attendance.monthly_3'), coins(other)], [3, 3, 1, 60]);
  }
});

test('accounts and abuse: anonymous / banned / no JWT refused; no table read; no direct Reward', async () => {
  const anonymous = createUser({ anonymous: true });
  assert.ok((await claim(jwt(anonymous, { anonymous: true }))).status >= 400);
  const banned = createUser({ banned: true });
  assert.ok((await claim(jwt(banned))).status >= 400);
  const guest = await fetch(`${API_URL}/rest/v1/rpc/claim_my_world_attendance_v1`, { method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(guest.status >= 400);
  const owner = createUser();
  const read = await fetch(`${API_URL}/rest/v1/world_attendance_days?select=*`, { headers: { apikey: ANON_KEY,
    Authorization: `Bearer ${jwt(owner)}`, 'Accept-Profile': 'private' } });
  assert.ok(read.status >= 400, 'the table is not readable through the Data API');
  const direct = await rpc(jwt(owner), 'world_reward_grant_v1', { p_user: owner, p_reward_id: 'reward.attendance.monthly_21',
    p_source_type: 'SYSTEM', p_source_id: 'attendance.monthly.21', p_idempotency_key: `attendance:monthly:${owner}:2026-09:21` });
  assert.ok(direct.status >= 400);
  const dated = await rpc(jwt(owner), 'world_attendance_claim_v1', { p_user: owner, p_today: '2026-09-01' });
  assert.ok(dated.status >= 400, 'the dated private claim is not exposed');
  assert.deepEqual([coins(owner), rows(owner), coins(anonymous), coins(banned)], [0, 0, 0, 0]);
});

test('D: account deletion cascades the attendance rows', async () => {
  const user = createUser();
  await claim(jwt(user));
  assert.equal(rows(user), 1);
  sql(`delete from auth.users where id = ${lit(user)}`);
  assert.equal(rows(user), 0);
});
