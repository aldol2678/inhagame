// Economy/Collection P0-B Inventory against the disposable local Supabase stack. Each server call
// is its own psql process (own connection and transaction), so parallel grants genuinely race.
// Player reads and client forge attempts go through the local Data API with minted JWTs. The C0
// code catalog is imported and compared with the DB grant-authority mirror.
//
// Needs API_URL, ANON_KEY, DB_URL and JWT_SECRET from `supabase status` (.github/ci/supabase-migrations.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { ITEM_CATALOG, VS_ECONOMY_ITEM_IDS, catalogAuthorityRow } from '../../../apps/world/src/collection/item-catalog.js';

const { API_URL, ANON_KEY, DB_URL, JWT_SECRET, PSQL_FALLBACK_CONTAINER } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && JWT_SECRET, 'API_URL, ANON_KEY, DB_URL and JWT_SECRET come from the local stack');
assert.match(API_URL, LOOPBACK, 'API_URL must be the local stack');
assert.match(DB_URL, LOOPBACK, 'DB_URL must be the local stack');

const run = promisify(execFile);
const FIXTURE_PREFIX = 'memorabilia.p0b_it_';

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

/** A server (service_role) InventoryService call on a fresh connection. */
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
const grant = (user, itemId, key, { quantity = 1, source = 'SYSTEM', ref = 'integration_test', eventId = null } = {}) =>
  server('world_inventory_grant_item_v1', [user, itemId, quantity, source, ref, key, eventId]);
const list = async (user) => (await server('world_inventory_list_v1', [user])).value.items;
const ownershipRows = (user) => JSON.parse(sqlSync(`select coalesce(json_agg(i order by i.item_id), '[]')
  from private.world_player_items i where i.user_id = ${lit(user)}`));

const users = [];
function createUser() {
  const id = randomUUID();
  sqlSync(`insert into auth.users(id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${lit(`inventory-${id}@example.test`)}, now(), false)`);
  sqlSync(`insert into public.profiles(user_id, nickname, is_banned) values (${lit(id)}, ${lit(`i${id.slice(0, 8)}`)}, false)`);
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
const myInventory = async (token) => {
  const read = await rest('/rest/v1/rpc/get_my_world_inventory_v1', { token, body: {} });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  return read.body.items;
};

test.after(() => {
  if (users.length) sqlSync(`delete from auth.users where id in (${users.map(lit).join(', ')})`);
  sqlSync(`delete from private.world_item_catalog where item_id like '${FIXTURE_PREFIX}%'`);
});

test('the DB grant-authority mirror equals the C0 code catalog', () => {
  // Sorted in JS by code unit, so database collation cannot reorder '.' and '_'.
  const byId = (a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0);
  const db = JSON.parse(sqlSync(`select coalesce(json_agg(c), '[]') from private.world_item_catalog c
    where c.item_id not like '${FIXTURE_PREFIX}%'`)).sort(byId);
  const code = ITEM_CATALOG.map(catalogAuthorityRow).sort(byId);
  assert.deepEqual(db.map((r) => r.item_id), code.map((r) => r.item_id), 'same item ids');
  assert.deepEqual(db, code, 'same category, ownership policy, max stack and status for every item');
});

test('vertical slice ownership persists across connections and player sessions', async () => {
  const user = createUser();
  for (const itemId of VS_ECONOMY_ITEM_IDS) {
    const eventId = itemId.includes('mcm_2026') ? 'event.mcm_2026' : null;
    const result = await grant(user, itemId, `it:${user}:${itemId}`,
      { source: eventId ? 'EVENT' : 'SHOP', ref: eventId ? 'event.mcm_2026:it' : 'shop.it', eventId });
    assert.ok(result.ok && result.value.status === 'GRANTED', `${itemId}: ${JSON.stringify(result)}`);
  }
  // New server connection: listOwnedItems / hasItem / getOwnedItem see what earlier connections wrote.
  const serverView = await list(user);
  assert.deepEqual(serverView.map((i) => i.itemId).sort(), [...VS_ECONOMY_ITEM_IDS].sort());
  assert.equal((await server('world_inventory_has_item_v1', [user, 'furniture.induck_cushion'])).value, true);
  const cap = (await server('world_inventory_get_item_v1', [user, 'head.induck_cap'])).value;
  assert.deepEqual([cap.owned, cap.item.quantity, cap.item.sourceType, cap.item.sourceRef], [true, 1, 'SHOP', 'shop.it']);

  // Two separate player sessions ("log out, log back in") read the identical inventory.
  const first = await myInventory(jwt(user));
  const second = await myInventory(jwt(user));
  assert.deepEqual(second, first, 'reconnect restores the same inventory');
  assert.equal(first.length, 8);
  const poster = first.find((i) => i.itemId === 'furniture.mcm_2026_poster');
  assert.deepEqual([poster.quantity, poster.sourceType, poster.sourceRef, poster.eventId],
    [1, 'EVENT', 'event.mcm_2026:it', 'event.mcm_2026'], 'provenance is readable by the owner');
  assert.ok(Date.parse(poster.acquiredAt) > 0);
  // Most recent acquisition first: every grant above committed in its own transaction, in order.
  assert.deepEqual(first.map((i) => i.itemId), [...VS_ECONOMY_ITEM_IDS].reverse());
});

test('concurrent retries of one grant key change ownership once', async () => {
  const user = createUser();
  const key = `grant:quest.first_campus:${user}`;
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    grant(user, 'badge.campus_first_step', key, { source: 'QUEST', ref: 'quest.first_campus' })));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(results.filter((r) => r.value.status === 'GRANTED').length, 1);
  assert.equal(results.filter((r) => r.value.status === 'ALREADY_PROCESSED').length, 7);
  assert.equal(ownershipRows(user).length, 1);
  assert.equal(sqlSync(`select count(*) from private.world_item_grants where grant_id = ${lit(key)}`), '1');
});

