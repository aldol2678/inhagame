// Real independent PostgreSQL connections. Run only through scripts/public-db.sh on a disposable stack.
// Not a mock: same-key races, last-input contention, and simultaneous H2 save/COOK must settle atomically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const { DB_URL, PSQL_FALLBACK_CONTAINER } = process.env;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//, 'disposable local DB only');
const run = promisify(execFile), lit = value => `'${String(value).replaceAll("'", "''")}'`;
async function sql(query) {
  const args = ['-v', 'ON_ERROR_STOP=1', '-Atq', '-c', query];
  try { return (await run('psql', [DB_URL, ...args], { encoding: 'utf8', timeout: 15000 })).stdout.trim(); }
  catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    return (await run('docker', ['exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args],
      { encoding: 'utf8', timeout: 15000 })).stdout.trim();
  }
}
const account = randomUUID(), room = randomUUID(), placement = randomUUID();
const recipe = `recipe.cooking_test_${randomUUID().replaceAll('-', '')}`;
const claims = lit(JSON.stringify({ sub: account, role: 'authenticated', is_anonymous: false }));
const objects = [{ id: placement, itemId: 'furniture.cooking_station', surface: 'floor', x: -6, z: 0, yaw: 0 }];
const asUser = query => sql(`begin; set local lock_timeout='5s'; set local role authenticated; set local request.jwt.claims=${claims}; ${query}; commit;`);
async function cook(request) {
  try { return { ok: true, value: JSON.parse((await asUser(`select public.cook_my_world_recipe_v1(${lit(recipe)},${lit(request)})`)).split('\n').at(-1)) }; }
  catch (error) { return { ok: false, error: /ERROR:\s+([A-Z_]+)/.exec(String(error.stderr ?? error.message))?.[1] ?? String(error.message) }; }
}
const quantity = item => sql(`select coalesce((select quantity from private.world_player_items where user_id=${lit(account)} and item_id=${lit(item)}),0)`);
test.before(async () => {
  await sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(account)},'authenticated','authenticated',${lit(`cook-${account}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(account)},${lit(`c${account.slice(0, 8)}`)},false);
    insert into public.world_player_rooms(id,owner_user_id) values (${lit(room)},${lit(account)});
    insert into private.world_recipe_catalog(recipe_id,definition_version,mutation_type,required_capability,required_item_id,status,plan)
    select ${lit(recipe)},definition_version,mutation_type,required_capability,required_item_id,'ACTIVE',plan
      from private.world_recipe_catalog where recipe_id='recipe.carp_grill';
    select private.world_inventory_grant_v1(${lit(account)},'material.fish_carp',2,'SYSTEM','cook.test',${lit(`cook-it:${account}:fish`)},null,null);
    select private.world_inventory_grant_v1(${lit(account)},'furniture.cooking_station',1,'SYSTEM','cook.test',${lit(`cook-it:${account}:station`)},null,null);`);
  await asUser(`select public.save_my_room_furniture_v1(${lit(room)},0,${lit(JSON.stringify(objects))}::jsonb)`);
});
test.after(async () => {
  await sql(`delete from auth.users where id=${lit(account)}; delete from private.world_recipe_catalog where recipe_id=${lit(recipe)};`);
});
test('same request racing on twelve connections consumes and grants only once', async () => {
  const request = randomUUID(), replies = await Promise.all(Array.from({ length: 12 }, () => cook(request)));
  assert.ok(replies.every(r => r.ok), JSON.stringify(replies));
  for (const reply of replies) assert.deepEqual(reply.value, replies[0].value, 'identical frozen receipt');
  assert.equal(await quantity('material.fish_carp'), '1'); assert.equal(await quantity('consumable.grilled_carp'), '1');
  assert.equal(await sql(`select count(*) from private.world_recipe_receipts where user_id=${lit(account)}`), '1');
});
test('two distinct requests racing for the last carp produce only one more meal', async () => {
  const replies = await Promise.all([cook(randomUUID()), cook(randomUUID())]);
  assert.equal(replies.filter(r => r.ok).length, 1, JSON.stringify(replies));
  assert.equal(replies.find(r => !r.ok).error, 'INSUFFICIENT_QUANTITY');
  assert.equal(await quantity('material.fish_carp'), '0'); assert.equal(await quantity('consumable.grilled_carp'), '2');
});
test('H2 save versus cooking has no lock cycle; station removal has a serial outcome', async () => {
  await sql(`select private.world_inventory_grant_v1(${lit(account)},'material.fish_carp',1,'SYSTEM','cook.test',${lit(`cook-it:${account}:save-race`)},null,null)`);
  const [receipt] = await Promise.all([cook(randomUUID()), asUser(`select public.save_my_room_furniture_v1(${lit(room)},1,'[]'::jsonb)`)]);
  assert.ok(receipt.ok || receipt.error === 'COOKING_STATION_REQUIRED', JSON.stringify(receipt));
  assert.equal(await quantity('material.fish_carp'), receipt.ok ? '0' : '1');
  assert.equal(await quantity('consumable.grilled_carp'), receipt.ok ? '3' : '2');
  const later = await cook(randomUUID()); assert.equal(later.error, 'COOKING_STATION_REQUIRED');
  assert.equal(await sql("select status from private.world_recipe_catalog where recipe_id='recipe.carp_grill'"), 'COMING_SOON', 'canonical recipe is never opened');
});
