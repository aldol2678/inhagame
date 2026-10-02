// Progression / Economy P1e · Campus Daily Quiz against the disposable local stack. The player acts
// only through the Data API (PostgREST) with a minted JWT: start → 3 answers → server scoring →
// Reward core → Wallet / EXP ledgers. The question bank is read with psql only to know which option
// is right (the player API never returns it).
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
const start = (token) => rpc(token, 'start_my_world_daily_quiz_v1');
const state = (token) => rpc(token, 'get_my_world_daily_quiz_v1');
const answer = (token, runId, questionId, index) => rpc(token, 'answer_my_world_daily_quiz_v1',
  { p_run_id: runId, p_question_id: questionId, p_answer_index: index });
const correctOf = (questionId) => Number(sql(`select correct_index from private.world_daily_quiz_questions where question_id = ${lit(questionId)}`));
const wrongOf = (questionId) => (correctOf(questionId) + 1) % 4;

const users = [];
function createUser({ anonymous = false, banned = false, exp = 0 } = {}) {
  const id = randomUUID();
  sql(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${anonymous ? 'null' : lit(`p1e-${id}@example.test`)}, now(), ${anonymous})`);
  sql(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`q${id.slice(0, 8)}`)}, ${banned})`);
  if (exp) sql(`select private.world_exp_apply_v1(${lit(id)}, ${exp}, 'qa', 'p1e.fixture', ${lit(`p1e:fixture:${id}`)})`);
  users.push(id);
  return id;
}
test.after(() => {
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});
const coins = (user) => Number(sql(`select coalesce(sum(balance), 0) from private.world_wallets where user_id = ${lit(user)}`));
const progress = (user) => sql(`select (s->>'totalExp') || '/Lv.' || (s->>'level') from private.world_progression_snapshot_v1(${lit(user)}) s`);
const count = (query) => Number(sql(query));
const quizTx = (user) => count(`select count(*) from private.world_reward_transactions where user_id = ${lit(user)} and reward_id = 'reward.daily.campus_quiz'`);
const coinRows = (user) => count(`select count(*) from private.world_currency_transactions where user_id = ${lit(user)}`);
const rewardExpRows = (user) => count(`select count(*) from private.world_exp_transactions where user_id = ${lit(user)} and source_type = 'reward'`);
const runs = (user) => count(`select count(*) from private.world_daily_quiz_runs where user_id = ${lit(user)}`);
const answers = (user) => count(`select count(*) from private.world_daily_quiz_answers a join private.world_daily_quiz_runs r using (run_id) where r.user_id = ${lit(user)}`);
const noSecrets = (body) => assert.doesNotMatch(JSON.stringify(body), /correctIndex|correct_index|idempotency|userId|user_id/);

test('onboarded account: start → 3 answers (2 correct) → PASSED → +50 coin, 200 → 225 EXP', async () => {
  const user = createUser({ exp: 200 });
  const token = jwt(user);
  const before = await state(token);
  assert.equal(before.status, 200);
  assert.equal(before.body.status, 'AVAILABLE');
  assert.deepEqual(before.body.rewardPreview.map(({ grantType, amount }) => [grantType, amount]), [['CURRENCY', 50], ['EXP', 25]]);

  let s = (await start(token)).body;
  assert.equal(s.status, 'ACTIVE');
  assert.equal(s.question.options.length, 4);
  noSecrets(s);
  const seen = [];
  for (const [n, ok] of [[1, true], [2, false], [3, true]]) {
    const q = s.question;
    seen.push(q.questionId);
    const r = await answer(token, s.runId, q.questionId, ok ? correctOf(q.questionId) : wrongOf(q.questionId));
    assert.equal(r.status, 200, r.text);
    s = r.body;
    noSecrets(s);
    assert.equal(s.lastAnswer.correct, ok);
    assert.equal(s.progress.answered, n);
    if (n < 3) assert.equal('reward' in s, false, 'no reward before the last answer');
  }
  assert.equal(new Set(seen).size, 3, 'three distinct questions');
  assert.equal(s.status, 'PASSED');
  assert.equal(s.reward.rewardId, 'reward.daily.campus_quiz');
  assert.equal(s.reward.status, 'SUCCESS');
  assert.deepEqual(s.reward.entries.map(({ grantType, targetId, granted }) => [grantType, targetId, granted]),
    [['CURRENCY', 'currency.induck_coin', 50], ['EXP', 'exp.campus', 25]]);
  assert.deepEqual([coins(user), progress(user), quizTx(user), coinRows(user), rewardExpRows(user)], [50, '225/Lv.2', 1, 1, 1]);
  const today = sql(`select to_char(private.world_daily_quiz_today_v1(), 'YYYY-MM-DD')`);
  assert.equal(s.rewardDate, today);
  assert.equal(sql(`select idempotency_key from private.world_reward_transactions where user_id = ${lit(user)} and reward_id = 'reward.daily.campus_quiz'`),
    `daily:campus_quiz:${user}:${today}`);

  // Refresh / replay: PASSED, no question, no reward, no new run; answering again is refused.
  const again = await start(token);
  assert.equal(again.body.status, 'PASSED');
  assert.equal('reward' in again.body, false);
  assert.equal((await answer(token, s.runId, seen[2], 0)).status >= 400, true);
  assert.deepEqual([coins(user), progress(user), quizTx(user), runs(user)], [50, '225/Lv.2', 1, 1]);
});

