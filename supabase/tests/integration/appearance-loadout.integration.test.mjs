// Appearance / Loadout Authority P0 against the disposable local Supabase stack. Player calls go
// through the local Data API with minted JWTs; every request is its own PostgREST connection, so
// parallel equips genuinely race. Ownership is granted through the P0-B server path (psql as
// service_role). The C0 code catalog is checked against the server's slot rule.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { APPEARANCE_SLOTS, ITEM_CATALOG } from '../../../apps/world/src/collection/item-catalog.js';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && JWT_SECRET, 'API_URL, ANON_KEY, DB_URL and JWT_SECRET come from the local stack');
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

async function grant(user, itemId) {
  const out = await psql('set role service_role', `set request.jwt.claims = '{"role":"service_role"}'`,
    `select public.world_inventory_grant_item_v1(${lit(user)}, ${lit(itemId)}, 1, 'SYSTEM', 'appearance_it', ${lit(`look-it:${user}:${itemId}`)})->>'status'`);
  assert.equal(out.split('\n').at(-1), 'GRANTED', `${itemId} granted`);
}

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`look-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`l${id.slice(0, 8)}`)}, false)`);
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
async function rest(path, { token, method = 'POST', body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the raw text */ }
  return { status: response.status, body: parsed };
}
const read = async (token) => {
  const r = await rest('/rest/v1/rpc/get_my_world_appearance_loadout_v1', { token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.slots;
};
const equip = (token, slot, itemId, key) =>
  rest('/rest/v1/rpc/equip_my_world_item_v1', { token, body: { p_slot: slot, p_item_id: itemId, p_idempotency_key: key } });
const unequip = (token, slot, key) =>
  rest('/rest/v1/rpc/unequip_my_world_item_v1', { token, body: { p_slot: slot, p_idempotency_key: key } });
const txRows = (user) => JSON.parse(sqlSync(`select coalesce(json_agg(t order by t.created_at, t.transaction_id), '[]')
  from private.world_appearance_transactions t where t.user_id = ${lit(user)}`));

test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
});

test('the C0 canon matches the server slot rule: WEARABLE equipSlot = id prefix, BADGE is not appearance', async () => {
  const user = createUser();
  const slots = await read(jwt(user));
  assert.deepEqual(Object.keys(slots).sort(), [...APPEARANCE_SLOTS].sort(), 'the read exposes exactly the C0 appearance slots');
  assert.ok(!APPEARANCE_SLOTS.includes('BADGE'));
  for (const item of ITEM_CATALOG.filter((i) => i.category === 'WEARABLE')) {
    assert.ok(APPEARANCE_SLOTS.includes(item.equipSlot), item.itemId);
    assert.equal(item.equipSlot, item.itemId.split('.')[0].toUpperCase(), `${item.itemId}: slot derivable from the id`);
  }
});

test('equip, replace and unequip persist across sessions; ownership is untouched', async () => {
  const user = createUser();
  for (const id of ['head.inha_cap', 'head.induck_cap', 'top.inha_basic', 'back.freshman_bag']) await grant(user, id);
  const first = jwt(user);
  assert.deepEqual(Object.values(await read(first)), Array(9).fill(null), 'fresh account: empty loadout');
  assert.equal((await equip(first, 'HEAD', 'head.inha_cap', `it:${user}:1`)).status, 200);
  assert.equal((await equip(first, 'TOP', 'top.inha_basic', `it:${user}:2`)).status, 200);
  const replaced = await equip(first, 'HEAD', 'head.induck_cap', `it:${user}:3`);
  assert.equal(replaced.body.previousItemId, 'head.inha_cap');
  // A second, independent session (new JWT, new connection) reads the same server state.
  const second = jwt(user);
  const slots = await read(second);
  assert.equal(slots.HEAD.itemId, 'head.induck_cap');
  assert.equal(slots.TOP.itemId, 'top.inha_basic');
  assert.equal((await unequip(second, 'TOP', `it:${user}:4`)).body.previousItemId, 'top.inha_basic');
  assert.equal((await read(first)).TOP, null);
  const inventory = await rest('/rest/v1/rpc/get_my_world_inventory_v1', { token: first, body: {} });
  assert.equal(inventory.body.items.length, 4, 'equip / unequip never change ownership');
});