test('concurrent different grants of one UNIQUE item leave exactly one ownership row', async () => {
  const user = createUser();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    grant(user, 'top.induck_hoodie', `it:${user}:hoodie:${i}`, { source: 'SHOP', ref: `purchase-${i}` })));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.equal(results.filter((r) => r.value.status === 'GRANTED').length, 1);
  assert.equal(results.filter((r) => r.value.status === 'ALREADY_OWNED').length, 5);
  const rows = ownershipRows(user);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 1);
  const winner = results.find((r) => r.value.status === 'GRANTED').value;
  assert.equal(rows[0].source_ref, winner.sourceRef, 'provenance is the grant that actually created it');
});

test('concurrent STACKABLE grants add up without lost updates', async () => {
  const itemId = `${FIXTURE_PREFIX}ticket`;
  sqlSync(`insert into private.world_item_catalog values (${lit(itemId)}, 'MEMORABILIA', 'STACKABLE', 50, 'ACTIVE')`);
  const user = createUser();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    grant(user, itemId, `it:${user}:ticket:${i}`, { quantity: 2 })));
  assert.ok(results.every((r) => r.ok && r.value.status === 'GRANTED'), JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.value.quantityBefore).sort((a, b) => a - b),
    Array.from({ length: 10 }, (_, i) => i * 2), 'a gapless chain 0,2,...,18');
  const rows = ownershipRows(user);
  assert.deepEqual([rows.length, rows[0].quantity], [1, 20]);
});