test('1/3 correct → FAILED: no reward call, no retry the same day', async () => {
  const user = createUser();
  const token = jwt(user);
  let s = (await start(token)).body;
  for (const ok of [true, false, false]) s = (await answer(token, s.runId, s.question.questionId,
    ok ? correctOf(s.question.questionId) : wrongOf(s.question.questionId))).body;
  assert.equal(s.status, 'FAILED');
  assert.equal('reward' in s, false);
  assert.equal((await start(token)).body.status, 'FAILED');
  assert.deepEqual([coins(user), progress(user), quizTx(user), runs(user)], [0, '0/Lv.1', 0, 1]);
});

test('accounts and abuse: anonymous / banned refused, no bank read, no direct reward, no foreign run', async () => {
  const anonymous = createUser({ anonymous: true });
  assert.ok((await start(jwt(anonymous, { anonymous: true }))).status >= 400, 'anonymous refused');
  const banned = createUser({ banned: true });
  assert.ok((await start(jwt(banned))).status >= 400, 'banned refused');
  const guest = await fetch(`${API_URL}/rest/v1/rpc/start_my_world_daily_quiz_v1`, { method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(guest.status >= 400, 'no JWT refused');

  const owner = createUser();
  const other = createUser();
  const s = (await start(jwt(owner))).body;
  const foreign = await answer(jwt(other), s.runId, s.question.questionId, 0);
  assert.ok(foreign.status >= 400);
  assert.match(foreign.text, /QUIZ_RUN_NOT_FOUND/);
  for (const [path, profile] of [['world_daily_quiz_questions', 'private'], ['world_daily_quiz_runs', 'private']]) {
    const read = await fetch(`${API_URL}/rest/v1/${path}?select=*`, { headers: { apikey: ANON_KEY,
      Authorization: `Bearer ${jwt(owner)}`, 'Accept-Profile': profile } });
    assert.ok(read.status >= 400, `${path} is not readable through the Data API`);
  }
  const direct = await rpc(jwt(owner), 'world_reward_grant_v1', { p_user: owner, p_reward_id: 'reward.daily.campus_quiz',
    p_source_type: 'MINIGAME', p_source_id: 'daily.campus_quiz', p_idempotency_key: `daily:campus_quiz:${owner}:2026-09-29` });
  assert.ok(direct.status >= 400, 'the Reward core is not exposed to players');
  // The public API takes no date: an extra date argument does not resolve to any function.
  const dated = await rpc(jwt(owner), 'start_my_world_daily_quiz_v1', { p_date: '2030-01-01' });
  assert.ok(dated.status >= 400, 'no date parameter exists');
  assert.deepEqual([coins(owner), coins(other), quizTx(owner), runs(owner), runs(other)], [0, 0, 0, 1, 0]);
});

test('concurrency: start ×8 → 1 run; same answer ×8 → 1 row; final correct ×8 → 1 PASS, 1 reward', async () => {
  const user = createUser();
  const token = jwt(user);
  const starts = await Promise.all(Array.from({ length: 8 }, () => start(token)));
  assert.ok(starts.every((r) => r.status === 200), JSON.stringify(starts.map((r) => r.text)));
  assert.equal(new Set(starts.map((r) => r.body.runId)).size, 1);
  assert.equal(runs(user), 1);

  let s = starts[0].body;
  const first = await Promise.all(Array.from({ length: 8 }, () =>
    answer(token, s.runId, s.question.questionId, correctOf(s.question.questionId))));
  assert.equal(first.filter((r) => r.status === 200).length, 1, first.map((r) => r.text).join('\n'));
  assert.ok(first.filter((r) => r.status !== 200).every((r) => /QUIZ_ALREADY_ANSWERED/.test(r.text)));
  assert.equal(answers(user), 1);

  s = first.find((r) => r.status === 200).body;
  s = (await answer(token, s.runId, s.question.questionId, correctOf(s.question.questionId))).body;
  const finals = await Promise.all(Array.from({ length: 8 }, () =>
    answer(token, s.runId, s.question.questionId, correctOf(s.question.questionId))));
  const winners = finals.filter((r) => r.status === 200);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].body.status, 'PASSED');
  assert.equal(finals.filter((r) => r.body?.reward).length, 1);
  assert.deepEqual([answers(user), quizTx(user), coinRows(user), rewardExpRows(user), coins(user), progress(user)],
    [3, 1, 1, 1, 50, '25/Lv.1']);
});
