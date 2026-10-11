// Disposable local Supabase only. Every query spawns an independent PostgreSQL connection.
// Discovered by scripts/local-integration.mjs; never run against Production.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const { DB_URL, PSQL_FALLBACK_CONTAINER } = process.env;
assert.ok(DB_URL, 'DB_URL must come from the disposable local stack');
const database = new URL(DB_URL);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol), 'PostgreSQL URL required');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname), 'loopback DB only');
assert.ok(database.port && /^\d+$/.test(database.port), 'explicit local port required');
assert.equal(database.search, '', 'connection query overrides could redirect the DB host');
assert.equal(database.hash, '', 'no connection fragments');
const run = promisify(execFile);
const lit = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function query(sql) {
  const args = ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', `set statement_timeout='15s'; set lock_timeout='10s'; ${sql}`];
  const options = { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 };
  try { return (await run('psql', [DB_URL, ...args], options)).stdout.trim(); }
  catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    assert.match(PSQL_FALLBACK_CONTAINER, /^supabase_db_[A-Za-z0-9_.-]+$/, 'only a named local Supabase DB container');
    assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'no remote Docker daemon');
    assert.ok(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === 'default', 'no remote Docker context');
    return (await run('docker', ['--host', process.env.DOCKER_HOST || 'unix:///var/run/docker.sock', 'exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args], options)).stdout.trim();
  }
}
const json = async sql => JSON.parse((await query(sql)).split('\n').at(-1));
const claims = { role: 'service_role' };
const server = (op, args) => json(`set role service_role; set request.jwt.claims=${lit(JSON.stringify(claims))};
 select public.world_income_${op}_v1(${args.map(lit).join(',')});`);
const DELIVERY = 'quest.side.taerin_carp', SHIFT = 'quest.side.convenience_help';
const giver = quest => quest === DELIVERY ? 'INKYUNG-NPC-013' : 'npc.authored.convenience_employer';
const start = (actor, quest = DELIVERY, request = randomUUID()) => server('start', [actor, quest, giver(quest), request]);
const read = (actor, session = null, quest = null) => server('status', [actor, session, quest]);
const finish = (actor, session, request = randomUUID()) => server('finish', [actor, session, request]);
const action = (actor, session, request, kind, choice, revision) => server('action', [actor, session, request, kind, choice, revision]);
const users = [], COIN = 'currency.induck_coin', CARP = 'material.fish_carp';
const suffix = randomUUID().replaceAll('-', '');
const SHOP = `shop.income_it_${suffix}`, OFFER = `offer.income_it_${suffix}.cushion`;
let previous;
async function user({ anonymous = false, banned = false } = {}) {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(id)},'authenticated','authenticated',${lit(`income-${id}@example.test`)},now(),${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values(${lit(id)},${lit(`i${id.slice(0, 8)}`)},${banned});`);
  return id;
}
const grantCarp = (actor, quantity = 1) => query(`select private.world_inventory_grant_v1(${lit(actor)},${lit(CARP)},${quantity},'SYSTEM','income.integration',${lit(`income-fixture:${randomUUID()}`)},null,null);`);
const seedWallet = actor => query(`select private.world_wallet_apply_v1(${lit(actor)},${lit(COIN)},100,'REWARD','test','income.integration',${lit(`income-seed:${randomUUID()}`)},null);`);
const accountState = actor => json(`select jsonb_build_object(
 'balance',coalesce((select balance from private.world_wallets where user_id=${lit(actor)} and currency_id=${lit(COIN)}),0),
 'carp',coalesce((select quantity from private.world_player_items where user_id=${lit(actor)} and item_id=${lit(CARP)}),0),
 'rewards',(select count(*) from private.world_reward_transactions where user_id=${lit(actor)} and reward_id like 'reward.income.%'),
 'mutations',(select count(*) from private.world_inventory_mutations where user_id=${lit(actor)} and source_ref=${lit(DELIVERY)}),
 'settled',(select count(*) from private.world_income_sessions where user_id=${lit(actor)} and state='SETTLED'));`);
const activate = () => query(`update private.world_income_runtime set enabled=true,daily_cap=60;
 update private.world_income_definitions set status='ACTIVE';
 update private.world_reward_definitions set status='ACTIVE' where reward_id in ('reward.income.taerin_carp','reward.income.convenience_help');`);

before(async () => {
  previous = await json(`select jsonb_build_object('runtime',(select to_jsonb(r) from private.world_income_runtime r),
    'definitions',(select jsonb_agg(to_jsonb(d)) from private.world_income_definitions d),
    'rewards',(select jsonb_agg(to_jsonb(r)) from private.world_reward_definitions r where reward_id in ('reward.income.taerin_carp','reward.income.convenience_help')));`);
  assert.equal(previous.runtime.enabled, false, 'committed runtime is CLOSED');
  assert.equal(previous.definitions.length, 2);
  assert.equal(previous.rewards.length, 2);
  assert.ok(previous.definitions.every(row => row.status === 'CLOSED'));
  assert.ok(previous.rewards.every(row => row.status === 'DISABLED'));
  await activate();
  await query(`insert into private.world_shops(shop_id,display_name,status) values(${lit(SHOP)},'Income local test shop','ACTIVE');
    insert into private.world_shop_listings(listing_id,shop_id,position,item_id,currency_id,price,status)
    values(${lit(OFFER)},${lit(SHOP)},0,'furniture.induck_cushion',${lit(COIN)},10,'ACTIVE');`);
});
after(async () => {
  try {
    if (previous?.runtime) {
      await query(`update private.world_income_runtime set enabled=${previous.runtime.enabled},daily_cap=${previous.runtime.daily_cap};
        ${previous.definitions.map(row => `update private.world_income_definitions set status=${lit(row.status)},definition_version=${row.definition_version} where quest_id=${lit(row.quest_id)};`).join('\n')}
        ${previous.rewards.map(row => `update private.world_reward_definitions set status=${lit(row.status)},version=${row.version} where reward_id=${lit(row.reward_id)};`).join('\n')}`);
    }
  } finally {
    // Account cascade is the only permitted removal of immutable session/request receipts.
    await query(`${users.length ? `delete from auth.users where id in (${users.map(lit).join(',')});` : ''}
      delete from private.world_shop_listings where shop_id=${lit(SHOP)};
      delete from private.world_shops where shop_id=${lit(SHOP)};`);
  }
});

test('same start request and same/different finish requests race to exactly one settlement', async () => {
  const actor = await user(), startKey = randomUUID(); await grantCarp(actor, 2);
  const starts = await Promise.all(Array.from({ length: 6 }, () => start(actor, DELIVERY, startKey)));
  starts.forEach(response => assert.deepEqual(response, starts[0]));
  const session = starts[0].sessionId, finishKey = randomUUID();
  const sameKey = await Promise.all(Array.from({ length: 6 }, () => finish(actor, session, finishKey)));
  sameKey.forEach(response => assert.deepEqual(response, sameKey[0]));
  const otherKeys = await Promise.all(Array.from({ length: 6 }, () => finish(actor, session)));
  otherKeys.forEach(response => assert.deepEqual(response.receipt, sameKey[0].receipt));
  assert.deepEqual(await accountState(actor), { balance: 20, carp: 1, rewards: 1, mutations: 1, settled: 1 });
  await assert.rejects(start(actor), /INCOME_DAILY_LIMIT/);
  await assert.rejects(finish(actor, session, startKey), /IDEMPOTENCY_CONFLICT/);
});

test('different start requests serialize per-quest limits and reserve the shared cap across categories', async () => {
  const actor = await user();
  const sameQuest = await Promise.allSettled([start(actor), start(actor)]);
  assert.equal(sameQuest.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(sameQuest.find(r => r.status === 'rejected').reason), /INCOME_DAILY_LIMIT/);
  const competing = await user();
  await query('update private.world_income_runtime set daily_cap=40;');
  try {
    const results = await Promise.allSettled([start(competing, DELIVERY), start(competing, SHIFT)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(String(results.find(r => r.status === 'rejected').reason), /INCOME_DAILY_CAP/);
    const winner = results.find(r => r.status === 'fulfilled').value;
    assert.equal((await read(competing)).budget.remainingCoin, 40 - winner.coin);
    const losingQuest = winner.questId === SHIFT ? DELIVERY : SHIFT;
    await query(`update private.world_income_sessions set expires_at=clock_timestamp()-interval '1 second' where session_id=${lit(winner.sessionId)};`);
    assert.equal((await read(competing, winner.sessionId)).state, 'EXPIRED');
    assert.equal((await read(competing, winner.sessionId)).nextChallenge, null);
    const replacement = await start(competing, losingQuest);
    assert.equal(replacement.budget.remainingCoin, 40 - replacement.coin, 'expired reservation is released');
  } finally { await query('update private.world_income_runtime set daily_cap=60;'); }
});

test('insufficient carp after Reward rolls back wallet, reward, mutation and finish request; same key retries', async () => {
  const actor = await user();
  const preview = await read(actor, null, DELIVERY);
  assert.deepEqual(preview.inventory, { itemId: CARP, requiredQuantity: 1, ownedQuantity: 0 });
  assert.equal(preview.budget.remainingDeliveries, 1);
  const session = await start(actor), key = randomUUID();
  assert.equal(session.budget.remainingDeliveries, 0, 'accepted delivery reserves the daily slot even before acquiring input');
  await assert.rejects(finish(actor, session.sessionId, key), /INSUFFICIENT_QUANTITY/);
  assert.deepEqual(await accountState(actor), { balance: 0, carp: 0, rewards: 0, mutations: 0, settled: 0 });
  assert.equal(await query(`select count(*) from private.world_income_requests where user_id=${lit(actor)} and request_id=${lit(key)};`), '0');
  assert.equal((await read(actor, session.sessionId)).state, 'READY_TO_SETTLE');
  await grantCarp(actor);
  const replies = await Promise.all([finish(actor, session.sessionId, key), finish(actor, session.sessionId, key)]);
  assert.deepEqual(replies[0], replies[1]);
  assert.deepEqual(await accountState(actor), { balance: 20, carp: 0, rewards: 1, mutations: 1, settled: 1 });
});

async function challenge(session) {
  // Fixture-only trusted read/clock advancement. Players cannot read answers or update timing.
  await query(`update private.world_income_sessions set available_at=clock_timestamp()-interval '1 second' where session_id=${lit(session)};`);
  return json(`select jsonb_build_object('kind',challenge->>'action','choice',challenge->>'answer','revision',revision)
    from private.world_income_sessions where session_id=${lit(session)};`);
}
test('shift validates server choices/revisions; concurrent identical actions advance once, finish pays once', async () => {
  const actor = await user(), session = await start(actor, SHIFT);
  assert.equal(Object.hasOwn(session.nextChallenge, 'answer'), false);
  await assert.rejects(finish(actor, session.sessionId), /INCOME_NOT_READY/);
  await query(`update private.world_income_sessions set available_at=clock_timestamp()+interval '1 minute' where session_id=${lit(session.sessionId)};`);
  await assert.rejects(action(actor, session.sessionId, randomUUID(), 'stock', 'milk', 0), /INCOME_STEP_TOO_EARLY/);
  let step = await challenge(session.sessionId);
  await assert.rejects(action(actor, session.sessionId, randomUUID(), step.kind, 'invalid', step.revision), /INCOME_WRONG_CHOICE/);
  assert.equal((await read(actor, session.sessionId)).revision, 0);
  for (let revision = 0; revision < 3; revision++) {
    step = await challenge(session.sessionId);
    const key = randomUUID();
    const replies = await Promise.all(Array.from({ length: 4 }, () => action(actor, session.sessionId, key, step.kind, step.choice, step.revision)));
    replies.forEach(response => assert.deepEqual(response, replies[0]));
    assert.equal(replies[0].revision, revision + 1);
    await assert.rejects(action(actor, session.sessionId, randomUUID(), step.kind, step.choice, step.revision), /INCOME_STEP_MISMATCH/);
  }
  const paid = await Promise.all([finish(actor, session.sessionId), finish(actor, session.sessionId)]);
  assert.deepEqual(paid[0].receipt, paid[1].receipt);
  assert.deepEqual(await accountState(actor), { balance: 30, carp: 0, rewards: 1, mutations: 0, settled: 1 });
});

// Observe actual PostgreSQL wait state before starting the competing connection; no guessed startup delay.
async function waitForBackend(application, predicate = "wait_event='PgSleep'") {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await query(`select exists(select 1 from pg_stat_activity where application_name=${lit(application)} and ${predicate});`) === 't') return;
    await delay(20);
  }
  throw new Error(`Fixture backend ${application} did not reach expected wait state`);
}
function startHeldWallet(actor, tail = '') {
  const application = `income-it-${randomUUID()}`;
  // Capture rejection immediately so a failed fixture subprocess is never an unhandled promise.
  const completion = query(`begin; set local application_name=${lit(application)};
    select balance from private.world_wallets where user_id=${lit(actor)} and currency_id=${lit(COIN)} for update;
    select pg_sleep(5); ${tail} commit;`).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  return { application, completion };
}
const unwrap = result => { if (!result.ok) throw result.error; return result.value; };
function observedFinish(actor, session) {
  const application = `income-finish-${randomUUID()}`;
  const completion = json(`set application_name=${lit(application)}; set role service_role;
    set request.jwt.claims='{"role":"service_role"}';
    select public.world_income_finish_v1(${lit(actor)},${lit(session)},${lit(randomUUID())});`)
    .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  return { application, completion };
}


test('real Shop Wallet→Inventory transaction and income finish contend without lock inversion', async () => {
  const actor = await user(); await seedWallet(actor); await grantCarp(actor);
  const session = await start(actor);
  const userClaims = lit(JSON.stringify({ sub: actor, role: 'authenticated', is_anonymous: false }));
  const held = startHeldWallet(actor, `set local role authenticated; set local request.jwt.claims=${userClaims};
    select public.purchase_world_shop_listing_v1(${lit(OFFER)},${lit(`income-shop:${randomUUID()}`)});`);
  try {
    await waitForBackend(held.application);
    // Before the holder proceeds to Shop's Inventory grant, Income waits on its Wallet.
    // The old Inventory-before-Wallet income implementation creates a deadlock here.
    const pending = observedFinish(actor, session.sessionId);
    try { await waitForBackend(pending.application, "wait_event_type='Lock'"); }
    finally { await pending.completion; }
    const [shop, payment] = await Promise.all([held.completion, pending.completion]);
    unwrap(shop); const paid = unwrap(payment); assert.equal(paid.state, 'SETTLED');
    assert.deepEqual(await accountState(actor), { balance: 110, carp: 0, rewards: 1, mutations: 1, settled: 1 });
    assert.equal(await query(`select count(*) from private.world_purchase_transactions where user_id=${lit(actor)};`), '1');
  } finally { unwrap(await held.completion); }
});

test('expiry while waiting for Wallet rolls back subsequent Reward and Inventory effects', async () => {
  const actor = await user(); await seedWallet(actor); await grantCarp(actor);
  const session = await start(actor), held = startHeldWallet(actor);
  try {
    await waitForBackend(held.application);
    await query(`update private.world_income_sessions set expires_at=clock_timestamp()+interval '1 second' where session_id=${lit(session.sessionId)};`);
    const pending = observedFinish(actor, session.sessionId);
    try { await waitForBackend(pending.application, "wait_event_type='Lock'"); }
    finally { await pending.completion; }
    const [blocker, expiredResult] = await Promise.all([held.completion, pending.completion]);
    unwrap(blocker); assert.equal(expiredResult.ok, false);
    assert.match(String(expiredResult.error), /INCOME_SESSION_EXPIRED/);
    assert.deepEqual(await accountState(actor), { balance: 100, carp: 1, rewards: 0, mutations: 0, settled: 0 });
    const expired = await read(actor, session.sessionId);
    assert.equal(expired.state, 'EXPIRED'); assert.equal(expired.nextChallenge, null);
    assert.equal(expired.budget.remainingCoin, 60);
  } finally { unwrap(await held.completion); }
});

test('frozen prior-day settlement survives midnight accounting, latest filtering and all gates closing', async () => {
  const actor = await user(); await grantCarp(actor);
  const delivery = await start(actor);
  // Model a start just before KST midnight without relying on wall-clock execution at midnight.
  await query(`update private.world_income_sessions set accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date-1 where session_id=${lit(delivery.sessionId)};`);
  await assert.rejects(start(actor), /INCOME_SESSION_ACTIVE/, 'prior-day live session remains recoverable');
  assert.equal((await read(actor, null, DELIVERY)).budget.remainingDeliveries, 0);
  const paid = await finish(actor, delivery.sessionId);
  const yesterday = await query("select ((clock_timestamp() at time zone 'Asia/Seoul')::date-1)::text;");
  const today = await query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text;");
  assert.equal(paid.receipt.accountingDate, yesterday);
  assert.equal(paid.budget.budgetDate, today); assert.equal(paid.budget.remainingCoin, 60);
  const shiftPreview = await read(actor, null, SHIFT);
  assert.equal(shiftPreview.sessionId, null); assert.equal(shiftPreview.questId, SHIFT);
  assert.equal(shiftPreview.coin, 30); assert.equal(shiftPreview.enabled, true);
  const newDelivery = await start(actor);
  assert.notEqual(newDelivery.sessionId, delivery.sessionId, 'yesterday does not consume today quota');
  await query(`update private.world_income_runtime set enabled=false;
    update private.world_income_definitions set status='CLOSED';
    update private.world_reward_definitions set status='DISABLED' where reward_id like 'reward.income.%';`);
  try {
    assert.deepEqual((await read(actor, delivery.sessionId)).receipt, paid.receipt);
    const replays = await Promise.all([finish(actor, delivery.sessionId), finish(actor, delivery.sessionId)]);
    replays.forEach(response => assert.deepEqual(response.receipt, paid.receipt));
    assert.equal((await read(actor, null, SHIFT)).enabled, false);
    await assert.rejects(finish(actor, newDelivery.sessionId), /INCOME_CLOSED/);
  } finally { await activate(); }
});

test('actors cannot mix sessions, request namespaces, anonymous/banned accounts or forged service claims', async () => {
  const actor = await user(), other = await user(), key = randomUUID();
  const session = await start(actor, SHIFT, key);
  for (const operation of [() => read(other, session.sessionId), () => finish(other, session.sessionId),
    () => action(other, session.sessionId, randomUUID(), 'stock', 'milk', 0)]) await assert.rejects(operation(), /INCOME_SESSION_NOT_FOUND/);
  await assert.rejects(read(actor, session.sessionId, DELIVERY), /INCOME_SESSION_NOT_FOUND/);
  await assert.rejects(finish(actor, session.sessionId, key), /IDEMPOTENCY_CONFLICT/);
  const independent = await start(other, SHIFT, key);
  assert.notEqual(independent.sessionId, session.sessionId, 'same UUID is independently scoped to each actor');
  for (const settings of [{ anonymous: true }, { banned: true }]) {
    const unavailable = await user(settings);
    await assert.rejects(read(unavailable), /ACCOUNT_UNAVAILABLE/);
    await assert.rejects(start(unavailable), /ACCOUNT_UNAVAILABLE/);
  }
  for (const role of ['anon', 'authenticated']) await assert.rejects(query(`set role ${role};
    set request.jwt.claims='{"role":"service_role"}'; select public.world_income_finish_v1(${lit(actor)},${lit(session.sessionId)},${lit(randomUUID())});`), /permission denied/);
  await assert.rejects(query(`set request.jwt.claims='{"role":"authenticated"}'; select public.world_income_status_v1(${lit(actor)});`), /SERVICE_ROLE_REQUIRED/);
});
