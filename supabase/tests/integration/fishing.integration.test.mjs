// Only scripts/local-integration.mjs / a disposable loopback DB may run this fixture.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createFishingAttempt, resolveFishingAttempt, projectFishingAttempt, FISHING_SOURCES } from '../../../apps/world/src/activity/fishing-core.js';

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
const server = (name, args) => json(`set role service_role; set request.jwt.claims='{"role":"service_role"}'; select public.world_fishing_${name}_v1(${args.map(lit).join(',')});`);
const start = (user, source = FISHING_SOURCES[0], key = randomUUID()) => server('start', [user, source, key]);
const input = (user, attempt, action = 'HOOK') => server('input', [user, attempt.attemptId, attempt.sourceRef, attempt.nonce, action]);
const read = (user, id = null) => server('read', [user, id]);
const settle = (user, id) => server('settle', [user, id]);
const users = [], policy = { policyVersion: 'fishing.fixture.v1', minWaitMs: 1, maxWaitMs: 1,
  responseWindowMs: 10000, attemptTtlMs: 20000, lifeXp: 2 };
let previous;
async function user({ anonymous = false, banned = false } = {}) {
  const id = randomUUID(); users.push(id);
  await query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    (${lit(id)},'authenticated','authenticated',${lit(`${id}@example.test`)},now(),${anonymous});
    insert into public.profiles(user_id,nickname,is_banned) values (${lit(id)},'낚시테스트',${banned});`);
  return id;
}
async function configure(value = policy, interval = 1) {
  await query(`update private.world_fishing_runtime set enabled=true,policy=${lit(JSON.stringify(value))}::jsonb,minimum_start_interval_ms=${interval};`);
}
before(async () => {
  previous = await json(`select jsonb_build_object('runtime',to_jsonb(r),'discovery',c.status,'skill',s.status)
    from private.world_fishing_runtime r,private.world_collection_entry_catalog c,private.world_life_skill_catalog s
    where c.entry_id='collection.fish.carp' and s.skill_id='life.fishing';`);
  // Committed state since 20261004139000: Fishing ACTIVE with the candidate policy. The fixture
  // policy below is restored to it in after().
  assert.equal(previous.runtime.enabled, true);
  assert.equal(previous.runtime.policy.policyVersion, 'fishing.candidate.v1');
  assert.equal(previous.discovery, 'ACTIVE'); assert.equal(previous.skill, 'ACTIVE');
  await configure();
  await query(`update private.world_collection_entry_catalog set status='ACTIVE' where entry_id='collection.fish.carp';
    update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';`);
});
after(async () => {
  if (previous) await query(`update private.world_fishing_runtime set enabled=${previous.runtime.enabled},
    policy=${previous.runtime.policy === null ? 'null' : lit(JSON.stringify(previous.runtime.policy)) + '::jsonb'},
    minimum_start_interval_ms=${previous.runtime.minimum_start_interval_ms ?? 'null'};
    update private.world_collection_entry_catalog set status=${lit(previous.discovery)} where entry_id='collection.fish.carp';
    update private.world_life_skill_catalog set status=${lit(previous.skill)} where skill_id='life.fishing';`);
  if (users.length) await query(`delete from auth.users where id in (${users.map(lit).join(',')});`);
});

