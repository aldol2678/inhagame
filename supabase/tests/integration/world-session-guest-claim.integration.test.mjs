// Only a disposable loopback DB. F09 boundary: who owns a session UUID while it is a guest row, and what
// may happen when an account signs in on the same page. Real concurrent transactions, adversarial order.
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
const claims = (id, anonymous = false) => `set local role authenticated; set local request.jwt.claims=${lit(JSON.stringify(
  { sub: id, role: 'authenticated', is_anonymous: anonymous }))};`;
const guestClaims = 'set local role anon; set local request.jwt.claims=\'{"role":"anon"}\';';
const touch = (session, visitor = null) =>
  `select public.touch_world_online_session_v2(${lit(session)}, ${lit(visitor)}, 'AREA_MAIN_HALL', 'campus');`;
const asUser = (id, sql, opts, anonymous = false) => psql(`begin; ${claims(id, anonymous)} ${sql} commit;`, opts);
const asGuest = (sql, opts) => psql(`begin; ${guestClaims} ${sql} commit;`, opts);
const owner = async session => await query(`select coalesce((select user_id::text from public.world_online_sessions where session_id=${lit(session)}),'(guest)') where exists (select 1 from public.world_online_sessions where session_id=${lit(session)}) union all select 'none' where not exists (select 1 from public.world_online_sessions where session_id=${lit(session)})`);

const users = [], sessions = [];
const admin = randomUUID();
const newSession = () => { const id = randomUUID(); sessions.push(id); return id; };
async function user(label, { anonymous = false } = {}) {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},now(),${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(id)},${lit(label)},false);`);
  return id;
}
before(async () => {
  users.push(admin);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous)
    values (${lit(admin)},'authenticated','authenticated',${lit(`${admin}@example.test`)},now(),false);
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(admin)},'claim_admin',false);
    insert into private.world_staff_assignments(user_id,role,active) values (${lit(admin)},'world_admin',true);`);
});
after(async () => {
  const ids = users.map(lit).join(',');
  const sess = (sessions.length ? sessions : [randomUUID()]).map(lit).join(',');
  await query(`delete from public.world_online_sessions where user_id in (${ids}) or session_id in (${sess});
    delete from private.world_session_kick_blocks where user_id in (${ids});
    delete from private.world_staff_assignments where user_id in (${ids});
    delete from auth.users where id in (${ids});`);
});
const kick = target => asUser(admin, `select public.kick_world_user_v1(${lit(target)},5);`);
const restore = target => asUser(admin, `select public.restore_world_user_v1(${lit(target)});`);

test('two accounts racing to claim the same guest row: exactly one wins, the other is refused', async () => {
  const x = await user('claim_x'), y = await user('claim_y'), s = newSession();
  await asGuest(touch(s));
  const first = asUser(x, `${touch(s)} select pg_sleep(1.2);`, { fail: true });
  await delay(400);
  const second = await asUser(y, touch(s), { fail: true });
  assert.equal((await first).ok, true);
  assert.equal(second.ok, false);
  assert.match(second.out, /WORLD_SESSION_OWNER_MISMATCH/);
  assert.equal(await owner(s), x);
});

test('a guest heartbeat racing a sign-in claim can never erase the claim', async () => {
  const x = await user('claim_r'), s = newSession();
  await asGuest(touch(s));
  const claim = asUser(x, `${touch(s)} select pg_sleep(1.2);`, { fail: true });
  await delay(400);
  const guest = await asGuest(touch(s), { fail: true });
  await claim;
  assert.equal(guest.ok, false, 'the late guest write is refused once the row is owned');
  assert.match(guest.out, /WORLD_SESSION_OWNER_MISMATCH/);
  assert.equal(await owner(s), x);
});

