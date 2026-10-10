// Only a disposable loopback DB. F08: the roster is capped at 100 rows per list, so "absent from the list"
// is not evidence. Proves the totals/truncation flags and the exact per-account read on real rows.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile), DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function psql(sql, { fail = false } = {}) {
  try {
    const { stdout } = await run('psql', [DB_URL, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql], { maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, out: stdout.trim() };
  } catch (error) {
    if (!fail) throw error;
    return { ok: false, out: String(error.stderr ?? error.message) };
  }
}
const query = async sql => (await psql(sql)).out;
const claims = id => `set local role authenticated; set local request.jwt.claims=${lit(JSON.stringify(
  { sub: id, role: 'authenticated', is_anonymous: false }))};`;
const asUser = (id, sql, opts) => psql(`begin; ${claims(id)} ${sql} commit;`, opts);
const json = async (id, expression) => JSON.parse((await asUser(id, `select ${expression};`)).out.split('\n').find(line => line.startsWith('{')));

const admin = randomUUID(), bulk = [], targets = [];
const CROWD = 105;
async function account(id, nickname) {
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(id)},${lit(nickname)},false);`);
}
before(async () => {
  await account(admin, 'rb_admin');
  await query(`insert into private.world_staff_assignments(user_id,role,active) values (${lit(admin)},'world_admin',true);`);
  for (let i = 0; i < CROWD; i += 1) bulk.push(randomUUID());
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
      select u,'authenticated','authenticated',u||'@example.test',now(),false from unnest(${lit(`{${bulk.join(',')}}`)}::uuid[]) u;
    insert into public.profiles(user_id,nickname,is_banned)
      select u,'c'||substr(u::text,1,8),false from unnest(${lit(`{${bulk.join(',')}}`)}::uuid[]) u;
    insert into public.world_online_sessions(session_id,user_id,place_zone_id,space,started_at,last_seen_at)
      select gen_random_uuid(),u,'AREA_MAIN_HALL','campus',now(),now() from unnest(${lit(`{${bulk.join(',')}}`)}::uuid[]) u;`);
});
after(async () => {
  const ids = [admin, ...bulk, ...targets].map(lit).join(',');
  await query(`delete from public.world_online_sessions where user_id in (${ids});
    delete from private.world_session_kick_blocks where user_id in (${ids});
    delete from private.world_staff_assignments where user_id in (${ids});
    delete from auth.users where id in (${ids});`);
});

test('the roster reports exact totals and says when its lists were cut', async () => {
  const roster = await json(admin, 'public.get_world_session_admin_v1()');
  assert.equal(roster.accounts.length, 100, 'list stays capped at 100');
  assert.ok(roster.accountsTotal >= CROWD);
  assert.equal(roster.accountsTruncated, true);
  assert.equal(typeof roster.blockedTotal, 'number');
  assert.equal(roster.blockedTruncated, false);
  const listed = new Set(roster.accounts.map(row => row.userId));
  const unlisted = bulk.filter(id => !listed.has(id));
  assert.ok(unlisted.length >= CROWD - 100, 'some live accounts are not in the list');
  // The proof the list cannot give: the exact read still sees the live, unlisted account.
  const exact = await json(admin, `public.get_world_session_admin_target_v1(${lit(unlisted[0])})`);
  assert.equal(exact.userId, unlisted[0]);
  assert.equal(exact.sessionRows, 1);
  assert.equal(exact.activeSessions, 1);
  assert.equal(exact.blockedUntil, null);
});

test('after a kick the exact read proves the heartbeat rows are gone and the block is active', async () => {
  const target = bulk[0];
  const kicked = await json(admin, `public.kick_world_user_v1(${lit(target)},30)`);
  assert.equal(kicked.sessionsRemoved, 1);
  const exact = await json(admin, `public.get_world_session_admin_target_v1(${lit(target)})`);
  assert.equal(exact.sessionRows, 0);
  assert.equal(exact.activeSessions, 0);
  assert.ok(Date.parse(exact.blockedUntil) >= Date.parse(kicked.blockedUntil) - 1000);
  assert.equal((await asUser(admin, `select public.restore_world_user_v1(${lit(target)});`)).out.includes('t'), true);
  assert.equal((await json(admin, `public.get_world_session_admin_target_v1(${lit(target)})`)).blockedUntil, null);
});

test('stale heartbeat rows count as rows even though they are not active', async () => {
  const target = bulk[1];
  await query(`update public.world_online_sessions set last_seen_at=now()-interval '10 minutes' where user_id=${lit(target)}`);
  const exact = await json(admin, `public.get_world_session_admin_target_v1(${lit(target)})`);
  assert.equal(exact.sessionRows, 1, 'a stale row is still a row: only deletion proves "ended"');
  assert.equal(exact.activeSessions, 0);
});

test('the newest block is always listed first, so a fresh block is never the one cut by the cap', async () => {
  const blockedUsers = bulk.slice(2, 2 + 101);
  await query(`insert into private.world_session_kick_blocks(user_id,blocked_until,operator_id,created_at)
    select u, now()+interval '5 minutes', ${lit(admin)}, now()-interval '1 hour' from unnest(${lit(`{${blockedUsers.join(',')}}`)}::uuid[]) u;`);
  const fresh = bulk[bulk.length - 1];
  await asUser(admin, `select public.kick_world_user_v1(${lit(fresh)},1440);`);
  const roster = await json(admin, 'public.get_world_session_admin_v1()');
  assert.equal(roster.blocked.length, 100);
  assert.equal(roster.blockedTruncated, true);
  assert.ok(roster.blockedTotal >= 102);
  assert.equal(roster.blocked[0].userId, fresh, 'the block issued last is the first row');
  // Even for a block that IS cut from the list, the exact read still sees it.
  const cut = blockedUsers.find(id => !roster.blocked.some(row => row.userId === id));
  assert.ok(cut, 'some older block is not in the capped list');
  assert.ok((await json(admin, `public.get_world_session_admin_target_v1(${lit(cut)})`)).blockedUntil);
});

test('only an active world admin may use the exact read, and it validates its argument', async () => {
  const member = randomUUID(); targets.push(member);
  await account(member, 'rb_member');
  const denied = await asUser(member, `select public.get_world_session_admin_target_v1(${lit(bulk[0])});`, { fail: true });
  assert.match(denied.out, /unauthorized/);
  const anon = await psql(`begin; set local role anon; select public.get_world_session_admin_target_v1(${lit(bulk[0])}); commit;`, { fail: true });
  assert.equal(anon.ok, false);
  const bad = await asUser(admin, 'select public.get_world_session_admin_target_v1(null);', { fail: true });
  assert.match(bad.out, /INVALID_KICK_TARGET/);
});

test('the read-back functions change nothing', async () => {
  const fingerprint = () => query(`select md5(string_agg(t.name || ':' || t.digest, ',' order by t.name)) from (
    select n.nspname || '.' || c.relname as name,
      (xpath('/row/d/text()', query_to_xml(format(
        'select coalesce(md5(string_agg(x::text, '','' order by x::text)),'''') as d from %I.%I x',
        n.nspname, c.relname), false, true, '')))[1]::text as digest
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public','private','auth')) t;`);
  const before = await fingerprint();
  await json(admin, 'public.get_world_session_admin_v1()');
  await json(admin, `public.get_world_session_admin_target_v1(${lit(bulk[5])})`);
  assert.equal(await fingerprint(), before);
});
