// Economy P0-D Shop Purchase + P0-F2 Shop Level Gate against the disposable local Supabase stack.
// Players buy through the local Data API (PostgREST) with minted JWTs, exactly as a client would, so
// concurrent purchases race on real pooled connections. Fixtures, EXP grants (service_role) and
// final-state readback use psql on fresh connections.
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
const MUG = 'offer.student_center.campus_mug';
const FIXTURE_SHOP = 'shop.p0d_it_fixture';
const CUSHION = 'offer.p0d_it_fixture.induck_cushion';
const CAP = 'offer.student_center.induck_cap'; // Lv.1, 180
const SNEAKERS = 'offer.student_center.campus_sneakers'; // Lv.2, 240
const BACKPACK = 'offer.student_center.induck_backpack'; // Lv.3, 420

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
const grantExp = (user, amount) => server('world_exp_grant_v1', [user, amount, 'test', 'p0f2', `p0f2:${user}:${randomUUID()}`]);
const count = (table, user, extra = '') => Number(sqlSync(`select count(*) from private.${table} where user_id = ${lit(user)} ${extra}`));
const ownsItem = (user, itemId) => count('world_player_items', user, `and item_id = ${lit(itemId)}`) === 1;

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`shop-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`s${id.slice(0, 8)}`)}, false)`);
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
/** A player purchase through the Data API: { ok, value } or { ok: false, status, error }. */
async function buy(token, listingId, key) {
  const response = await rest('/rest/v1/rpc/purchase_world_shop_listing_v1', { token,
    body: { p_listing_id: listingId, p_idempotency_key: key } });
  return response.status === 200 ? { ok: true, value: response.body }
    : { ok: false, status: response.status, error: response.body?.message ?? response.body };
}

test.before(() => {
  sqlSync(`insert into private.world_shops(shop_id, display_name, status) values (${lit(FIXTURE_SHOP)}, '통합 테스트 상점', 'ACTIVE')
    on conflict do nothing`);
  sqlSync(`insert into private.world_shop_listings(listing_id, shop_id, position, item_id, currency_id, price, status)
    values (${lit(CUSHION)}, ${lit(FIXTURE_SHOP)}, 0, 'furniture.induck_cushion', ${lit(COIN)}, 180, 'ACTIVE') on conflict do nothing`);
});
test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
  sqlSync(`delete from private.world_shop_listings where shop_id = ${lit(FIXTURE_SHOP)}`);
  sqlSync(`delete from private.world_shops where shop_id = ${lit(FIXTURE_SHOP)}`);
});

test('shop read: server prices and purchasability through the Data API', async () => {
  const token = jwt(createUser());
  const shop = await rest('/rest/v1/rpc/get_world_shop_v1', { token, body: { p_shop_id: 'shop.student_center' } });
  assert.equal(shop.status, 200, JSON.stringify(shop.body));
  assert.equal(shop.body.playerLevel, 1, 'a fresh account reads the server-derived Lv.1');
  assert.deepEqual(shop.body.offers.map((o) => [o.listingId, o.price, o.purchasable, o.unavailableReason]), [
    [MUG, 120, true, null],
    [CAP, 180, true, null],
    [SNEAKERS, 240, false, 'LEVEL_REQUIRED'],
    ['offer.student_center.campus_map_poster', 250, false, 'LEVEL_REQUIRED'],
    ['offer.student_center.induck_hoodie', 320, false, 'LEVEL_REQUIRED'],
    [BACKPACK, 420, false, 'LEVEL_REQUIRED']]);
  assert.deepEqual(shop.body.offers.map((o) => o.requiredLevel), [null, 1, 2, 2, 2, 3], 'canonical required levels (E0–E5 §10.2.1)');
  const dorm = await rest('/rest/v1/rpc/get_world_shop_v1', { token, body: { p_shop_id: 'shop.dorm_furniture' } });
  assert.deepEqual(dorm.body.offers.map((o) => [o.listingId, o.price, o.requiredLevel, o.status, o.purchasable, o.unavailableReason]), [
    ['offer.dorm_furniture.induck_cushion', 220, 1, 'ACTIVE', true, null],
    ['offer.dorm_furniture.dorm_desk_lamp', 280, 2, 'ACTIVE', false, 'LEVEL_REQUIRED'],
    ['offer.dorm_furniture.campus_rug_blue', 360, 3, 'ACTIVE', false, 'LEVEL_REQUIRED'],
    ['offer.dorm_furniture.induck_chair', 420, 3, 'ACTIVE', false, 'LEVEL_REQUIRED'],
    ['offer.dorm_furniture.mini_induck', 650, 5, 'ACTIVE', false, 'LEVEL_REQUIRED']]);
  const guest = await rest('/rest/v1/rpc/get_world_shop_v1', { body: { p_shop_id: 'shop.student_center' } });
  assert.ok(guest.status >= 400, 'guests have no shop read');
});

