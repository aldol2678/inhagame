// MCM 2026 P0-E0 completion authority and P0-E reward claims against the disposable local Supabase
// stack. The player acts through the Data API (PostgREST) with minted JWTs; the trusted server
// adapter is a service-role call on its own connection. The event window is opened around real time
// for this file and the canonical window is restored afterwards.
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
const EVENT = 'event.mcm_2026';
const INVESTIGATIONS = ['investigate_staggering', 'investigate_dancing', 'investigate_hungry'];

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

/** The trusted server adapter: service role, fresh connection. */
async function adapter(user, action) {
  const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`,
    `select public.advance_mcm_2026_event_v1(${lit(user)}, ${lit(action)})::text`);
  return JSON.parse(out.split('\n').at(-1));
}
const survivorOf = (runId) => sqlSync(`select survivor_actor_id from private.world_landlord_runs where run_id = ${lit(runId)}`);
const wrongFor = (runId) => (survivorOf(runId) === 'ZUE-MG-001' ? 'ZUE-MG-002' : 'ZUE-MG-001');
const count = (table, user, extra = '') => Number(sqlSync(`select count(*) from private.${table} where user_id = ${lit(user)} ${extra}`));

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`mcm-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`m${id.slice(0, 8)}`)}, false)`);
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
  return { status: response.status, body: parsed, text };
}
const myEvent = async (token) => (await rest('/rest/v1/rpc/get_my_mcm_2026_event_v1', { token, body: {} })).body;
const startRun = (token) => rest('/rest/v1/rpc/start_mcm_landlord_run_v1', { token, body: {} });
const submit = (token, runId, actorId) => rest('/rest/v1/rpc/submit_mcm_landlord_choice_v1', { token,
  body: { p_run_id: runId, p_actor_id: actorId } });

let original;
test.before(() => {
  original = sqlSync(`select starts_at || '|' || ends_at || '|' || is_disabled from private.world_events where event_id = ${lit(EVENT)}`);
  sqlSync(`update private.world_events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour',
    is_disabled = false where event_id = ${lit(EVENT)}`);
});
test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
  const [startsAt, endsAt, disabled] = original.split('|');
  sqlSync(`update private.world_events set starts_at = ${lit(startsAt)}, ends_at = ${lit(endsAt)}, is_disabled = ${lit(disabled)}
    where event_id = ${lit(EVENT)}`);
});

test('the event window comes from the server clock', async () => {
  const token = jwt(createUser());
  const state = await myEvent(token);
  assert.equal(state.eventId, EVENT);
  assert.equal(state.eventState, 'ACTIVE');
  assert.ok(Date.parse(state.serverNow) >= Date.parse(state.startsAt) && Date.parse(state.serverNow) < Date.parse(state.endsAt));
  const guest = await rest('/rest/v1/rpc/get_my_mcm_2026_event_v1', { body: {} });
  assert.ok(guest.status >= 400, 'guests have no event state');
});

test('full path: adapter progress + server-judged run -> COMPLETED, identical across sessions and connections', async () => {
  const user = createUser();
  assert.equal((await adapter(user, 'start')).progress.stage, 'STARTED');
  for (const action of INVESTIGATIONS) await adapter(user, action);
  assert.equal((await adapter(user, 'status')).progress.stage, 'VENUE_UNLOCKED');

  const token = jwt(user);
  const started = await startRun(token);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.ok(!/survivor/i.test(started.text), 'the start response never names the survivor');
  const cleared = await submit(token, started.body.runId, survivorOf(started.body.runId));
  assert.deepEqual([cleared.body.status, cleared.body.correct, cleared.body.firstClear], ['CLEARED', true, true]);

  const first = await myEvent(jwt(user));
  const second = await myEvent(jwt(user));
  assert.equal(first.progress.stage, 'COMPLETED');
  assert.deepEqual(second.progress, first.progress, 'a new session restores the same completion');
  assert.equal(second.landlord.firstClearedAt, first.landlord.firstClearedAt);
  const stored = sqlSync(`select to_json(completed_at) from private.world_event_progress where user_id = ${lit(user)}`);
  assert.equal(Date.parse(JSON.parse(stored)), Date.parse(first.progress.completedAt), 'a fresh connection agrees');
});

test('8 concurrent correct submissions produce one clear', async () => {
  const user = createUser();
  const token = jwt(user);
  const { body } = await startRun(token);
  const right = survivorOf(body.runId);
  const results = await Promise.all(Array.from({ length: 8 }, () => submit(jwt(user), body.runId, right)));
  assert.ok(results.every((r) => r.status === 200 && r.body.status === 'CLEARED'), JSON.stringify(results.map((r) => r.body)));
  assert.equal(results.filter((r) => r.body.firstClear).length, 1, 'exactly one first clear');
  assert.equal(count('world_landlord_first_clears', user), 1);
  assert.equal(new Set(results.map((r) => r.body.firstClearedAt)).size, 1, 'every caller sees the same clear time');
});

test('8 concurrent starts share one active run', async () => {
  const user = createUser();
  const results = await Promise.all(Array.from({ length: 8 }, () => startRun(jwt(user))));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)));
  assert.equal(new Set(results.map((r) => r.body.runId)).size, 1);
  assert.equal(results.filter((r) => r.body.resumed === false).length, 1);
  assert.equal(count('world_landlord_runs', user, `and status = 'ACTIVE'`), 1);
});

test('concurrent adapter interactions unlock the venue exactly once', async () => {
  const user = createUser();
  await adapter(user, 'start');
  await Promise.all(Array.from({ length: 12 }, (_, i) => adapter(user, INVESTIGATIONS[i % 3])));
  const state = await adapter(user, 'status');
  assert.deepEqual([state.progress.stage, state.progress.investigated], ['VENUE_UNLOCKED', ['dancing', 'hungry', 'staggering']]);
});

test('wrong choices cost 5 server seconds; an expired run fails even with the right answer', async () => {
  const user = createUser();
  const token = jwt(user);
  const { body } = await startRun(token);
  const wrong = await submit(token, body.runId, wrongFor(body.runId));
  assert.deepEqual([wrong.body.status, wrong.body.correct, wrong.body.wrongCount], ['ACTIVE', false, 1]);
  assert.equal(Date.parse(body.deadlineAt) - Date.parse(wrong.body.deadlineAt), 5000);

  sqlSync(`update private.world_landlord_runs set deadline_at = now() - interval '1 second' where run_id = ${lit(body.runId)}`);
  const late = await submit(token, body.runId, survivorOf(body.runId));
  assert.deepEqual([late.body.status, late.body.firstClear], ['FAILED', false]);
  assert.equal(count('world_landlord_first_clears', user), 0);
  const retry = await startRun(token);
  assert.deepEqual([retry.body.resumed, retry.body.runId === body.runId], [false, false], 'a failed run is retried with a new run');
});

test('clients cannot advance, forge, or play another account', async () => {
  const owner = createUser();
  const other = createUser();
  const ownerToken = jwt(owner);
  const otherToken = jwt(other);
  const { body } = await startRun(ownerToken);
  const attempts = [
    ['player advances itself', '/rest/v1/rpc/advance_mcm_2026_event_v1', { token: otherToken, body: { p_user: other, p_event: 'start' } }],
    ['guest starts a run', '/rest/v1/rpc/start_mcm_landlord_run_v1', { body: {} }],
    ['player writes COMPLETED', '/rest/v1/world_event_progress', { token: otherToken, headers: { 'Content-Profile': 'private' },
      body: { user_id: other, event_id: EVENT, stage: 3, investigated: ['staggering', 'dancing', 'hungry'],
        venue_unlocked_at: new Date().toISOString(), completed_at: new Date().toISOString() } }],
    ['player forges a clear', '/rest/v1/world_landlord_first_clears', { token: otherToken, headers: { 'Content-Profile': 'private' },
      body: { user_id: other, event_id: EVENT, run_id: body.runId } }],
    ['player reads survivors', '/rest/v1/world_landlord_runs', { token: otherToken, method: 'GET', headers: { 'Accept-Profile': 'private' } }],
    ['player moves the window', '/rest/v1/world_events', { token: otherToken, method: 'PATCH', headers: { 'Content-Profile': 'private' },
      body: { starts_at: '2020-01-01T00:00:00Z' } }],
    ['player plays another run', '/rest/v1/rpc/submit_mcm_landlord_choice_v1', { token: otherToken, body: {
      p_run_id: body.runId, p_actor_id: survivorOf(body.runId) } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${response.text}`);
  }
  assert.equal(count('world_landlord_first_clears', owner), 0, 'the owner run was not cleared by someone else');
  const forged = await rest('/rest/v1/rpc/save_my_game_progress', { token: otherToken, body: {
    p_game_slug: 'inha-duck', p_progress: { events: { [EVENT]: { status: 'COMPLETED' } } } } });
  assert.equal(forged.status, 200, 'arbitrary game JSON can still be saved');
  assert.equal((await myEvent(otherToken)).progress.stage, 'NOT_STARTED', 'but it is not completion');
  assert.equal(count('world_reward_transactions', owner) + count('world_player_items', owner), 0, 'no reward side effects');
});