test('concurrent start/input/settle persist one result, one carp, one discovery and one XP entry', async () => {
  const actor = await user(), key = randomUUID();
  const starts = await Promise.all(Array.from({ length: 8 }, () => start(actor, FISHING_SOURCES[0], key)));
  assert.equal(starts.filter(r => r.status === 'STARTED').length, 1);
  const attempt = starts[0].attempt;
  for (const r of starts) assert.deepEqual(r.attempt, attempt);
  await assert.rejects(start(actor, FISHING_SOURCES[1]), /ATTEMPT_ALREADY_ACTIVE/);
  await assert.rejects(start(actor, FISHING_SOURCES[1], key), /IDEMPOTENCY_CONFLICT/);
  const full = await json(`select snapshot from private.world_fishing_attempt_snapshots where attempt_id=${lit(attempt.attemptId)};`);
  const core = createFishingAttempt({ request: { activityId: full.activityId, sourceRef: full.sourceRef, clientAttemptKey: key },
    actorUserId: actor, attemptId: full.attemptId, nonce: full.nonce, startedAtMs: full.startedAtMs, policy, biteRoll: 0.5 });
  assert.deepEqual(full, core);
  const inputs = await Promise.all(Array.from({ length: 8 }, () => input(actor, attempt)));
  assert.equal(inputs.filter(r => r.status === 'RESOLVED').length, 1);
  for (const r of inputs) assert.deepEqual(r.attempt, inputs[0].attempt);
  assert.equal(inputs[0].attempt.status, 'SUCCEEDED');
  const resolved = resolveFishingAttempt({ attempt: core, actorUserId: actor,
    request: { attemptId: attempt.attemptId, sourceRef: attempt.sourceRef, nonce: attempt.nonce, action: 'HOOK' },
    nowMs: inputs[0].attempt.result.resolvedAtMs });
  assert.deepEqual(inputs[0].attempt, projectFishingAttempt({ attempt: resolved, actorUserId: actor }));
  assert.equal((await read(actor, attempt.attemptId)).settlement, 'PENDING');
  const settled = await Promise.all(Array.from({ length: 8 }, () => settle(actor, attempt.attemptId)));
  assert.equal(settled.filter(r => r.status === 'SETTLED').length, 1);
  for (const r of settled) assert.deepEqual(r.receipt, settled[0].receipt);
  const current = await read(actor);
  assert.equal(current.inventory.quantity, 1); assert.equal(current.discovery.discoveryCount, 1);
  assert.equal(current.lifeSkill.totalXp, 2); assert.equal(current.lifeSkill.level, 1);
  assert.equal(current.settlement, 'SETTLED');
  assert.deepEqual(current.attempt, inputs[0].attempt);
  const counts = await json(`select jsonb_build_array(
    (select count(*) from private.world_item_grants where user_id=${lit(actor)}),
    (select count(*) from private.world_collection_discovery_events where user_id=${lit(actor)}),
    (select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(actor)}),
    (select count(*) from private.world_activity_settlements where attempt_id=${lit(attempt.attemptId)}));`);
  assert.deepEqual(counts, [1, 1, 1, 1]);
  // Finalize went through the Life -> Creature bridge in the same transaction (bridge row is COMING_SOON).
  assert.equal(await query(`select decision from private.world_life_creature_bridge_decisions where attempt_id=${lit(attempt.attemptId)};`), 'NOOP_INACTIVE');
  assert.equal(await query(`select count(*) from private.world_life_creature_activity_contexts where attempt_id=${lit(attempt.attemptId)};`), '1');
  await assert.rejects(query(`update private.world_fishing_attempt_snapshots set snapshot=snapshot where attempt_id=${lit(attempt.attemptId)};`), /FISHING_TERMINAL_IMMUTABLE/);
  await assert.rejects(query(`update private.world_activity_settlements set receipt=receipt where attempt_id=${lit(attempt.attemptId)};`), /ACTIVITY_SETTLEMENT_APPEND_ONLY/);
  // Ownership can become zero while discovery remains durable.
  await query(`select private.world_inventory_consume_v1(${lit(actor)},'material.fish_carp',1,'SYSTEM','f2.test',${lit(`fishing_consume:${attempt.attemptId}`)},null,null);`);
  const consumed = await read(actor);
  assert.equal(consumed.inventory.quantity, 0); assert.equal(consumed.discovery.discovered, true);
  assert.equal(consumed.discovery.discoveryCount, 1);
  assert.deepEqual((await settle(actor, attempt.attemptId)).receipt, settled[0].receipt);
  assert.equal((await read(actor)).inventory.quantity, 0);
});