test('vertical slice: 200 -> buy the mug -> 80, owned, recorded, and it survives a new session', async () => {
  const user = createUser();
  await credit(user, 200);
  const key = `purchase:${randomUUID()}`;
  const first = await buy(jwt(user), MUG, key);
  assert.ok(first.ok, JSON.stringify(first));
  assert.deepEqual([first.value.status, first.value.replayed, first.value.item.itemId, first.value.wallet.balanceBefore,
    first.value.wallet.balanceAfter], ['SUCCESS', false, 'memorabilia.campus_mug', 200, 80]);

  // A brand-new session: same key replays the stored purchase; nothing moves again.
  const session = jwt(user);
  const replay = await buy(session, MUG, key);
  assert.deepEqual([replay.value.replayed, replay.value.purchaseId, replay.value.wallet.balanceAfter],
    [true, first.value.purchaseId, 80]);
  const again = await buy(session, MUG, `purchase:${randomUUID()}`);
  assert.deepEqual([again.ok, again.error], [false, 'ITEM_ALREADY_OWNED']);

  const wallet = await rest('/rest/v1/rpc/get_my_world_wallet_v1', { token: session, body: {} });
  assert.deepEqual(wallet.body, { currencies: [{ id: COIN, balance: 80 }] });
  const inventory = await rest('/rest/v1/rpc/get_my_world_inventory_v1', { token: session, body: {} });
  const mug = inventory.body.items.find((i) => i.itemId === 'memorabilia.campus_mug');
  assert.deepEqual([mug.quantity, mug.sourceType, mug.sourceRef], [1, 'SHOP', MUG]);
  assert.equal(await balance(user), 80, 'a fresh server connection agrees');
  assert.equal(count('world_purchase_transactions', user), 1);
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), 1);
});

test('insufficient funds moves nothing', async () => {
  const user = createUser();
  await credit(user, 100);
  const result = await buy(jwt(user), MUG, `purchase:${randomUUID()}`);
  assert.deepEqual([result.ok, result.error], [false, 'INSUFFICIENT_FUNDS']);
  assert.equal(await balance(user), 100);
  assert.equal(ownsItem(user, 'memorabilia.campus_mug'), false);
  assert.equal(count('world_purchase_transactions', user), 0);
});

