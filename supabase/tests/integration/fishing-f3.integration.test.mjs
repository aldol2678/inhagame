// Only a disposable loopback DB. Trusted observations are issued by this server fixture,
// never by the player HTTP API, Realtime pose or a client heartbeat.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FISHING_SPOTS } from '../../../apps/world/src/activity/fishing-spots.js';
import { createPositionAuthorityPrototype } from '../../../apps/world/prototypes/fishing-position-authority.mjs';

const run = promisify(execFile), DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function query(sql) {
  const args = ['-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  let result;
  try { result = await run('psql', [DB_URL, ...args]); }
  catch (error) {
    if (error.code !== 'ENOENT' || !process.env.PSQL_FALLBACK_CONTAINER) throw error;
    result = await run('docker', ['exec', process.env.PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args]);
  }
  return result.stdout.trim();
}
const json = async sql => JSON.parse((await query(sql)).split('\n').at(-1));
const serverSql = expression => json(`set role service_role; set request.jwt.claims='{"role":"service_role"}'; select ${expression};`);
const rpc = (name, args) => serverSql(`public.world_fishing_${name}_v1(${args.map(lit).join(',')})`);
const start = (u, spot = FISHING_SPOTS[0], key = randomUUID()) => rpc('start', [u.id, spot.sourceRef, key]);
const input = (u, a, action = 'HOOK') => rpc('input', [u.id, a.attemptId, a.sourceRef, a.nonce, action]);
const users = [], policy = { policyVersion: 'fishing.fixture.f3', minWaitMs: 1, maxWaitMs: 1,
  responseWindowMs: 10000, attemptTtlMs: 20000, lifeXp: 2 };
let previous;
async function user({ anonymous = false, banned = false } = {}) {
  const u = { id: randomUUID(), session: randomUUID(), revision: 0 }; users.push(u.id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(u.id)},'authenticated','authenticated',${lit(`${u.id}@example.test`)},now(),${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(u.id)},'낚시F3',${banned});`);
  return u;
}
async function observe(u, spot = FISHING_SPOTS[0], { x = spot.position.x, y = 0, z = spot.position.z,
  session = u.session, revision = ++u.revision, space = 'CAMPUS', mode = 'ON_FOOT', at = 'clock_timestamp()' } = {}) {
  return serverSql(`public.world_fishing_observe_position_v1(${[u.id, session, revision, x, y, z, space, mode].map(lit).join(',')},${at})`);
}
async function noCatch(u) {
  assert.equal(await query(`select count(*) from private.world_activity_settlements where user_id=${lit(u.id)}`), '0');
  assert.equal(await query(`select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(u.id)}`), '0');
}
before(async () => {
  previous = await json('select to_jsonb(r) from private.world_fishing_runtime r');
  assert.equal(previous.presence_required, true);
  await query(`update private.world_fishing_runtime set enabled=true,presence_required=true,
    policy=${lit(JSON.stringify(policy))}::jsonb,minimum_start_interval_ms=1`);
});

test('input-driven authority prototype produces real F3 evidence; walking away blocks HOOK', async () => {
  const u = await user(); let monotonic = 0, wall;
  const dbClock = async () => { wall = Number(await query('select floor(extract(epoch from clock_timestamp())*1000)')) - 100; };
  await dbClock();
  const authority = createPositionAuthorityPrototype({ verifyUser: async () => u.id,
    monotonicNow: () => monotonic, wallNow: () => wall,
    rpc: (name, args) => {
      assert.equal(name, 'world_fishing_observe_position_v1');
      return serverSql(`public.${name}(${Object.values(args).map(lit).join(',')})`);
    } });
  const connection = await authority.connect('disposable authenticated connection');
  connection.advance(); await connection.flush();
  await assert.rejects(start(u), /FISHING_OUT_OF_RANGE/);
  async function walk(first, count, direction) {
    for (let seq = first; seq < first+count; seq++) {
      connection.input({ seq, moveX: 0, moveZ: direction }); monotonic += 50;
      await dbClock(); connection.advance(); await connection.flush();
    }
  }
  await walk(1, 12, -1);
  const attempt = (await start(u)).attempt;
  await walk(13, 12, 1);
  await assert.rejects(input(u, attempt), /FISHING_OUT_OF_RANGE/);
  await noCatch(u);
  assert.equal((await input(u, attempt, 'CANCEL')).attempt.status, 'CANCELLED');
  await walk(25, 12, -1);
  const caught = (await start(u)).attempt;
  await delay(5);
  assert.equal((await input(u, caught)).attempt.status, 'SUCCEEDED');
  await rpc('settle', [u.id, caught.attemptId]);
  const replay = await rpc('settle', [u.id, caught.attemptId]);
  assert.equal(replay.status, 'ALREADY_PROCESSED');
  const caughtRead = await rpc('read', [u.id, caught.attemptId]);
  assert.equal(caughtRead.inventory.quantity, 1);
  assert.equal(caughtRead.lifeSkill.totalXp, 2);
  connection.disconnect(); await dbClock(); connection.advance(); await connection.flush();
  const row = await json(`select to_jsonb(p) from private.world_fishing_positions p where user_id=${lit(u.id)}`);
  assert.equal(row.mode, 'INELIGIBLE');
  assert.equal(row.session_id, connection.snapshot().sessionId);
});
after(async () => {
  if (previous) await query(`update private.world_fishing_runtime set enabled=${previous.enabled},presence_required=${previous.presence_required},
    policy=${previous.policy === null ? 'null' : `${lit(JSON.stringify(previous.policy))}::jsonb`},
    minimum_start_interval_ms=${previous.minimum_start_interval_ms ?? 'null'}`);
  if (users.length) await query(`delete from auth.users where id in (${users.map(lit).join(',')})`);
});

test('missing, stale, ineligible and remote evidence cannot create an attempt', async () => {
  const u = await user();
  await assert.rejects(start(u), /FISHING_POSITION_UNAVAILABLE/);
  for (const [options, error] of [[{ x: 0, z: 0 }, 'FISHING_OUT_OF_RANGE'], [{ y: 5 }, 'FISHING_OUT_OF_RANGE'],
    [{ space: 'OTHER' }, 'FISHING_POSITION_INELIGIBLE'], [{ mode: 'INELIGIBLE' }, 'FISHING_POSITION_INELIGIBLE']]) {
    await observe(u, FISHING_SPOTS[0], options);
    await assert.rejects(start(u), new RegExp(error));
  }
  await observe(u);
  await query(`update private.world_fishing_positions set observed_at=clock_timestamp()-interval '6 seconds' where user_id=${lit(u.id)}`);
  await assert.rejects(start(u), /FISHING_POSITION_STALE/);
  assert.equal(await query(`select count(*) from private.world_activity_attempts where user_id=${lit(u.id)}`), '0');
  await noCatch(u);
});

test('publication is server-only, finite, fresh and monotonic across sessions', async () => {
  const u = await user();
  await assert.rejects(query(`set role authenticated; set request.jwt.claims='{"role":"service_role"}';
    select public.world_fishing_observe_position_v1(${[u.id,u.session,1,0,0,0,'CAMPUS','ON_FOOT'].map(lit).join(',')},clock_timestamp())`), /permission denied/);
  for (const options of [{ x: 'NaN' }, { x: 'Infinity' }, { y: '-Infinity' }, { session: null }, { revision: 0 },
    { at: "clock_timestamp()+interval '1 second'" }, { space: 'INDOOR' }, { mode: 'MOUNTED' }]) {
    await assert.rejects(observe(u, FISHING_SPOTS[0], options), /FISHING_POSITION_INVALID/);
  }
  await assert.rejects(observe(u, FISHING_SPOTS[0], { at: "clock_timestamp()-interval '6 seconds'" }), /FISHING_POSITION_STALE/);
  assert.equal((await observe(u)).status, 'OBSERVED');
  const old = await json(`select to_jsonb(p) from private.world_fishing_positions p where user_id=${lit(u.id)}`);
  assert.equal((await observe(u, FISHING_SPOTS[0], { revision: old.revision-1 })).status, 'STALE');
  assert.equal((await observe(u, FISHING_SPOTS[0], { revision: old.revision, at: lit(old.observed_at) })).status, 'ALREADY_PROCESSED');
  assert.equal((await json(`select to_jsonb(p) from private.world_fishing_positions p where user_id=${lit(u.id)}`)).observed_at, old.observed_at);
  await assert.rejects(observe(u, FISHING_SPOTS[0], { revision: old.revision, x: 0, at: lit(old.observed_at) }), /FISHING_POSITION_CONFLICT/);
  await assert.rejects(observe(await user({ banned: true })), /ACCOUNT_UNAVAILABLE/);
  await assert.rejects(observe(await user({ anonymous: true })), /ACCOUNT_UNAVAILABLE/);
});

test('competing accounts get one atomic lease; the other bank stays independently usable', async () => {
  const pair = [await user(), await user()];
  await Promise.all(pair.map(u => observe(u)));
  const results = await Promise.allSettled(pair.map(u => start(u)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winnerIndex = results.findIndex(r => r.status === 'fulfilled'), loserIndex = 1-winnerIndex;
  assert.match(String(results[loserIndex].reason), /FISHING_SPOT_OCCUPIED/);
  const winner = pair[winnerIndex], loser = pair[loserIndex], a = results[winnerIndex].value.attempt;
  assert.equal(await query(`select count(*) from private.world_fishing_spot_leases where source_ref=${lit(a.sourceRef)}`), '1');
  await observe(loser, FISHING_SPOTS[1]);
  const b = (await start(loser, FISHING_SPOTS[1])).attempt;
  await assert.rejects(start(winner, FISHING_SPOTS[1]), /ATTEMPT_ALREADY_ACTIVE/);
  // Leaving the bank never prevents cancellation from freeing its seat.
  await observe(winner, FISHING_SPOTS[0], { x: 0, z: 0 });
  assert.equal((await input(winner, a, 'CANCEL')).attempt.status, 'CANCELLED');
  await query(`delete from private.world_fishing_positions where user_id=${lit(loser.id)}`);
  await input(loser, b, 'CANCEL');
  assert.equal(await query('select count(*) from private.world_fishing_spot_leases'), '0');
  await noCatch(winner); await noCatch(loser);
});

test('cast replay survives evidence loss; HOOK rechecks location and releases the lease once', async () => {
  const u = await user(), key = randomUUID(); await observe(u);
  const a = (await start(u, FISHING_SPOTS[0], key)).attempt;
  await query(`delete from private.world_fishing_positions where user_id=${lit(u.id)}`);
  assert.equal((await start(u, FISHING_SPOTS[0], key)).attempt.attemptId, a.attemptId);
  await assert.rejects(input(u,a), /FISHING_POSITION_UNAVAILABLE/);
  await observe(u, FISHING_SPOTS[0], { x: 0, z: 0 });
  await assert.rejects(input(u,a), /FISHING_OUT_OF_RANGE/);
  await observe(u);
  await query(`update private.world_fishing_positions set observed_at=clock_timestamp()-interval '6 seconds' where user_id=${lit(u.id)}`);
  await assert.rejects(input(u,a), /FISHING_POSITION_STALE/);
  await noCatch(u);
  await observe(u);
  await delay(5);
  assert.equal((await input(u,a)).attempt.status, 'SUCCEEDED');
  assert.equal(await query(`select count(*) from private.world_fishing_spot_leases where user_id=${lit(u.id)}`), '0');
  await query(`delete from private.world_fishing_positions where user_id=${lit(u.id)}`);
  assert.equal((await input(u,a)).status, 'ALREADY_PROCESSED');
  const settled = await Promise.all([rpc('settle',[u.id,a.attemptId]),rpc('settle',[u.id,a.attemptId])]);
  assert.equal(settled.filter(s => s.status === 'SETTLED').length, 1);
  const read = await rpc('read',[u.id,a.attemptId]);
  assert.equal(read.inventory.quantity, 1); assert.equal(read.discovery.discoveryCount, 1); assert.equal(read.lifeSkill.totalXp, 2);
  assert.equal(await query(`select count(*) from private.world_activity_settlements where user_id=${lit(u.id)}`), '1');
  assert.equal(await query(`select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(u.id)}`), '1');
  assert.equal(await query(`select count(*) from private.world_item_grants where user_id=${lit(u.id)}`), '1');
  assert.equal(await query(`select count(*) from private.world_collection_discovery_events where user_id=${lit(u.id)}`), '1');
});

test('a different trusted session or lost lease cannot hook; cancellation recovers', async () => {
  const u = await user(); await observe(u); let a = (await start(u)).attempt;
  u.session=randomUUID(); await observe(u);
  await assert.rejects(input(u,a), /FISHING_SESSION_CHANGED/);
  await input(u,a,'CANCEL');
  await delay(5); await observe(u); a=(await start(u)).attempt;
  await query(`delete from private.world_fishing_spot_leases where user_id=${lit(u.id)}`);
  await assert.rejects(input(u,a), /FISHING_LEASE_LOST/);
  await input(u,a,'CANCEL'); await noCatch(u);
});

test('expired occupancy is reclaimable; the old attempt cannot release the new seat', async () => {
  const aUser=await user(), bUser=await user();
  await query(`update private.world_fishing_runtime set policy=${lit(JSON.stringify({ ...policy, responseWindowMs: 100, attemptTtlMs: 300 }))}::jsonb`);
  try {
    await observe(aUser); const a=(await start(aUser)).attempt;
    await delay(350);
    await query(`update private.world_fishing_runtime set policy=${lit(JSON.stringify(policy))}::jsonb`);
    await observe(bUser); const b=(await start(bUser)).attempt;
    await query(`delete from private.world_fishing_positions where user_id=${lit(aUser.id)}`);
    assert.equal((await input(aUser,a)).attempt.status,'EXPIRED');
    assert.equal(await query(`select attempt_id from private.world_fishing_spot_leases where source_ref=${lit(b.sourceRef)}`),b.attemptId);
    await input(bUser,b,'CANCEL'); await noCatch(aUser);
  } finally {
    await query(`update private.world_fishing_runtime set policy=${lit(JSON.stringify(policy))}::jsonb`);
  }
});

test('deleting an account cascades its trusted evidence and occupied seat', async () => {
  const u=await user(); await observe(u); await start(u);
  await query(`delete from auth.users where id=${lit(u.id)}`);
  for (const table of ['world_fishing_positions','world_fishing_spot_leases']) {
    assert.equal(await query(`select count(*) from private.${table} where user_id=${lit(u.id)}`),'0');
  }
});