test('failed settlement rolls all domains back; retry uses unchanged result and start policy', async () => {
  const actor = await user(), attempt = (await start(actor, FISHING_SOURCES[1])).attempt;
  const result = (await input(actor, attempt)).attempt;
  await configure({ ...policy, lifeXp: 99, policyVersion: 'fishing.fixture.v2' });
  await query("update private.world_life_skill_catalog set status='COMING_SOON' where skill_id='life.fishing';");
  try {
    await assert.rejects(settle(actor, attempt.attemptId), /LIFE_SKILL_INACTIVE/);
    const pending = await read(actor);
    assert.deepEqual(pending.attempt, result); assert.equal(pending.settlement, 'PENDING');
    assert.equal(pending.inventory.quantity, 0); assert.equal(pending.discovery.discovered, false);
    assert.equal(pending.lifeSkill.totalXp, 0);
    assert.deepEqual(await json(`select jsonb_build_array(
      (select count(*) from private.world_item_grants where user_id=${lit(actor)}),
      (select count(*) from private.world_collection_discovery_events where user_id=${lit(actor)}),
      (select count(*) from private.world_activity_settlements where attempt_id=${lit(attempt.attemptId)}));`), [0, 0, 0]);
  } finally {
    await query("update private.world_life_skill_catalog set status='ACTIVE' where skill_id='life.fishing';");
    await configure();
  }
  await Promise.all(Array.from({ length: 8 }, () => settle(actor, attempt.attemptId)));
  const current = await read(actor);
  assert.equal(current.inventory.quantity, 1); assert.equal(current.discovery.discoveryCount, 1);
  assert.equal(current.lifeSkill.totalXp, 2); assert.deepEqual(current.attempt, result);
});

test('inventory overflow preserves result and makes no discovery/XP/receipt; consume then retry', async () => {
  const actor = await user();
  await query(`select private.world_inventory_grant_v1(${lit(actor)},'material.fish_carp',99,'SYSTEM','f2.test',${lit(`fishing_fill:${actor}`)},null,null);`);
  const attempt = (await start(actor)).attempt, result = (await input(actor, attempt)).attempt;
  await assert.rejects(settle(actor, attempt.attemptId), /MAX_STACK_EXCEEDED/);
  const pending = await read(actor);
  assert.equal(pending.inventory.quantity, 99); assert.equal(pending.discovery.discoveryCount, 0);
  assert.equal(pending.lifeSkill.totalXp, 0); assert.equal(pending.settlement, 'PENDING');
  assert.deepEqual(pending.attempt, result);
  await query(`select private.world_inventory_consume_v1(${lit(actor)},'material.fish_carp',1,'SYSTEM','f2.test',${lit(`fishing_space:${actor}`)},null,null);`);
  await settle(actor, attempt.attemptId);
  assert.equal((await read(actor)).inventory.quantity, 99);
});

test('another account, bad nonce, banned and anonymous callers cannot read/resolve/settle', async () => {
  const actor = await user(), other = await user(), attempt = (await start(actor)).attempt;
  const fresh = await read(other); assert.equal(fresh.attempt, null); assert.equal(fresh.inventory.quantity, 0);
  for (const operation of [() => read(other, attempt.attemptId), () => input(other, attempt), () => settle(other, attempt.attemptId)]) {
    await assert.rejects(operation(), /ATTEMPT_NOT_FOUND/);
  }
  await assert.rejects(input(actor, { ...attempt, nonce: randomUUID() }), /FISHING_IDENTITY_MISMATCH/);
  for (const options of [{ anonymous: true }, { banned: true }]) {
    const unavailable = await user(options);
    await assert.rejects(read(unavailable), /ACCOUNT_UNAVAILABLE/);
    await assert.rejects(start(unavailable), /ACCOUNT_UNAVAILABLE/);
  }
  // A browser role cannot turn a forged JWT role claim into EXECUTE privilege.
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(query(`set role ${role}; set request.jwt.claims='{"role":"service_role"}';
      select public.world_fishing_settle_v1(${lit(actor)},${lit(attempt.attemptId)});`), /permission denied/);
  }
  await input(actor, attempt, 'CANCEL');
  await assert.rejects(settle(actor, attempt.attemptId), /FISHING_NOT_SUCCEEDED/);
});

test('HOOK/CANCEL race yields one immutable winner; opposing retry conflicts', async () => {
  const actor = await user(), attempt = (await start(actor)).attempt;
  const raced = await Promise.allSettled([input(actor, attempt), input(actor, attempt, 'CANCEL')]);
  assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(raced.find(r => r.status === 'rejected').reason), /TERMINAL_COMMAND_CONFLICT/);
  const winning = raced.find(r => r.status === 'fulfilled').value.attempt;
  assert.ok(['SUCCEEDED', 'CANCELLED'].includes(winning.status));
  const action = winning.status === 'SUCCEEDED' ? 'HOOK' : 'CANCEL';
  assert.deepEqual((await input(actor, attempt, action)).attempt, winning);
  assert.deepEqual((await start(actor, attempt.sourceRef, attempt.clientAttemptKey)).attempt, winning);
  if (winning.status === 'CANCELLED') await assert.rejects(settle(actor, attempt.attemptId), /FISHING_NOT_SUCCEEDED/);
});