test('an account claiming a guest row while it is being kicked leaves no row behind (claim first)', async () => {
  const x = await user('claim_k1'), s = newSession();
  await asGuest(touch(s));
  const claim = asUser(x, `${touch(s)} select pg_sleep(1.2);`, { fail: true });
  await delay(400);
  await kick(x);
  await claim;
  assert.equal(await owner(s), 'none', 'the kick removed the row the account had just claimed');
  await restore(x);
});

test('an account claiming a guest row while a kick transaction is open is refused (kick first)', async () => {
  const x = await user('claim_k2'), s = newSession();
  await asGuest(touch(s));
  const operator = psql(`begin; ${claims(admin)} select public.kick_world_user_v1(${lit(x)},5); select pg_sleep(1.2); commit;`);
  await delay(400);
  const claim = await asUser(x, touch(s), { fail: true });
  await operator;
  assert.equal(claim.ok, false);
  assert.match(claim.out, /WORLD_SESSION_REVOKED/);
  assert.equal(await owner(s), '(guest)', 'the guest row is untouched by the refused claim');
  await restore(x);
});

test('a blocked anonymous-auth identity is refused too, on both heartbeat versions', async () => {
  const anon = await user('anon_u', { anonymous: true });
  await kick(anon);
  for (const sql of [touch(newSession()), `select public.touch_world_online_session_v1(${lit(newSession())}, 'AREA_MAIN_HALL', 'campus');`]) {
    const result = await asUser(anon, sql, { fail: true }, true);
    assert.equal(result.ok, false);
    assert.match(result.out, /WORLD_SESSION_REVOKED/);
  }
  await restore(anon);
});

test('a claimed row can neither be downgraded to a guest nor moved to another account, in any order', async () => {
  const x = await user('claim_d1'), y = await user('claim_d2'), s = newSession();
  await asGuest(touch(s));
  await asUser(x, touch(s));
  for (const attempt of [() => asGuest(touch(s), { fail: true }), () => asUser(y, touch(s), { fail: true })]) {
    const result = await attempt();
    assert.equal(result.ok, false);
    assert.match(result.out, /WORLD_SESSION_OWNER_MISMATCH/);
  }
  assert.equal(await owner(s), x);
  await asUser(x, touch(s));
  assert.equal(await owner(s), x, 'the owner keeps working');
});

test('a refused takeover does not disturb the row it was aimed at', async () => {
  const x = await user('claim_s1'), y = await user('claim_s2'), s = newSession();
  await asUser(x, `select public.touch_world_online_session_v2(${lit(s)}, ${lit(randomUUID())}, 'AREA_MAIN_HALL', 'campus');`);
  const before = await query(`select visitor_id||'|'||place_zone_id||'|'||space||'|'||started_at from public.world_online_sessions where session_id=${lit(s)}`);
  const attack = await asUser(y, `select public.touch_world_online_session_v2(${lit(s)}, ${lit(randomUUID())}, 'AREA_AGORA_6_9', 'lobby');`, { fail: true });
  assert.equal(attack.ok, false);
  assert.equal(await query(`select visitor_id||'|'||place_zone_id||'|'||space||'|'||started_at from public.world_online_sessions where session_id=${lit(s)}`), before,
    'visitor, zone, space and start time of the victim row are unchanged');
});

test('a guest UUID is bound to the browser visitor id that created it (differing visitor ids are refused)', async () => {
  const x = await user('claim_v1'), s = newSession(), visitor = randomUUID(), other = randomUUID();
  await asGuest(touch(s, visitor));
  const guestHijack = await asGuest(touch(s, other), { fail: true });
  assert.equal(guestHijack.ok, false, 'another browser cannot rewrite a guest row it did not create');
  const claimHijack = await asUser(x, touch(s, other), { fail: true });
  assert.equal(claimHijack.ok, false, 'another browser cannot claim a guest row either');
  assert.equal(await query(`select visitor_id from public.world_online_sessions where session_id=${lit(s)}`), visitor);
  assert.equal(await owner(s), '(guest)');
  await asUser(x, touch(s, visitor));
  assert.equal(await owner(s), x, 'the same browser can still sign in on its own page');
});