test('account deletion removes progress, runs and clears', async () => {
  const user = createUser();
  await adapter(user, 'start');
  const { body } = await startRun(jwt(user));
  await submit(jwt(user), body.runId, survivorOf(body.runId));
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  for (const table of ['world_event_progress', 'world_landlord_runs', 'world_landlord_first_clears']) {
    assert.equal(count(table, user), 0, table);
  }
});

// ---- MCM 2026 P0-E: verified completion → reward claim (20260927160000) ----
// Kept in this file so the event-window changes below never race the completion tests above
// (node --test runs files in parallel; tests in one file run in order).
const COIN = 'currency.induck_coin';
const MAIN_REWARD = 'reward.event.mcm_2026_main_clear';
const claimMain = (token) => rest('/rest/v1/rpc/claim_my_mcm_2026_main_reward_v1', { token, body: {} });
const claimLandlord = (token) => rest('/rest/v1/rpc/claim_my_mcm_landlord_first_clear_reward_v1', { token, body: {} });
const coin = (user) => Number(sqlSync(`select coalesce((select balance from private.world_wallets
  where user_id = ${lit(user)} and currency_id = ${lit(COIN)}), 0)`));
async function completeMcm(user) {
  await adapter(user, 'start');
  for (const action of INVESTIGATIONS) await adapter(user, action);
  const token = jwt(user);
  const { body } = await startRun(token);
  await submit(token, body.runId, survivorOf(body.runId));
  assert.equal((await myEvent(token)).progress.stage, 'COMPLETED');
}