test('two simultaneous equips on one slot serialize: one final item, a consistent chain', async () => {
  const user = createUser();
  await grant(user, 'head.inha_cap');
  await grant(user, 'head.induck_cap');
  const token = jwt(user);
  for (let round = 0; round < 5; round += 1) {
    const [a, b] = await Promise.all([
      equip(token, 'HEAD', 'head.inha_cap', `race:${user}:${round}:a`),
      equip(token, 'HEAD', 'head.induck_cap', `race:${user}:${round}:b`)
    ]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const final = (await read(token)).HEAD.itemId;
    // The change that won is the one the final state shows; it must have started from the other one.
    const later = [a.body, b.body].find((r) => r.itemId === final);
    const earlier = later === a.body ? b.body : a.body;
    assert.ok(later, `round ${round}: the final item is one of the two requests`);
    assert.equal(later.previousItemId, earlier.itemId, `round ${round}: the later change saw the earlier one`);
    const order = txRows(user).map((row) => row.transaction_id);
    assert.ok(order.indexOf(earlier.transactionId) < order.indexOf(later.transactionId), `round ${round}: the log orders them as applied`);
  }
  const rows = txRows(user);
  assert.equal(rows.length, 10);
  for (let i = 1; i < rows.length; i += 1) {
    assert.equal(rows[i].previous_item_id, rows[i - 1].next_item_id, 'every change starts from the previous result');
  }
  assert.equal(Number(sqlSync(`select count(*) from private.world_player_appearance_loadout where user_id = ${lit(user)}`)), 1);
});

test('same-key concurrent retries apply once and replay the rest', async () => {
  const user = createUser();
  await grant(user, 'top.inha_basic');
  const token = jwt(user);
  const key = `retry:${user}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => equip(token, 'TOP', 'top.inha_basic', key)));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)));
  assert.equal(results.filter((r) => r.body.replayed === false).length, 1, 'exactly one applied');
  assert.equal(new Set(results.map((r) => r.body.transactionId)).size, 1, 'all answers name the same transaction');
  assert.equal(txRows(user).length, 1, 'one log row');
  const conflict = await equip(token, 'TOP', 'top.induck_hoodie', key);
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body.message, 'IDEMPOTENCY_CONFLICT');
});

test('separate slots change concurrently without losing any', async () => {
  const user = createUser();
  const items = { HEAD: 'head.inha_cap', TOP: 'top.inha_basic', BACK: 'back.freshman_bag', SHOES: 'shoes.campus_sneakers' };
  for (const id of Object.values(items)) await grant(user, id);
  const token = jwt(user);
  const results = await Promise.all(Object.entries(items).map(([slot, id]) => equip(token, slot, id, `slots:${user}:${slot}`)));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)));
  const slots = await read(token);
  for (const [slot, id] of Object.entries(items)) assert.equal(slots[slot].itemId, id, slot);
});

test('the actor is always auth.uid(): no user argument, no cross-account change, no direct table access', async () => {
  const a = createUser();
  const b = createUser();
  await grant(a, 'head.inha_cap');
  const tokenA = jwt(a);
  const tokenB = jwt(b);
  assert.equal((await equip(tokenA, 'HEAD', 'head.inha_cap', `actor:${a}`)).status, 200);
  const notOwned = await equip(tokenB, 'HEAD', 'head.inha_cap', `actor:${b}`);
  assert.equal(notOwned.status, 400);
  assert.equal(notOwned.body.message, 'ITEM_NOT_OWNED');
  assert.equal((await read(tokenB)).HEAD, null, 'B sees only B');
  // There is no signature that takes a user; PostgREST finds no such function.
  const forged = await rest('/rest/v1/rpc/equip_my_world_item_v1',
    { token: tokenB, body: { p_user: a, p_slot: 'HEAD', p_item_id: 'head.inha_cap', p_idempotency_key: `actor:${b}:2` } });
  assert.equal(forged.status, 404, JSON.stringify(forged.body));
  const unequipOther = await unequip(tokenB, 'HEAD', `actor:${b}:3`);
  assert.equal(unequipOther.body.changed, false, 'B unequipping HEAD touches only B');
  assert.equal((await read(tokenA)).HEAD.itemId, 'head.inha_cap', 'A keeps its item');
  for (const table of ['world_player_appearance_loadout', 'world_appearance_transactions']) {
    const direct = await rest(`/rest/v1/${table}?select=*`, { token: tokenA, method: 'GET' });
    assert.notEqual(direct.status, 200, `${table} is not exposed to the Data API`);
  }
  const anon = await rest('/rest/v1/rpc/get_my_world_appearance_loadout_v1', { body: {} });
  assert.notEqual(anon.status, 200, 'anon cannot read a loadout');
});
