// Only a disposable loopback DB. Proves operator kick semantics with REAL concurrent transactions:
// two psql processes are interleaved so the kick commits while a heartbeat transaction is open.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile), DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function psql(sql, { fail = false } = {}) {
  try {
    const { stdout } = await run('psql', [DB_URL, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
    return { ok: true, out: stdout.trim() };
  } catch (error) {
    if (!fail) throw error;
    return { ok: false, out: String(error.stderr ?? error.message) };
  }
}
const query = async sql => (await psql(sql)).out;
const claims = id => `set local role authenticated; set local request.jwt.claims=${lit(JSON.stringify(
  { sub: id, role: 'authenticated', is_anonymous: false }))};`;
const guestClaims = 'set local role anon; set local request.jwt.claims=\'{"role":"anon"}\';';
const touchSql = (session, { v = 2 } = {}) => v === 1
  ? `select public.touch_world_online_session_v1(${lit(session)}, 'AREA_MAIN_HALL', 'campus');`
  : `select public.touch_world_online_session_v2(${lit(session)}, null, 'AREA_MAIN_HALL', 'campus');`;
const asUser = (id, sql, opts) => psql(`begin; ${claims(id)} ${sql} commit;`, opts);
const asGuest = (sql, opts) => psql(`begin; ${guestClaims} ${sql} commit;`, opts);
const rowFor = session => query(`select coalesce((select user_id::text from public.world_online_sessions
  where session_id=${lit(session)}),'none')`);
const rowCount = user => query(`select count(*) from public.world_online_sessions where user_id=${lit(user)}`);

const users = [], guestSessions = [];
const admin = { id: randomUUID() };
async function user(label = 'kick_user') {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(id)},${lit(label)},false);`);
  return id;
}
const kick = (target, minutes = 30) => asUser(admin.id,
  `select public.kick_world_user_v1(${lit(target)},${minutes});`);
const restore = target => asUser(admin.id, `select public.restore_world_user_v1(${lit(target)});`);

before(async () => {
  users.push(admin.id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(admin.id)},'authenticated','authenticated',${lit(`${admin.id}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(admin.id)},'kick_admin',false);
    insert into private.world_staff_assignments(user_id,role,active) values (${lit(admin.id)},'world_admin',true);`);
});
after(async () => {
  const ids = users.map(lit).join(',');
  const guests = (guestSessions.length ? guestSessions : [randomUUID()]).map(lit).join(',');
  await query(`delete from public.world_online_sessions where user_id in (${ids}) or session_id in (${guests});
    delete from private.world_session_kick_blocks where user_id in (${ids});
    delete from private.world_staff_assignments where user_id in (${ids});
    delete from auth.users where id in (${ids});`);
});

test('v1 and v2 heartbeats reach the same block decision', async () => {
  const target = await user('parity'), s1 = randomUUID(), s2 = randomUUID();
  await asUser(target, touchSql(s1, { v: 1 }));
  await asUser(target, touchSql(s2, { v: 2 }));
  await kick(target, 5);
  for (const [session, v] of [[s1, 1], [s2, 2], [randomUUID(), 1], [randomUUID(), 2]]) {
    const result = await asUser(target, touchSql(session, { v }), { fail: true });
    assert.equal(result.ok, false, `v${v} must be refused while blocked`);
    assert.match(result.out, /WORLD_SESSION_REVOKED/);
  }
  assert.equal(await rowCount(target), '0', 'no heartbeat row may be re-created for a blocked account');
  await restore(target);
  await asUser(target, touchSql(randomUUID(), { v: 1 }));
  assert.equal(await rowCount(target), '1', 'restore re-enables both heartbeat versions');
});

test('kick committing while a heartbeat transaction is open cannot leave a ghost session', async () => {
  const target = await user('race_a'), session = randomUUID();
  // Heartbeat transaction passes its block check, then dawdles before commit.
  const heartbeat = asUser(target, `${touchSql(session)} select pg_sleep(1.5);`, { fail: true });
  await delay(500);
  const startedAt = Date.now();
  await kick(target, 5);
  await heartbeat;
  assert.equal(await rowCount(target), '0', 'serialized kick must remove the heartbeat that committed first');
  assert.ok(Date.now() - startedAt >= 800, 'kick must have waited for the in-flight heartbeat of that account');
  assert.equal(await query(`select count(*) from private.world_session_kick_blocks where user_id=${lit(target)}`), '1');
  await restore(target);
});

test('heartbeat arriving while a kick transaction is open is refused after the kick commits', async () => {
  const target = await user('race_b'), session = randomUUID();
  const operator = psql(`begin; ${claims(admin.id)} select public.kick_world_user_v1(${lit(target)},5);
    select pg_sleep(1.5); commit;`);
  await delay(500);
  const result = await asUser(target, touchSql(session), { fail: true });
  await operator;
  assert.equal(result.ok, false);
  assert.match(result.out, /WORLD_SESSION_REVOKED/);
  assert.equal(await rowCount(target), '0');
  await restore(target);
});

test('kicking one account never delays or blocks another account heartbeat', async () => {
  const a = await user('iso_a'), b = await user('iso_b');
  const operator = psql(`begin; ${claims(admin.id)} select public.kick_world_user_v1(${lit(a)},5);
    select pg_sleep(1.5); commit;`);
  await delay(300);
  const started = Date.now();
  await asUser(b, touchSql(randomUUID()));
  assert.ok(Date.now() - started < 1000, 'other accounts must not wait on the kick lock');
  await operator;
  assert.equal(await rowCount(b), '1');
  await restore(a);
});

test('a session UUID cannot be taken over by another account or downgraded to a guest', async () => {
  const owner = await user('owner'), other = await user('other'), session = randomUUID();
  await asUser(owner, touchSql(session));
  const stolen = await asUser(other, touchSql(session), { fail: true });
  assert.equal(stolen.ok, false);
  assert.match(stolen.out, /WORLD_SESSION_OWNER_MISMATCH/);
  const downgraded = await asGuest(touchSql(session), { fail: true });
  assert.equal(downgraded.ok, false);
  assert.match(downgraded.out, /WORLD_SESSION_OWNER_MISMATCH/);
  assert.equal(await rowFor(session), owner, 'ownership must be unchanged');
  await asUser(owner, touchSql(session));
  assert.equal(await rowFor(session), owner, 'owner can keep refreshing');
});

test('a guest session may be claimed by the account that signs in on that page', async () => {
  const member = await user('claim'), session = randomUUID();
  guestSessions.push(session);
  await asGuest(touchSql(session));
  assert.equal(await rowFor(session), 'none');
  assert.equal(await query(`select count(*) from public.world_online_sessions where session_id=${lit(session)}`), '1');
  await asUser(member, touchSql(session));
  assert.equal(await rowFor(session), member);
});

test('a blocked account cannot hijack a guest session to dodge the block', async () => {
  const target = await user('dodge'), session = randomUUID();
  guestSessions.push(session);
  await asGuest(touchSql(session));
  await kick(target, 5);
  const result = await asUser(target, touchSql(session), { fail: true });
  assert.equal(result.ok, false);
  assert.match(result.out, /WORLD_SESSION_REVOKED/);
  assert.equal(await rowFor(session), 'none');
  await restore(target);
});

test('kick, restore and rejected heartbeats leave account, character, inventory, reward and room data untouched', async () => {
  const target = await user('preserve');
  await psql(`begin; set local role service_role; set local request.jwt.claims='{"role":"service_role"}';
    select public.world_inventory_ensure_default_items_v1(${lit(target)}); commit;`);
  await asUser(target, `select public.get_or_create_my_personal_room_v1();`);
  // Fingerprint every row of every table in the application schemas except the two the feature owns.
  const fingerprint = () => query(`select md5(string_agg(t.name || ':' || t.digest, ',' order by t.name)) from (
    select n.nspname || '.' || c.relname as name,
      (xpath('/row/d/text()', query_to_xml(format(
        'select coalesce(md5(string_agg(x::text, '','' order by x::text)),'''') as d from %I.%I x',
        n.nspname, c.relname), false, true, '')))[1]::text as digest
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public','private','auth')
      and (n.nspname || '.' || c.relname) not in
        ('public.world_online_sessions','private.world_session_kick_blocks')) t;`);
  const accountData = () => query(`select
    (select count(*) from public.profiles where user_id=${lit(target)}) || '/' ||
    (select count(*) from auth.users where id=${lit(target)}) || '/' ||
    (select count(*) from private.world_player_appearance_loadout where user_id=${lit(target)}) || '/' ||
    (select count(*) from private.world_wallets where user_id=${lit(target)}) || '/' ||
    (select count(*) from public.world_player_rooms where owner_user_id=${lit(target)})`);
  const before = await fingerprint(), counts = await accountData();
  assert.ok(Number(counts.split('/')[0]) === 1 && Number(counts.split('/')[1]) === 1);
  await asUser(target, touchSql(randomUUID()));
  await kick(target, 5);
  for (const v of [1, 2]) {
    assert.equal((await asUser(target, touchSql(randomUUID(), { v }), { fail: true })).ok, false);
  }
  await restore(target);
  await asUser(target, touchSql(randomUUID()));
  assert.equal(await fingerprint(), before, 'no row outside the heartbeat/block tables may change');
  assert.equal(await accountData(), counts);
});

test('only world admins can kick or restore, and the target cannot be the operator', async () => {
  const member = await user('plain'), other = await user('victim');
  const kicked = await asUser(member, `select public.kick_world_user_v1(${lit(other)},5);`, { fail: true });
  assert.match(kicked.out, /unauthorized/);
  const restored = await asUser(member, `select public.restore_world_user_v1(${lit(other)});`, { fail: true });
  assert.match(restored.out, /unauthorized/);
  const self = await asUser(admin.id, `select public.kick_world_user_v1(${lit(admin.id)},5);`, { fail: true });
  assert.match(self.out, /INVALID_KICK_TARGET/);
  const anon = await asGuest(`select public.kick_world_user_v1(${lit(other)},5);`, { fail: true });
  assert.equal(anon.ok, false);
});