test('P0-E: main and landlord claims pay once and read back identically in new sessions and connections', async () => {
  const user = createUser();
  await completeMcm(user);
  const main = await claimMain(jwt(user));
  assert.equal(main.status, 200, main.text);
  assert.deepEqual([main.body.claimType, main.body.status, main.body.replayed, main.body.rewardId, main.body.rewardStatus],
    ['MAIN_CLEAR', 'CLAIMED', false, MAIN_REWARD, 'SUCCESS']);
  assert.deepEqual(main.body.rewardResult.entries.map((e) => [e.targetId, e.status, e.granted]),
    [[COIN, 'GRANTED', 80], ['top.mcm_2026_survivor', 'GRANTED', 1], ['furniture.mcm_2026_poster', 'GRANTED', 1],
      ['exp.campus', 'GRANTED', 150]]);
  assert.ok(!/userId|idempotencyKey|childTransactionId/.test(main.text), 'no server-only fields in the player result');
  const landlord = await claimLandlord(jwt(user));
  assert.deepEqual([landlord.body.status, landlord.body.rewardStatus, landlord.body.rewardResult.entries[0].targetId],
    ['CLAIMED', 'SUCCESS', 'badge.mcm_2026_landlord']);

  for (const token of [jwt(user), jwt(user)]) {
    assert.equal((await myEvent(token)).progress.stage, 'COMPLETED', 'COMPLETED stays COMPLETED after claiming');
    const again = (await claimMain(token)).body;
    assert.deepEqual([again.status, again.replayed, again.rewardTransactionId, again.claimedAt],
      ['ALREADY_CLAIMED', true, main.body.rewardTransactionId, main.body.claimedAt]);
    assert.equal((await claimLandlord(token)).body.status, 'ALREADY_CLAIMED');
    const wallet = await rest('/rest/v1/rpc/get_my_world_wallet_v1', { token, body: {} });
    assert.deepEqual(wallet.body, { currencies: [{ id: COIN, balance: 80 }] });
    const inventory = (await rest('/rest/v1/rpc/get_my_world_inventory_v1', { token, body: {} })).body.items;
    assert.deepEqual(inventory.map((i) => i.itemId).sort(),
      ['badge.mcm_2026_landlord', 'furniture.mcm_2026_poster', 'top.mcm_2026_survivor']);
    const poster = inventory.find((i) => i.itemId === 'furniture.mcm_2026_poster');
    assert.deepEqual([poster.sourceType, poster.sourceRef, poster.eventId], ['EVENT', MAIN_REWARD, EVENT]);
  }
  assert.equal(coin(user), 80, 'a fresh server connection agrees');
  const claims = JSON.parse(sqlSync(`select json_agg(json_build_object('type', c.claim_type, 'status', c.reward_status,
      'tx', c.reward_transaction_id, 'key', c.idempotency_key) order by c.claim_type)
    from private.world_mcm_reward_claims c where c.user_id = ${lit(user)}`));
  assert.deepEqual(claims.map((c) => [c.type, c.status, c.key]), [
    ['LANDLORD_FIRST_CLEAR', 'SUCCESS', `minigame:landlord:${user}:first_clear`],
    ['MAIN_CLEAR', 'SUCCESS', `event:mcm_2026:${user}:main_clear`]]);
  assert.equal(claims[1].tx, main.body.rewardTransactionId);
  assert.deepEqual([count('world_reward_transactions', user), count('world_currency_transactions', user),
    count('world_item_grants', user)], [2, 1, 3]);
});