test('8 concurrent retries of one purchase key buy once and converge', async () => {
  const user = createUser();
  await credit(user, 200);
  const key = `purchase:${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => buy(jwt(user), MUG, key)));
  assert.ok(results.every((r) => r.ok && r.value.status === 'SUCCESS'), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(results.filter((r) => r.value.replayed === false).length, 1, 'exactly one real purchase');
  assert.equal(new Set(results.map((r) => r.value.purchaseId)).size, 1);
  assert.ok(results.every((r) => r.value.wallet.balanceAfter === 80));
  assert.equal(await balance(user), 80);
  assert.equal(count('world_purchase_transactions', user), 1);
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), 1);
  assert.equal(count('world_player_items', user), 1);
});

test('different keys racing for one UNIQUE item: one winner, nobody else is charged', async () => {
  const user = createUser();
  await credit(user, 500);
  const results = await Promise.all(Array.from({ length: 5 }, () => buy(jwt(user), MUG, `purchase:${randomUUID()}`)));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => r.error), Array(4).fill('ITEM_ALREADY_OWNED'));
  assert.equal(await balance(user), 380, 'only the winner paid');
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), 1);
  assert.equal(count('world_purchase_transactions', user), 1);
});

test('concurrent purchases of different items from one wallet lose no update', async () => {
  const user = createUser();
  await credit(user, 500);
  const results = await Promise.all([buy(jwt(user), MUG, `purchase:${randomUUID()}`), buy(jwt(user), CUSHION, `purchase:${randomUUID()}`)]);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(await balance(user), 200, '500 - 120 - 180');
  const chain = JSON.parse(sqlSync(`select json_agg(t order by t.balance_before desc) from private.world_currency_transactions t
    where t.user_id = ${lit(user)} and t.type = 'PURCHASE'`));
  assert.equal(chain.length, 2);
  assert.equal(chain[0].balance_before, 500);
  assert.equal(chain[1].balance_before, chain[0].balance_after, 'the second debit started from the first result');
  assert.equal(chain[1].balance_after, 200);
});

test('a grant failure after the debit rolls the whole purchase back', async () => {
  const user = createUser();
  await credit(user, 300);
  const key = `purchase:${randomUUID()}`;
  // Fault on this account only: the grant key this purchase derives is already used for another item.
  await server('world_inventory_grant_item_v1', [user, 'furniture.induck_chair', 1, 'SYSTEM', 'fault', `purchase/${key}/item`]);
  const result = await buy(jwt(user), CUSHION, key);
  assert.deepEqual([result.ok, result.error], [false, 'IDEMPOTENCY_CONFLICT']);
  assert.equal(await balance(user), 300, 'the debit was rolled back');
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), 0);
  assert.equal(ownsItem(user, 'furniture.induck_cushion'), false);
  assert.equal(count('world_purchase_transactions', user), 0);
});

test('clients cannot override price/item/user or forge commerce state', async () => {
  const user = createUser();
  const other = createUser();
  await credit(user, 1000);
  const token = jwt(user);
  const attempts = [
    ['guest purchase', '/rest/v1/rpc/purchase_world_shop_listing_v1', { body: { p_listing_id: MUG, p_idempotency_key: `c:${user}:1` } }],
    ['client price', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: { p_listing_id: MUG, p_idempotency_key: `c:${user}:2`, p_price: 1 } }],
    ['client item', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: {
      p_listing_id: MUG, p_idempotency_key: `c:${user}:3`, p_item_id: 'furniture.mini_induck', p_currency_id: COIN, p_quantity: 5 } }],
    ['buy for another user', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: {
      p_listing_id: MUG, p_idempotency_key: `c:${user}:4`, p_user: other } }],
    ['level-gated listing', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: {
      p_listing_id: SNEAKERS, p_idempotency_key: `c:${user}:5` } }],
    ['edit a price', '/rest/v1/world_shop_listings', { token, method: 'PATCH', headers: { 'Content-Profile': 'private' }, body: { price: 1 } }],
    ['create a listing', '/rest/v1/world_shop_listings', { token, headers: { 'Content-Profile': 'private' }, body: {
      listing_id: 'offer.student_center.free', shop_id: 'shop.student_center', position: 99, item_id: 'furniture.mini_induck',
      currency_id: COIN, price: 1, status: 'ACTIVE' } }],
    ['forge a purchase', '/rest/v1/world_purchase_transactions', { token, headers: { 'Content-Profile': 'private' }, body: {
      user_id: user, shop_id: 'shop.student_center', listing_id: MUG, item_id: 'memorabilia.campus_mug', quantity: 1,
      currency_id: COIN, price: 120, balance_before: 120, balance_after: 0, wallet_transaction_id: randomUUID(),
      inventory_grant_id: 'x', idempotency_key: `c:${user}:6` } }],
    ['read purchases', '/rest/v1/world_purchase_transactions', { token, method: 'GET', headers: { 'Accept-Profile': 'private' } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  assert.equal(await balance(user), 1000);
  assert.equal(count('world_player_items', user), 0);
  assert.equal(count('world_purchase_transactions', user), 0);
  assert.equal(count('world_player_items', other), 0);
});

test('level gate: Lv.1 is refused a Lv.2 listing with nothing moved, then buys it at Lv.2', async () => {
  const user = createUser();
  await credit(user, 1000);
  const key = `purchase:${randomUUID()}`;

  // Lv.1 buys the Lv.1 cap: a met gate does not block.
  const cap = await buy(jwt(user), CAP, `purchase:${randomUUID()}`);
  assert.ok(cap.ok, JSON.stringify(cap));
  assert.equal(cap.value.wallet.balanceAfter, 820);

  // Lv.1 calls the purchase RPC directly for a Lv.2 listing: refused before the debit.
  const refused = await buy(jwt(user), SNEAKERS, key);
  assert.deepEqual([refused.ok, refused.error], [false, 'LEVEL_REQUIRED']);
  assert.equal(await balance(user), 820, 'coins unchanged');
  assert.equal(ownsItem(user, 'shoes.campus_sneakers'), false, 'inventory unchanged');
  assert.equal(count('world_item_grants', user), 1, 'only the cap grant');
  assert.equal(count('world_purchase_transactions', user), 1, 'only the cap purchase');
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), 1, 'only the cap debit');

  // Earn exactly the Lv.2 threshold through the P0-F0 server authority.
  const exp = await grantExp(user, 100);
  assert.deepEqual([exp.levelBefore, exp.levelAfter], [1, 2]);
  const read = await rest('/rest/v1/rpc/get_world_shop_v1', { token: jwt(user), body: { p_shop_id: 'shop.student_center' } });
  assert.equal(read.body.playerLevel, 2);
  const offer = (id) => read.body.offers.find((o) => o.listingId === id);
  assert.deepEqual([offer(SNEAKERS).purchasable, offer(SNEAKERS).unavailableReason], [true, null], 'Lv.2 unlocks the sneakers');
  assert.deepEqual([offer(BACKPACK).purchasable, offer(BACKPACK).unavailableReason], [false, 'LEVEL_REQUIRED']);

  // The key refused at Lv.1 left nothing behind, so the same key now buys.
  const bought = await buy(jwt(user), SNEAKERS, key);
  assert.ok(bought.ok, JSON.stringify(bought));
  assert.deepEqual([bought.value.replayed, bought.value.wallet.balanceBefore, bought.value.wallet.balanceAfter], [false, 820, 580]);
  const replay = await buy(jwt(user), SNEAKERS, key);
  assert.deepEqual([replay.value.replayed, replay.value.purchaseId], [true, bought.value.purchaseId], 'idempotent replay');
  const backpack = await buy(jwt(user), BACKPACK, `purchase:${randomUUID()}`);
  assert.deepEqual([backpack.ok, backpack.error], [false, 'LEVEL_REQUIRED'], 'Lv.3 still gated at Lv.2');
  assert.equal(await balance(user), 580);
  assert.equal(count('world_purchase_transactions', user), 2);
  assert.equal(Number(sqlSync(`select total_exp from private.world_player_progression where user_id = ${lit(user)}`)), 100,
    'the shop never touched EXP');
});

test('level gate: a forged client level cannot pass', async () => {
  const user = createUser();
  await credit(user, 1000);
  const forged = jwt(user, { level: 99, app_metadata: { level: 99 }, user_metadata: { level: 99 } });
  const shop = await rest('/rest/v1/rpc/get_world_shop_v1', { token: forged, body: { p_shop_id: 'shop.student_center' } });
  assert.equal(shop.body.playerLevel, 1, 'JWT claims are not a level source');
  assert.equal(shop.body.offers.find((o) => o.listingId === SNEAKERS).unavailableReason, 'LEVEL_REQUIRED');
  const viaClaims = await buy(forged, SNEAKERS, `purchase:${randomUUID()}`);
  assert.deepEqual([viaClaims.ok, viaClaims.error], [false, 'LEVEL_REQUIRED']);

  const token = jwt(user);
  const attempts = [
    ['client level argument', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: {
      p_listing_id: SNEAKERS, p_idempotency_key: `f:${user}:1`, p_level: 99 } }],
    ['client required level', '/rest/v1/rpc/purchase_world_shop_listing_v1', { token, body: {
      p_listing_id: SNEAKERS, p_idempotency_key: `f:${user}:2`, p_required_level: 1 } }],
    ['client level on read', '/rest/v1/rpc/get_world_shop_v1', { token, body: { p_shop_id: 'shop.student_center', p_level: 99 } }],
    ['self EXP grant', '/rest/v1/rpc/world_exp_grant_v1', { token, body: {
      p_user: user, p_amount: 1000, p_source_type: 'client', p_source_id: 'x', p_idempotency_key: `f:${user}:3` } }],
    ['write EXP projection', '/rest/v1/world_player_progression', { token, headers: { 'Content-Profile': 'private' }, body: {
      user_id: user, total_exp: 1000 } }],
    ['lower a required level', '/rest/v1/world_shop_listings', { token, method: 'PATCH', headers: { 'Content-Profile': 'private' },
      body: { required_level: null } }],
    ['call the level helper', '/rest/v1/rpc/world_player_level_v1', { token, headers: { 'Content-Profile': 'private' }, body: { p_user: user } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  const me = await rest('/rest/v1/rpc/get_my_world_progression_v1', { token, body: {} });
  assert.deepEqual([me.body.totalExp, me.body.level], [0, 1], 'still 0 EXP / Lv.1');
  assert.equal(await balance(user), 1000, 'no coin moved');
  assert.equal(count('world_player_items', user), 0, 'no item granted');
  assert.equal(count('world_purchase_transactions', user), 0);
  assert.equal(Number(sqlSync(`select count(*) from private.world_shop_listings where listing_id = ${lit(SNEAKERS)} and required_level = 2`)), 1,
    'the listing still requires Lv.2');
});

test('level gate: one account leveling up does not unlock another', async () => {
  const leveled = createUser();
  const other = createUser();
  await Promise.all([credit(leveled, 500), credit(other, 500)]);
  await grantExp(leveled, 300);
  const [mine, theirs] = await Promise.all([
    buy(jwt(leveled), BACKPACK, `purchase:${randomUUID()}`),
    buy(jwt(other), BACKPACK, `purchase:${randomUUID()}`)]);
  assert.ok(mine.ok, JSON.stringify(mine));
  assert.deepEqual([theirs.ok, theirs.error], [false, 'LEVEL_REQUIRED']);
  assert.deepEqual([await balance(leveled), await balance(other)], [80, 500]);
  assert.deepEqual([ownsItem(leveled, 'back.induck_backpack'), ownsItem(other, 'back.induck_backpack')], [true, false]);
});

test('level gate racing a level-up: every attempt either buys once or moves nothing', async () => {
  const user = createUser();
  await credit(user, 1000);
  const keys = Array.from({ length: 6 }, () => `purchase:${randomUUID()}`);
  const [, ...results] = await Promise.all([grantExp(user, 100), ...keys.map((key) => buy(jwt(user), SNEAKERS, key))]);
  const wins = results.filter((r) => r.ok);
  assert.ok(results.every((r) => r.ok || ['LEVEL_REQUIRED', 'ITEM_ALREADY_OWNED'].includes(r.error)), JSON.stringify(results));
  assert.ok(wins.length <= 1, 'a UNIQUE item is bought at most once');
  assert.equal(await balance(user), 1000 - 240 * wins.length, 'only a winner paid');
  assert.equal(count('world_purchase_transactions', user), wins.length);
  assert.equal(count('world_currency_transactions', user, `and type = 'PURCHASE'`), wins.length);
  assert.equal(ownsItem(user, 'shoes.campus_sneakers'), wins.length === 1);
  // After the level-up has committed, the gate is open for a fresh attempt if nobody won the race.
  if (!wins.length) assert.ok((await buy(jwt(user), SNEAKERS, `purchase:${randomUUID()}`)).ok);
});

test('account deletion removes purchases with the wallet and inventory', async () => {
  const user = createUser();
  await credit(user, 200);
  assert.ok((await buy(jwt(user), MUG, `purchase:${randomUUID()}`)).ok);
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  for (const table of ['world_purchase_transactions', 'world_currency_transactions', 'world_player_items']) {
    assert.equal(count(table, user), 0, table);
  }
});
