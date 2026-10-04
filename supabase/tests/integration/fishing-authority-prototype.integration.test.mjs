// Installs/removes a test-only schema on a disposable loopback DB. Every query
// launches a fresh psql connection, so ownership/outbox never depend on JS memory.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FISHING_SPOTS } from '../../../apps/world/src/activity/fishing-spots.js';
import { createPositionAuthorityPrototype } from '../../../apps/world/prototypes/fishing-position-authority.mjs';

const DB_URL = process.env.DB_URL, run = promisify(execFile);
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);
const lit = v => v === null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
async function query(sql) {
  const args = ['-Atq','-v','ON_ERROR_STOP=1','-c',sql];
  try { return (await run('psql',[DB_URL,...args])).stdout.trim(); }
  catch (error) {
    if (error.code !== 'ENOENT' || !process.env.PSQL_FALLBACK_CONTAINER) throw error;
    return (await run('docker',['exec',process.env.PSQL_FALLBACK_CONTAINER,'psql','-U','postgres','-d','postgres',...args])).stdout.trim();
  }
}
const json = async sql => JSON.parse((await query(sql)).split('\n').at(-1));
const roleSql = sql => `set role service_role; set request.jwt.claims='{"role":"service_role"}'; ${sql}`;
const rpc = (name,args) => json(roleSql(`select fishing_authority_prototype.${name}(${args.map(lit).join(',')})`));
const users = []; let installed = false, previous;
async function user({ anonymous = false, banned = false } = {}) {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,is_anonymous) values(${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values(${lit(id)},'낚시소유권',${banned})`);
  return id;
}
const acquire = (u,id = randomUUID()) => rpc('acquire',[u,id]);
const publish = (u,o,operation) => rpc('publish',[u,o.epoch,o.ownerToken,operation]);
const renew = (u,o) => rpc('renew',[u,o.epoch,o.ownerToken]);
const pending = (u,o) => rpc('pending',[u,o.epoch,o.ownerToken]);
const position = u => json(`select to_jsonb(p)||jsonb_build_object('revision',p.revision::text) from private.world_fishing_positions p where user_id=${lit(u)}`);
const timestamp = () => query("select clock_timestamp()-interval '100 milliseconds'");
async function enqueue(u,o,options = {}) {
  const args = [u,o.epoch,o.ownerToken,options.id ?? randomUUID(),options.x ?? FISHING_SPOTS[0].position.x,
    options.y ?? 1.15,options.z ?? FISHING_SPOTS[0].position.z,options.space ?? 'CAMPUS',options.mode ?? 'ON_FOOT',options.at ?? await timestamp()];
  return { args, row: await rpc('enqueue',args) };
}
before(async () => {
  assert.equal(await query("select to_regnamespace('fishing_authority_prototype') is null"),'t','never replace a preexisting fixture schema');
  await query(readFileSync(new URL('../../prototypes/fishing-authority-prototype.sql',import.meta.url),'utf8')); installed = true;
  previous = await json('select to_jsonb(r) from private.world_fishing_runtime r');
  await query(`update private.world_fishing_runtime set enabled=true,presence_required=true,
    policy='{"policyVersion":"fishing.fixture.durable","minWaitMs":1,"maxWaitMs":1,"responseWindowMs":10000,"attemptTtlMs":20000,"lifeXp":2}',minimum_start_interval_ms=1`);
});
after(async () => {
  if (previous) await query(`update private.world_fishing_runtime set enabled=${previous.enabled},presence_required=${previous.presence_required},
    policy=${previous.policy === null ? 'null' : `${lit(JSON.stringify(previous.policy))}::jsonb`},minimum_start_interval_ms=${previous.minimum_start_interval_ms}`);
  if (users.length) await query(`delete from auth.users where id in (${users.map(lit).join(',')})`);
  if (installed) {
    await query('drop schema fishing_authority_prototype cascade');
    assert.equal(await query("select to_regnamespace('fishing_authority_prototype') is null"),'t');
  }
});

test('fixture RLS/ACL denies all table access and player execution, including spoofed role claims', async () => {
  assert.equal(await query("select bool_and(relrowsecurity) from pg_class where relnamespace='fishing_authority_prototype'::regnamespace and relkind='r'"),'t');
  assert.equal(await query(`select bool_and(not has_table_privilege(r,t,p)) from
    unnest(array['anon','authenticated','service_role']) r,
    unnest(array['fishing_authority_prototype.owners','fishing_authority_prototype.claims','fishing_authority_prototype.outbox']) t,
    unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`),'t');
  assert.equal(await query(`select bool_and(not has_function_privilege(r,p.oid,'execute')) from pg_proc p,
    unnest(array['anon','authenticated']) r where p.pronamespace='fishing_authority_prototype'::regnamespace`),'t');
  const u = await user();
  await assert.rejects(query(`set role authenticated; set request.jwt.claims='{"role":"service_role"}'; select fishing_authority_prototype.acquire(${lit(u)},gen_random_uuid())`),/permission denied/);
  await assert.rejects(query(`select fishing_authority_prototype.acquire(${lit(u)},gen_random_uuid())`),/SERVER_ONLY/);
  await assert.rejects(acquire(await user({ anonymous: true })),/ACCOUNT_UNAVAILABLE/);
  await assert.rejects(acquire(await user({ banned: true })),/ACCOUNT_UNAVAILABLE/);
});

test('two workers competing for one account get one durable owner and replay never renews its lease', async () => {
  const u = await user(), request = randomUUID();
  const results = await Promise.allSettled([acquire(u,request),acquire(u)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(String(results.find(r=>r.status==='rejected').reason),/OWNER_BUSY/);
  // First request is not guaranteed to win; inspect its persisted claim without minting one.
  const owner = results.find(r=>r.status==='fulfilled').value;
  const winningId = await query(`select request_id from fishing_authority_prototype.claims where user_id=${lit(u)}`);
  const replay = await acquire(u,winningId);
  assert.equal(replay.status,'ALREADY_PROCESSED'); assert.equal(replay.ownerToken,owner.ownerToken);
  assert.equal(replay.sessionId,owner.sessionId); assert.equal(replay.leaseUntil,owner.leaseUntil);
  assert.equal((await position(u)).mode,'INELIGIBLE');
});

test('restart recovers immutable pending tuples and publication/receipt commit atomically under response loss', async () => {
  const u = await user(), request = randomUUID(), o = await acquire(u,request), item = await enqueue(u,o);
  const recovered = await acquire(u,request); // New database connection, no worker memory.
  assert.equal(recovered.sessionId,o.sessionId);
  assert.deepEqual(await pending(u,recovered),[item.row]);
  await publish(u,recovered,item.row.operationId); // Deliberately discard the successful response.
  const db = await position(u), retry = await publish(u,recovered,item.row.operationId);
  assert.equal(retry.status,'ALREADY_DELIVERED'); assert.equal(retry.revision,item.row.revision);
  assert.equal(retry.observedAt,item.row.observedAt); assert.deepEqual(await position(u),db);
  assert.deepEqual(await pending(u,recovered),[]);
  assert.equal((await rpc('enqueue',item.args)).status,'DELIVERED');
  for (const [index,value] of [[4,item.args[4]+1],[10,await timestamp()],[2,randomUUID()]]) {
    const altered=[...item.args]; altered[index]=value;
    await assert.rejects(rpc('enqueue',altered),/OUTBOX_CONFLICT/);
  }
});

test('concurrent allocation is monotonic; delayed lower revisions are superseded without refreshing proof', async () => {
  const u = await user(), o = await acquire(u), items = await Promise.all([enqueue(u,o),enqueue(u,o,{ x: 120 })]);
  items.sort((a,b)=>BigInt(a.row.revision)<BigInt(b.row.revision)?-1:1);
  assert.equal(BigInt(items[1].row.revision),BigInt(items[0].row.revision)+1n);
  assert.equal((await publish(u,o,items[1].row.operationId)).status,'DELIVERED');
  const accepted = await position(u);
  assert.equal((await publish(u,o,items[0].row.operationId)).status,'SUPERSEDED');
  assert.deepEqual(await position(u),accepted);
});

test('expired ownership takeover invalidates old proof and pending work; old tokens cannot renew or revoke replacement', async () => {
  const u = await user(), oldRequest = randomUUID(), old = await acquire(u,oldRequest);
  const sent = await enqueue(u,old); await publish(u,old,sent.row.operationId);
  const queued = await enqueue(u,old);
  await query(`update fishing_authority_prototype.owners set lease_until=clock_timestamp()-interval '1 second' where user_id=${lit(u)}`);
  assert.equal((await acquire(u,oldRequest)).status,'EXPIRED');
  const next = await acquire(u); assert.equal(BigInt(next.epoch),BigInt(old.epoch)+1n);
  assert.notEqual(next.sessionId,old.sessionId); assert.equal((await position(u)).mode,'INELIGIBLE');
  assert.ok(BigInt(next.revisionHigh)>BigInt(queued.row.revision));
  assert.equal((await acquire(u,oldRequest)).status,'FENCED');
  assert.equal((await publish(u,old,queued.row.operationId)).status,'FENCED');
  await assert.rejects(renew(u,old),/OWNER_FENCED/);
  await assert.rejects(enqueue(u,old),/OWNER_FENCED/);
  await assert.rejects(rpc('release',[u,old.epoch,old.ownerToken,randomUUID()]),/OWNER_FENCED/);
  assert.equal((await position(u)).session_id,next.sessionId);
});

test('renewal cannot revive expired ownership and different accounts cannot reuse capabilities', async () => {
  const u = await user(), other = await user(), o = await acquire(u);
  await assert.rejects(renew(other,o),/OWNER_FENCED/);
  const renewed = await renew(u,o); assert.equal(renewed.ownerToken,o.ownerToken);
  await query(`update fishing_authority_prototype.owners set lease_until=clock_timestamp()-interval '1 second' where user_id=${lit(u)}`);
  await assert.rejects(renew(u,o),/OWNER_FENCED/);
});

test('expired pending data cannot gain a new timestamp; delivered replay remains historical after five seconds', async () => {
  const u = await user(), o = await acquire(u), delivered = await enqueue(u,o);
  await publish(u,o,delivered.row.operationId); const accepted = await position(u);
  const expired = await enqueue(u,o);
  for (let i=0;i<6;i++) { await renew(u,o); await delay(950); }
  await renew(u,o);
  const result = await publish(u,o,expired.row.operationId);
  assert.equal(result.status,'EXPIRED'); assert.equal(result.observedAt,expired.row.observedAt);
  assert.equal((await publish(u,o,delivered.row.operationId)).status,'ALREADY_DELIVERED');
  assert.deepEqual(await position(u),accepted);
  await assert.rejects(json(roleSql(`select public.world_fishing_start_v1(${lit(u)},${lit(FISHING_SPOTS[0].sourceRef)},gen_random_uuid())`)),/FISHING_POSITION_STALE/);
});

test('invalid observation fields allocate nothing; bigint high water survives existing issuer data precisely', async () => {
  const u = await user();
  await json(roleSql(`select public.world_fishing_observe_position_v1(${lit(u)},gen_random_uuid(),9007199254740992,0,0,0,'CAMPUS','INELIGIBLE',clock_timestamp())`));
  const o = await acquire(u); assert.equal(o.revisionHigh,'9007199254740993');
  for (const options of [{ x: 'NaN' },{ z: 'Infinity' },{ space: 'INDOOR' },{ mode: 'MOUNTED' },
    { at: '2099-01-01T00:00:00Z' },{ at: '2000-01-01T00:00:00Z' }]) await assert.rejects(enqueue(u,o,options),/POSITION_INVALID|POSITION_STALE/);
  const item = await enqueue(u,o); assert.equal(item.row.revision,'9007199254740994');
  await publish(u,o,item.row.operationId); assert.equal((await position(u)).revision,item.row.revision);
});

test('transaction rollback cannot acknowledge an outbox delivery without its F3 write', async () => {
  const u = await user(), o = await acquire(u), item = await enqueue(u,o), initial = await position(u);
  await assert.rejects(query(roleSql(`begin; select fishing_authority_prototype.publish(${[u,o.epoch,o.ownerToken,item.row.operationId].map(lit).join(',')});
    do $$begin raise exception 'SIMULATED_CRASH'; end$$; commit;`)),/SIMULATED_CRASH/);
  assert.deepEqual(await position(u),initial); assert.equal((await pending(u,o))[0].status,'PENDING');
  assert.equal((await publish(u,o,item.row.operationId)).status,'DELIVERED');
});

test('release is durable/idempotent, invalidates evidence and cannot damage a later owner', async () => {
  const u = await user(), request = randomUUID(), o = await acquire(u,request), item = await enqueue(u,o);
  await publish(u,o,item.row.operationId); const releaseId = randomUUID();
  const released = await rpc('release',[u,o.epoch,o.ownerToken,releaseId]);
  assert.equal((await position(u)).mode,'INELIGIBLE'); assert.equal((await acquire(u,request)).status,'RELEASED');
  const next = await acquire(u), replacement = await position(u);
  const replay = await rpc('release',[u,o.epoch,o.ownerToken,releaseId]);
  assert.equal(replay.status,'ALREADY_RELEASED'); assert.equal(replay.observedAt,released.observedAt);
  assert.deepEqual(await position(u),replacement); assert.ok(BigInt(next.revisionHigh)>BigInt(released.revision));
});

test('input-driven movement feeds durable outbox and real F3 catch/settlement; release denies another cast', async () => {
  const u = await user(), o = await acquire(u); let mono = 0, wall;
  const authority = createPositionAuthorityPrototype({ verifyUser:()=>u,monotonicNow:()=>mono,wallNow:()=>wall,
    rpc: async (_,args) => {
      // Movement producer's ephemeral session/revision are not the durable wire authority.
      const queued = await enqueue(u,o,{ x:args.p_x,y:args.p_y,z:args.p_z,space:args.p_space,mode:args.p_mode,at:args.p_observed_at });
      const result = await publish(u,o,queued.row.operationId); return result.receipt;
    } });
  const connection = await authority.connect('authenticated movement fixture');
  for (let seq=1;seq<=12;seq++) {
    await renew(u,o); wall=Number(await query('select floor(extract(epoch from clock_timestamp())*1000)'))-100;
    connection.input({seq,moveX:0,moveZ:-1}); mono+=50; connection.advance(); await connection.flush();
  }
  const attempt = (await json(roleSql(`select public.world_fishing_start_v1(${lit(u)},${lit(FISHING_SPOTS[0].sourceRef)},gen_random_uuid())`))).attempt;
  await delay(5);
  const hook = await json(roleSql(`select public.world_fishing_input_v1(${[u,attempt.attemptId,attempt.sourceRef,attempt.nonce,'HOOK'].map(lit).join(',')})`));
  assert.equal(hook.attempt.status,'SUCCEEDED');
  await rpc('release',[u,o.epoch,o.ownerToken,randomUUID()]);
  await assert.rejects(json(roleSql(`select public.world_fishing_start_v1(${lit(u)},${lit(FISHING_SPOTS[0].sourceRef)},gen_random_uuid())`)),/FISHING_POSITION_INELIGIBLE/);
  const settle = () => json(roleSql(`select public.world_fishing_settle_v1(${lit(u)},${lit(attempt.attemptId)})`));
  const results = await Promise.all([settle(),settle()]); assert.equal(results.filter(r=>r.status==='SETTLED').length,1);
  const read = await json(roleSql(`select public.world_fishing_read_v1(${lit(u)},${lit(attempt.attemptId)})`));
  assert.equal(read.inventory.quantity,1); assert.equal(read.lifeSkill.totalXp,2);
});

test('account deletion removes owner, claim and outbox without leaving state for another account', async () => {
  const u = await user(), o = await acquire(u); await enqueue(u,o);
  await query(`delete from auth.users where id=${lit(u)}`);
  for (const table of ['owners','claims','outbox']) assert.equal(await query(`select count(*) from fishing_authority_prototype.${table} where user_id=${lit(u)}`),'0');
});