test('P0-E: 8 concurrent main claims and 8 concurrent landlord claims each pay exactly once', async () => {
  const user = createUser();
  await completeMcm(user);
  const mains = await Promise.all(Array.from({ length: 8 }, () => claimMain(jwt(user))));
  assert.ok(mains.every((r) => r.status === 200), JSON.stringify(mains.filter((r) => r.status !== 200).map((r) => r.text)));
  assert.equal(mains.filter((r) => r.body.status === 'CLAIMED').length, 1, 'one claim executes');
  assert.equal(mains.filter((r) => r.body.status === 'ALREADY_CLAIMED').length, 7, 'the rest read the final claim');
  assert.equal(new Set(mains.map((r) => r.body.rewardTransactionId)).size, 1, 'one reward transaction');
  const lands = await Promise.all(Array.from({ length: 8 }, () => claimLandlord(jwt(user))));
  assert.ok(lands.every((r) => r.status === 200), JSON.stringify(lands.filter((r) => r.status !== 200).map((r) => r.text)));
  assert.equal(lands.filter((r) => r.body.status === 'CLAIMED').length, 1);
  assert.equal(new Set(lands.map((r) => r.body.rewardTransactionId)).size, 1);
  assert.equal(coin(user), 80, '+80 exactly once');
  assert.deepEqual([count('world_reward_transactions', user), count('world_currency_transactions', user),
    count('world_item_grants', user), count('world_player_items', user), count('world_mcm_reward_claims', user)],
  [2, 1, 3, 3, 2], 'each item at most once, one final claim per type');
});