test('clients cannot forge, change or read other inventories through the Data API', async () => {
  const owner = createUser();
  const other = createUser();
  await grant(owner, 'furniture.induck_cushion', `it:${owner}:cushion`, { source: 'SHOP', ref: 'shop.it' });
  const token = jwt(other);
  const attempts = [
    ['player grantItem RPC', '/rest/v1/rpc/world_inventory_grant_item_v1', { token, body: {
      p_user: other, p_item_id: 'furniture.mini_induck', p_quantity: 1, p_source_type: 'SHOP',
      p_source_ref: 'forged', p_idempotency_key: `client:${other}:1` } }],
    ['guest grantItem RPC', '/rest/v1/rpc/world_inventory_grant_item_v1', { body: {
      p_user: other, p_item_id: 'furniture.mini_induck', p_quantity: 1, p_source_type: 'SHOP',
      p_source_ref: 'forged', p_idempotency_key: `client:${other}:2` } }],
    ['player default grant RPC', '/rest/v1/rpc/world_inventory_ensure_default_items_v1', { token, body: { p_user: other } }],
    ['player ownership INSERT', '/rest/v1/world_player_items', { token, headers: { 'Content-Profile': 'private' },
      body: { user_id: other, item_id: 'furniture.mini_induck', quantity: 1, source_type: 'SHOP', source_ref: 'x', grant_id: 'x' } }],
    ['player quantity UPDATE', `/rest/v1/world_player_items?user_id=eq.${owner}`, { token, method: 'PATCH',
      headers: { 'Content-Profile': 'private' }, body: { quantity: 99, source_type: 'ADMIN' } }],
    ['player ownership DELETE', `/rest/v1/world_player_items?user_id=eq.${owner}`, { token, method: 'DELETE',
      headers: { 'Content-Profile': 'private' } }],
    ['player raw inventory read', `/rest/v1/world_player_items?user_id=eq.${owner}`, { token, method: 'GET',
      headers: { 'Accept-Profile': 'private' } }],
    ['player raw grant log read', `/rest/v1/world_item_grants?user_id=eq.${owner}`, { token, method: 'GET',
      headers: { 'Accept-Profile': 'private' } }],
    ['player lists another inventory via server API', '/rest/v1/rpc/world_inventory_list_v1', { token, body: { p_user: owner } }],
    ['player checks another item via server API', '/rest/v1/rpc/world_inventory_has_item_v1', { token, body: {
      p_user: owner, p_item_id: 'furniture.induck_cushion' } }],
  ];
  for (const [label, path, options] of attempts) {
    const response = await rest(path, options);
    assert.ok(response.status >= 400, `${label} must be refused, got ${response.status} ${JSON.stringify(response.body)}`);
  }
  assert.deepEqual(ownershipRows(owner).map((r) => [r.item_id, r.quantity, r.source_type]),
    [['furniture.induck_cushion', 1, 'SHOP']], 'owner inventory unchanged');
  assert.deepEqual(ownershipRows(other), [], 'attacker owns nothing');
  assert.deepEqual(await myInventory(token), [], 'a player reads only their own (empty) inventory');
  assert.equal((await myInventory(jwt(owner))).length, 1);
});

test('a catalog miss or a disabled status never erases ownership', async () => {
  const retired = `${FIXTURE_PREFIX}retired`;
  sqlSync(`insert into private.world_item_catalog values (${lit(retired)}, 'MEMORABILIA', 'UNIQUE', null, 'ACTIVE')`);
  const user = createUser();
  assert.equal((await grant(user, retired, `it:${user}:retired`, { source: 'EVENT', ref: 'event.it' })).value.status, 'GRANTED');
  assert.equal((await grant(user, 'badge.campus_explorer', `it:${user}:explorer`)).value.status, 'GRANTED');
  sqlSync(`delete from private.world_item_catalog where item_id = ${lit(retired)}`);
  const view = await myInventory(jwt(user));
  assert.deepEqual(view.map((i) => [i.itemId, i.catalogStatus]).sort(),
    [['badge.campus_explorer', 'COMING_SOON'], [retired, 'UNKNOWN_ITEM']], 'the missing item stays, marked UNKNOWN_ITEM');
  assert.equal(ownershipRows(user).length, 2);
  assert.equal((await grant(user, retired, `it:${user}:retired-again`)).error, 'UNKNOWN_ITEM', 'but it cannot be granted anew');
});

test('account deletion removes ownership and its grant log', async () => {
  const user = createUser();
  await server('world_inventory_ensure_default_items_v1', [user]);
  assert.equal(ownershipRows(user).length, 3);
  sqlSync(`delete from auth.users where id = ${lit(user)}`);
  assert.equal(sqlSync(`select count(*) from private.world_player_items where user_id = ${lit(user)}`), '0');
  assert.equal(sqlSync(`select count(*) from private.world_item_grants where user_id = ${lit(user)}`), '0');
});
