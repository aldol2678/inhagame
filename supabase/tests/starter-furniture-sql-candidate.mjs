// Memory-only PostgreSQL acceptance. No connection URL, persistent database or network is used.
// Pass an already installed @electric-sql/pglite module path as argv[2].
// This is a focused real-SQL subset, not a full Supabase replay or concurrent-lock test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { splitStatements } from '../../.github/ci/migration-contract-lint.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => readFileSync(root + file, 'utf8');
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
const q = sql => db.exec(sql), scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const migrations = readdirSync(root + 'supabase/migrations').filter(n => n.endsWith('.sql')).sort();
const baseline = splitStatements(read('supabase/migrations/' + migrations[0])).map(s => s.text);
const functions = new Map(), tables = new Map();
for (const name of migrations) for (const { text } of splitStatements(read('supabase/migrations/' + name))) {
  const fn = /^create (?:or replace )?function ((?:private|public)\.\w+)\s*\(/i.exec(text);
  if (fn) functions.set(fn[1], text);
  if (name === migrations[0]) { const t = /^create table ((?:private|public)\.\w+)\s*\(/i.exec(text); if (t) tables.set(t[1], text); }
}
const wanted = new Set(), ordered = [];
function use(name) {
  if (wanted.has(name)) return; wanted.add(name); const sql = functions.get(name); assert.ok(sql, `source function ${name}`);
  for (const match of sql.matchAll(/\b((?:private|public)\.\w+)\s*\(/g)) if (functions.has(match[1])) use(match[1]);
  ordered.push(name);
}
for (const name of ['public.get_world_shop_v1', 'public.purchase_world_shop_listing_v2', 'public.get_my_world_inventory_v1',
  'private.validate_world_room_furniture_v1', 'private.world_shop_listings_validate_v1']) use(name);
const neededTables = new Set();
for (const name of wanted) for (const [table] of tables) if (functions.get(name).includes(table)) neededTables.add(table);
// The only synthetic boundary is identity. Money, catalog, stock, purchases, inventory,
// level and placement validators below are loaded from the exact checkout SQL.
await q(`create schema auth; create schema private; create role anon; create role authenticated; create role service_role;
create table auth.users(id uuid primary key,is_anonymous boolean);
create table public.profiles(user_id uuid primary key,is_banned boolean default false);
create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema auth,public to authenticated,anon,service_role;`);
neededTables.delete('public.profiles');
for (const name of neededTables) await q(tables.get(name));
for (const sql of baseline) {
  const t = /^alter table (?:only )?((?:private|public)\.\w+)\b/i.exec(sql);
  if (t && neededTables.has(t[1]) && /add constraint/i.test(sql)) {
    const foreign = /references ((?:private|public|auth)\.\w+)/i.exec(sql);
    if (!foreign || neededTables.has(foreign[1]) || ['auth.users','public.profiles'].includes(foreign[1])) await q(sql);
  }
}
for (const name of ordered) await q(functions.get(name));
// Load real stock and progression thresholds. No player rows are copied.
for (const sql of baseline) {
  const t = /^insert into "?(private|public)"?\."?(\w+)"?/i.exec(sql);
  if (t && neededTables.has(`${t[1]}.${t[2]}`)) await q(sql);
}
const f0 = splitStatements(read('supabase/migrations/20261009142600_world_personal_room_f0_furniture.sql'));
await q(f0.find(s => /^insert into private.world_item_catalog/i.test(s.text)).text);
// Use the actual baseline grants for selected functions; private schema is not exposed.
for (const sql of baseline) {
  const fn = /^(?:grant|revoke)\b[\s\S]*?function ((?:private|public)\.\w+)\(/i.exec(sql);
  if (fn && wanted.has(fn[1])) await q(sql);
}
await q(`revoke all on function public.purchase_world_shop_listing_v2(text,text,text) from public,anon,service_role;
grant execute on function public.purchase_world_shop_listing_v2(text,text,text) to authenticated;`);
const candidate = read('supabase/migrations/20261012022000_world_starter_furniture_locked_candidate.sql');
const oldStock = await scalar(`select jsonb_agg(to_jsonb(l) order by listing_id) from private.world_shop_listings l`);
await q(candidate);
assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(l) order by listing_id) from private.world_shop_listings l where listing_id not in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa')`), oldStock);
assert.equal(await scalar('select count(*)::int from private.world_player_items'), 0);
assert.equal(await scalar('select count(*)::int from private.world_wallets'), 0);
const id = n => `b8300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await q(`insert into auth.users values('${id(1)}',false),('${id(2)}',false),('${id(3)}',true);
insert into public.profiles values('${id(1)}',false),('${id(2)}',false),('${id(3)}',false);
insert into private.world_wallets(user_id,currency_id,balance) values('${id(1)}','currency.induck_coin',600);`);
const auth = async (n, anon = false) => {
  await q('reset role'); await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: id(n), role:'authenticated',is_anonymous:anon })]); await q('set role authenticated');
};
const buy = (item, key, shop = 'shop.dorm_furniture') => scalar('select public.purchase_world_shop_listing_v2($1,$2,$3)', [shop,`offer.dorm_furniture.${item}`,key]);
let inTransaction = false;
const fail = async (call, message) => {
  if (inTransaction) await q('savepoint expected_failure');
  await assert.rejects(call, e => e.message === message);
  if (inTransaction) await q('rollback to expected_failure; release expected_failure');
};
await auth(1);
const stock = await scalar(`select public.get_world_shop_v1('shop.dorm_furniture')`);
assert.equal(stock.offers.filter(o => /study_books_set|dorm_single_sofa/.test(o.itemId)).length, 2);
assert.ok(stock.offers.filter(o => /study_books_set|dorm_single_sofa/.test(o.itemId)).every(o => o.purchasable === false && o.unavailableReason === 'LISTING_LOCKED'));
await fail(() => buy('study_books_set','starter:locked'), 'LISTING_LOCKED');
// Local acceptance only: activate inside a rollback transaction in this memory-only DB.
await q(`reset role; begin; update private.world_shop_listings set status='ACTIVE'
where listing_id in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa');`);
inTransaction = true;
await auth(1);
await fail(() => buy('study_books_set','starter:wrong','shop.student_center'), 'SHOP_LISTING_MISMATCH');
await auth(2); await fail(() => buy('study_books_set','starter:poor'), 'INSUFFICIENT_FUNDS');
// Recover the failed statement within a test savepoint (PostgreSQL transaction semantics).
await auth(3, true); await fail(() => buy('study_books_set','starter:guest'), 'PERMANENT_ACCOUNT_REQUIRED');
await q(`reset role;
create function pg_temp.reject_starter_grant() returns trigger language plpgsql as $$begin raise exception 'STARTER_TEST_GRANT_REJECTED'; end$$;
create trigger starter_injected_failure before insert on private.world_player_items for each row execute function pg_temp.reject_starter_grant();`);
await auth(1); await fail(() => buy('study_books_set','starter:grant-failed'), 'STARTER_TEST_GRANT_REJECTED');
await q('reset role; drop trigger starter_injected_failure on private.world_player_items');
assert.equal(await scalar(`select balance::int from private.world_wallets where user_id='${id(1)}'`),600);
assert.equal(await scalar('select count(*)::int from private.world_currency_transactions'),0);
assert.equal(await scalar('select count(*)::int from private.world_item_grants'),0);
await q(`update private.world_item_catalog set status='DISABLED' where item_id='furniture.study_books_set'`);
await auth(1); await fail(() => buy('study_books_set','starter:unavailable'), 'ITEM_UNAVAILABLE');
await q(`reset role; update private.world_item_catalog set status='COMING_SOON' where item_id='furniture.study_books_set'`);
await auth(1);
const books = await buy('study_books_set','starter:books');
assert.equal(books.status,'SUCCESS'); assert.equal(books.wallet.price,120); assert.equal(books.wallet.balanceAfter,480);
assert.equal((await buy('study_books_set','starter:books')).replayed,true);
await fail(() => buy('study_books_set','starter:books-again'), 'ITEM_ALREADY_OWNED');
await fail(() => buy('dorm_single_sofa','starter:books'), 'IDEMPOTENCY_CONFLICT');
const sofa = await buy('dorm_single_sofa','starter:sofa');
assert.equal(sofa.status,'SUCCESS'); assert.equal(sofa.wallet.price,480); assert.equal(sofa.wallet.balanceAfter,0);
await auth(2); await fail(() => buy('study_books_set','starter:books'), 'IDEMPOTENCY_CONFLICT');
await auth(1);
const inventory = await scalar('select public.get_my_world_inventory_v1()');
assert.deepEqual(inventory.items.map(i => i.itemId).sort(), ['furniture.dorm_single_sofa','furniture.study_books_set']);
assert.ok(inventory.items.every(i => i.quantity === 1 && i.sourceType === 'SHOP'));
await q('reset role');
assert.equal(await scalar('select count(*)::int from private.world_purchase_transactions'),2);
assert.equal(await scalar('select count(*)::int from private.world_currency_transactions'),2);
assert.equal(await scalar('select count(*)::int from private.world_item_grants'),2);
assert.equal(await scalar(`select balance::int from private.world_wallets where user_id='${id(1)}'`),0);
const placements = [
  {id:id(10),itemId:'furniture.study_books_set',surface:'desk',x:2.5,z:1.5,yaw:0},
  {id:id(11),itemId:'furniture.dorm_single_sofa',surface:'floor',x:-2,z:0,yaw:0}
];
await db.query('select private.validate_world_room_furniture_v1($1,$2)',[id(1),JSON.stringify(placements)]);
await fail(() => db.query('select private.validate_world_room_furniture_v1($1,$2)',[id(2),JSON.stringify(placements)]),'ITEM_NOT_OWNED');
await fail(() => db.query('select private.validate_world_room_furniture_v1($1,$2)',[id(1),JSON.stringify([...placements,{...placements[1],id:id(12),x:2,z:-1}])]),'ITEM_NOT_OWNED');
await fail(() => db.query('select private.validate_world_room_furniture_v1($1,$2)',[id(1),JSON.stringify([{...placements[0],surface:'floor'}])]),'INVALID_LAYOUT');
// A later stock pause preserves successful historical retries, never revokes furniture.
await q(`update private.world_shop_listings set status='LOCKED' where listing_id='offer.dorm_furniture.dorm_single_sofa'`);
await auth(1); const replay = await buy('dorm_single_sofa','starter:sofa');
assert.equal(replay.replayed,true); assert.equal(replay.wallet.price,480);
await q('rollback'); inTransaction = false; await q('reset role');
assert.equal(await scalar('select count(*)::int from private.world_player_items'),0);
assert.equal(await scalar('select count(*)::int from private.world_purchase_transactions'),0);
assert.equal(await scalar(`select count(*)::int from private.world_shop_listings where listing_id in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa') and status='LOCKED'`),2);
// Exact narrow operational SQL, only in memory and rolled back. Existing value is empty here;
// the full local-stack test additionally checks aggregate player-value preservation.
await q('begin'); inTransaction = true;
await q("delete from private.world_shop_listings where listing_id in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa')");
await q(read('docs/ops/sql/20261012_starter_furniture_open.sql'));
assert.equal(await scalar("select count(*)::int from private.world_shop_listings where listing_id in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa') and status='ACTIVE'"),2);
await fail(() => q(read('docs/ops/sql/20261012_starter_furniture_open.sql')), 'STARTER_LISTING_ALREADY_EXISTS_INSPECT_FIRST');
await q('rollback'); inTransaction = false;
assert.equal(await scalar("select count(*)::int from private.world_shop_listings where listing_id in ('offer.dorm_furniture.study_books_set','offer.dorm_furniture.dorm_single_sofa') and status='LOCKED'"),2);
console.log(JSON.stringify({result:'PASS', sqlFunctions:ordered.length, realTables:neededTables.size,
  checks:['default LOCKED','unchanged old stock','no pre-grant or wallet creation','server shop binding','insufficient funds','guest denied','failed grant rolls back debit/logs','disabled item denied','authoritative prices','same-key replay','UNIQUE duplicate rejection','conflicting-key rejection','cross-account replay denial','fresh inventory','two exact debits/grants','server placement ownership/count/surface','replay after pause','rollback restores LOCKED','exact narrow operational SQL and repeat refusal'],
  limitations:['Synthetic auth boundary; focused in-memory PostgreSQL subset, not full Supabase migration replay.', 'No real concurrent transactions, PostgREST, browser rendering or deployed DB verified.']},null,2));
await db.close();