test('P0-E: a crash mid-claim leaves nothing; a reward whose claim was lost is recovered without paying twice', async () => {
  const crashed = createUser();
  await completeMcm(crashed);
  const app = `p0e_crash_${crashed.slice(0, 8)}`;
  const claims = JSON.stringify({ role: 'authenticated', sub: crashed, is_anonymous: false });
  const doomed = psql(`set application_name = '${app}'`, 'set role authenticated', `set request.jwt.claims = '${claims}'`,
    'begin', 'select public.claim_my_mcm_2026_main_reward_v1()', 'select pg_sleep(10)', 'commit');
  let killed = false;
  for (let i = 0; i < 100 && !killed; i += 1) {
    killed = sqlSync(`select coalesce(bool_or(pg_terminate_backend(pid)), false) from pg_stat_activity
      where application_name = '${app}' and query like '%pg_sleep%' and state = 'active'`) === 't';
    if (!killed) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(killed, 'the backend running the claim was terminated');
  await assert.rejects(doomed, 'the crashed session never committed');
  assert.deepEqual([count('world_reward_transactions', crashed), count('world_mcm_reward_claims', crashed), coin(crashed)],
    [0, 0, 0], 'no reward, claim or coin survived the crash');
  const retry = (await claimMain(jwt(crashed))).body;
  assert.deepEqual([retry.status, retry.replayed], ['CLAIMED', false]);
  assert.equal(coin(crashed), 80);

  // The reward committed through the server path, but the claim was never finalized.
  const lost = createUser();
  await completeMcm(lost);
  const key = `event:mcm_2026:${lost}:main_clear`;
  const paid = JSON.parse((await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`,
    `select public.world_reward_grant_v1(${lit(lost)}, ${lit(MAIN_REWARD)}, 'EVENT', 'event.mcm_2026:main_clear', ${lit(key)})::text`))
    .split('\n').at(-1));
  assert.equal(paid.status, 'SUCCESS');
  assert.deepEqual([coin(lost), count('world_mcm_reward_claims', lost)], [80, 0], 'reward exists, claim missing');
  const recovered = await Promise.all(Array.from({ length: 4 }, () => claimMain(jwt(lost))));
  assert.ok(recovered.every((r) => r.status === 200 && r.body.rewardTransactionId === paid.rewardTransactionId),
    JSON.stringify(recovered.map((r) => r.text)));
  const claimed = recovered.filter((r) => r.body.status === 'CLAIMED');
  assert.equal(claimed.length, 1, 'one call finalizes, the rest read the final claim');
  assert.deepEqual([claimed[0].body.replayed, claimed[0].body.rewardStatus], [true, 'SUCCESS'],
    'the stored P0-C result finalizes the claim');
  assert.deepEqual([coin(lost), count('world_currency_transactions', lost), count('world_item_grants', lost),
    count('world_reward_transactions', lost), count('world_mcm_reward_claims', lost)], [80, 1, 2, 1, 1],
  'recovery moved no value');
});

test('P0-E: completions earned before the end stay claimable after it; nothing new can be earned', async () => {
  const early = createUser();
  const late = createUser();
  await completeMcm(early);
  await adapter(late, 'start');
  const completedAt = sqlSync(`select completed_at from private.world_event_progress where user_id = ${lit(early)}`);
  try {
    sqlSync(`update private.world_events set starts_at = now() - interval '3 hours', ends_at = now()
      where event_id = ${lit(EVENT)}`);
    const endsAt = sqlSync(`select ends_at from private.world_events where event_id = ${lit(EVENT)}`);
    assert.ok(Date.parse(completedAt) < Date.parse(endsAt), 'completed while ACTIVE');
    assert.equal((await myEvent(jwt(early))).eventState, 'ENDED');
    await assert.rejects(adapter(late, 'investigate_hungry'), /EVENT_NOT_ACTIVE/, 'no new progress after the end');
    assert.ok((await startRun(jwt(late))).status >= 400, 'no new run after the end');
    assert.equal((await claimMain(jwt(late))).body.message, 'CLAIM_NOT_ELIGIBLE');
    assert.deepEqual([(await claimMain(jwt(early))).body.status, (await claimLandlord(jwt(early))).body.status],
      ['CLAIMED', 'CLAIMED']);
    assert.equal((await claimMain(jwt(early))).body.status, 'ALREADY_CLAIMED');
    assert.equal(coin(early), 80);
  } finally {
    sqlSync(`update private.world_events set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour'
      where event_id = ${lit(EVENT)}`);
  }
});

test('P0-E: clients cannot claim without completion, for someone else, or with overrides', async () => {
  const owner = createUser();
  const other = createUser();
  await completeMcm(owner);
  const otherToken = jwt(other);
  await rest('/rest/v1/rpc/save_my_game_progress', { token: otherToken, body: {
    p_game_slug: 'inha-duck', p_progress: { events: { [EVENT]: { status: 'COMPLETED', landlordFirstClear: true } } } } });
  for (const claim of [claimMain, claimLandlord]) {
    const refused = await claim(otherToken);
    assert.deepEqual([refused.status >= 400, refused.body.message], [true, 'CLAIM_NOT_ELIGIBLE'], 'local JSON is not completion');
    assert.ok((await claim(undefined)).status >= 400, 'signed out: refused');
  }
  for (const body of [{ p_user: owner }, { p_reward_id: MAIN_REWARD }, { p_amount: 80, p_item_id: 'top.mcm_2026_survivor' },
    { p_currency_id: COIN, p_quantity: 99 }]) {
    const forged = await rest('/rest/v1/rpc/claim_my_mcm_2026_main_reward_v1', { token: otherToken, body });
    assert.ok(forged.status >= 400, `override ${JSON.stringify(body)} has no entry point`);
  }
  const write = await rest('/rest/v1/world_mcm_reward_claims', { token: otherToken, body: { user_id: other, claim_type: 'MAIN_CLEAR' } });
  assert.ok(write.status >= 400, 'claims are not exposed');
  const direct = await rest('/rest/v1/rpc/world_reward_grant_v1', { token: otherToken, body: { p_user: other,
    p_reward_id: MAIN_REWARD, p_source_type: 'EVENT', p_source_id: 'x', p_idempotency_key: `event:mcm_2026:${other}:main_clear` } });
  assert.ok(direct.status >= 400, 'the reward cannot be run from the browser');
  assert.deepEqual([count('world_reward_transactions', other), count('world_mcm_reward_claims', other), coin(other),
    count('world_reward_transactions', owner)], [0, 0, 0, 0], 'nothing paid, and the owner was not claimed for');
});

test('P0-E: account deletion removes claims with the reward they finalized', async () => {
  const user = createUser();
  await completeMcm(user);
  assert.equal((await claimMain(jwt(user))).body.status, 'CLAIMED');
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  for (const table of ['world_mcm_reward_claims', 'world_reward_transactions', 'world_event_progress', 'world_wallets']) {
    assert.equal(count(table, user), 0, table);
  }
});

// ---- Progression Content P1b: the first production EXP through the real player claims ----
const progression = async (token) => (await rest('/rest/v1/rpc/get_my_world_progression_v1', { token, body: {} })).body;
const expRows = (user) => count('world_exp_transactions', user);
/** first_campus has no player-facing claim yet (P1c): the trusted service-role Reward call runs it. */
async function firstCampus(user) {
  const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`,
    `select public.world_reward_grant_v1(${lit(user)}, 'reward.quest.first_campus', 'QUEST', 'quest.first_campus',
      ${lit(`grant:quest.first_campus:${user}`)})::text`);
  return JSON.parse(out.split('\n').at(-1));
}
/** "itemId=reason" for the Lv.2 / Lv.3 offers of both shops ('' = purchasable), as the player sees them. */
async function gatedOffers(token) {
  const offers = [];
  for (const shopId of ['shop.student_center', 'shop.dorm_furniture']) {
    const shop = await rest('/rest/v1/rpc/get_world_shop_v1', { token, body: { p_shop_id: shopId } });
    assert.equal(shop.status, 200, shop.text);
    offers.push(...shop.body.offers.filter((o) => o.requiredLevel === 2 || o.requiredLevel === 3));
  }
  return Object.fromEntries(offers.map((o) => [o.itemId, o.unavailableReason ?? '']).sort());
}
const LV2 = ['furniture.campus_map_poster', 'furniture.dorm_desk_lamp', 'shoes.campus_sneakers', 'top.induck_hoodie'];
const LV3 = ['back.induck_backpack', 'furniture.campus_rug_blue', 'furniture.induck_chair'];
const expOf = (result) => result.rewardResult.entries.filter((e) => e.grantType === 'EXP').map((e) => [e.targetId, e.status, e.granted]);

test('P1b: 0 → first_campus 100 (Lv.2) → landlord 150 (Lv.2) → main 300 (Lv.3) unlocks the Shop tiers', async () => {
  const user = createUser();
  const token = jwt(user);
  const fresh = await progression(token);
  assert.deepEqual([fresh.totalExp, fresh.level], [0, 1]);
  const lv1 = await gatedOffers(token);
  assert.ok([...LV2, ...LV3].every((id) => lv1[id] === 'LEVEL_REQUIRED'), JSON.stringify(lv1));

  const first = await firstCampus(user);
  assert.deepEqual([first.status, first.rewardVersion], ['SUCCESS', 2]);
  assert.deepEqual(first.entries.map((e) => [e.grantEntryId, e.status, e.granted]),
    [['item.badge.main_gate', 'GRANTED', 1], ['exp.campus', 'GRANTED', 100]]);
  const p100 = await progression(token);
  assert.deepEqual([p100.totalExp, p100.level], [100, 2]);
  const lv2 = await gatedOffers(token);
  assert.ok(LV2.every((id) => lv2[id] === ''), `Lv.2 offers unlock ${JSON.stringify(lv2)}`);
  assert.ok(LV3.every((id) => lv2[id] === 'LEVEL_REQUIRED'), 'Lv.3 offers stay locked');

  await completeMcm(user);
  const landlord = (await claimLandlord(token)).body;
  assert.deepEqual([landlord.status, ...expOf(landlord)], ['CLAIMED', ['exp.campus', 'GRANTED', 50]]);
  const p150 = await progression(token);
  assert.deepEqual([p150.totalExp, p150.level], [150, 2]);

  const main = (await claimMain(token)).body;
  assert.deepEqual([main.status, ...expOf(main)], ['CLAIMED', ['exp.campus', 'GRANTED', 150]]);
  const p300 = await progression(jwt(user));
  assert.deepEqual([p300.totalExp, p300.level, p300.nextLevelExp], [300, 3, 600]);
  const lv3 = await gatedOffers(token);
  assert.ok([...LV2, ...LV3].every((id) => lv3[id] === ''), `Lv.2 and Lv.3 offers unlock ${JSON.stringify(lv3)}`);

  // Replays: stored results, no EXP, no Shop change.
  assert.deepEqual([(await claimLandlord(token)).body.status, (await claimMain(token)).body.status], ['ALREADY_CLAIMED', 'ALREADY_CLAIMED']);
  assert.equal((await firstCampus(user)).replayed, true);
  const after = await progression(jwt(user));
  assert.deepEqual([after.totalExp, after.level, expRows(user)], [300, 3, 3]);
  assert.deepEqual(await gatedOffers(token), lv3);
  assert.deepEqual([coin(user), count('world_currency_transactions', user), count('world_item_grants', user)], [80, 1, 4],
    'wallet and inventory grants are the unchanged ones');
});

test('P1b: order independence — main, landlord, first_campus = 300 / Lv.3; landlord alone = 50 / Lv.1', async () => {
  const user = createUser();
  const token = jwt(user);
  await completeMcm(user);
  await claimMain(token);
  const p150 = await progression(token);
  assert.deepEqual([p150.totalExp, p150.level], [150, 2]);
  await claimLandlord(token);
  await firstCampus(user);
  const p = await progression(token);
  assert.deepEqual([p.totalExp, p.level], [300, 3]);

  const solo = createUser();
  await completeMcm(solo);
  await claimLandlord(jwt(solo));
  const s = await progression(jwt(solo));
  assert.deepEqual([s.totalExp, s.level], [50, 1]);
});

test('P1b: 8 concurrent landlord and main claims move EXP exactly once each', async () => {
  const user = createUser();
  await completeMcm(user);
  const lands = await Promise.all(Array.from({ length: 8 }, () => claimLandlord(jwt(user))));
  assert.ok(lands.every((r) => r.status === 200), JSON.stringify(lands.filter((r) => r.status !== 200).map((r) => r.text)));
  assert.equal(lands.filter((r) => r.body.status === 'CLAIMED').length, 1);
  assert.ok(lands.every((r) => JSON.stringify(expOf(r.body)) === JSON.stringify([['exp.campus', 'GRANTED', 50]])),
    'every response (claimed or replayed) reports the one settled EXP entry');
  const mains = await Promise.all(Array.from({ length: 8 }, () => claimMain(jwt(user))));
  assert.ok(mains.every((r) => r.status === 200), JSON.stringify(mains.filter((r) => r.status !== 200).map((r) => r.text)));
  assert.equal(mains.filter((r) => r.body.status === 'CLAIMED').length, 1);
  const p = await progression(jwt(user));
  assert.deepEqual([p.totalExp, p.level, expRows(user)], [200, 2, 2], 'one EXP ledger row per reward');
  const keys = sqlSync(`select string_agg(idempotency_key, ',' order by idempotency_key) from private.world_exp_transactions
    where user_id = ${lit(user)}`);
  assert.equal(keys, `reward/event:mcm_2026:${user}:main_clear/exp.campus,reward/minigame:landlord:${user}:first_clear/exp.campus`);
});