test('early hook, missed window and read expiry never settle; replay after timeout does not reroll', async () => {
  const earlyUser = await user();
  await configure({ ...policy, minWaitMs: 5000, maxWaitMs: 5000 });
  try {
    const early = (await start(earlyUser)).attempt, result = (await input(earlyUser, early)).attempt;
    assert.equal(result.result.reason, 'PREMATURE_HOOK');
    await assert.rejects(settle(earlyUser, early.attemptId), /FISHING_NOT_SUCCEEDED/);
    assert.deepEqual((await input(earlyUser, early)).attempt, result);
  } finally { await configure(); }
  for (const mode of ['missed', 'expired']) {
    const actor = await user();
    await configure({ ...policy, responseWindowMs: 1, attemptTtlMs: mode === 'expired' ? 200 : 20000 });
    try {
      const attempt = (await start(actor)).attempt;
      await delay(mode === 'expired' ? 250 : 20);
      const result = mode === 'missed' ? (await input(actor, attempt)).attempt : (await read(actor)).attempt;
      assert.equal(result.status, mode === 'missed' ? 'FAILED' : 'EXPIRED');
      assert.equal(result.result.reason, mode === 'missed' ? 'MISSED_BITE' : 'ATTEMPT_EXPIRED');
      assert.deepEqual((await input(actor, attempt)).attempt, result);
      await assert.rejects(settle(actor, attempt.attemptId), /FISHING_NOT_SUCCEEDED/);
    } finally { await configure(); }
  }
});

test('cooldown is server enforced and replay survives disabled runtime; zero XP has no XP ledger', async () => {
  const actor = await user();
  await configure({ ...policy, lifeXp: 0 }, 60000);
  try {
    const attempt = (await start(actor)).attempt;
    await input(actor, attempt); await settle(actor, attempt.attemptId);
    assert.equal((await read(actor)).lifeSkill.totalXp, 0);
    assert.equal(await query(`select count(*) from private.world_life_skill_xp_transactions where user_id=${lit(actor)};`), '0');
    await assert.rejects(start(actor), /FISHING_RATE_LIMITED/);
    await query('update private.world_fishing_runtime set enabled=false;');
    assert.equal((await start(actor, attempt.sourceRef, attempt.clientAttemptKey)).status, 'ALREADY_PROCESSED');
    assert.equal((await settle(actor, attempt.attemptId)).status, 'ALREADY_PROCESSED');
    await assert.rejects(start(await user()), /FISHING_UNAVAILABLE/);
  } finally { await configure(); }
});

test('SQL result JSON conforms to F1 at exact bite/deadline/TTL boundaries for both sources', async () => {
  const actor = await user();
  for (const sourceRef of FISHING_SOURCES) {
    const attempt = createFishingAttempt({ request: { activityId: 'activity.fishing.inkyung', sourceRef, clientAttemptKey: randomUUID() },
      actorUserId: actor, attemptId: randomUUID(), nonce: randomUUID(), startedAtMs: 1000, policy, biteRoll: 0.5 });
    for (const [action, nowMs] of [['HOOK', attempt.biteAtMs - 1], ['HOOK', attempt.biteAtMs],
      ['HOOK', attempt.hookDeadlineMs - 1], ['HOOK', attempt.hookDeadlineMs], ['HOOK', attempt.expiresAtMs],
      ['CANCEL', attempt.biteAtMs], ['CANCEL', attempt.expiresAtMs]]) {
      const expected = resolveFishingAttempt({ attempt, actorUserId: actor, nowMs,
        request: { attemptId: attempt.attemptId, sourceRef, nonce: attempt.nonce, action } });
      const actual = await json(`select private.world_fishing_resolve_v1(${lit(JSON.stringify(attempt))}::jsonb,
        ${lit(action)},${nowMs});`);
      assert.deepEqual(actual, expected);
    }
  }
});
