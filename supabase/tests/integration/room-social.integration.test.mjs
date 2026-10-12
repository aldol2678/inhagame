// Real PostgreSQL processes against the fully replayed, disposable Supabase local stack.
// The lock gate observes every distinct backend waiting before releasing competing RPCs.
// This proves database contention, not live Realtime WebSocket delivery or a production rollout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgHarness, lit, ROOM_ID } from '../../../scripts/room-social-pg-harness.mjs';
import { encodeAction, validateAction, validatePresence, EMOTE_IDS } from '../../../apps/world/src/network/protocol.js';

const db = createPgHarness();
const users = Array.from({ length: 8 }, () => randomUUID());
const userList = users.map(lit).join(',');
const sessionIds = new Set();
const freshSession = () => { const id = randomUUID(); sessionIds.add(id); return id; };
const call = (name, args) => `public.${name}(${args.map(value => value === null ? 'null' : lit(value)).join(',')})`;
const rpc = (user, name, args) => db.asUser(user, `select ${call(name, args)}`);
const join = async user => {
  const sessionId = freshSession();
  const result = await rpc(user, 'join_world_club_room_v1', [ROOM_ID, sessionId]);
  assert.equal(result.allowed, true, JSON.stringify({allowed:result.allowed,reason:result.reason}));
  assert.ok(result.participants.every(p => validatePresence(p).ok));
  return sessionId;
};
const liveCount = () => db.json(`select count(*)::int from private.world_club_room_sessions where room_id=${lit(ROOM_ID)}`);
const chatJoin = (user, sessionId) => rpc(user, 'join_world_room_chat_v1', ['club', ROOM_ID, sessionId]);

test.before(async () => {
  const versions = await db.json("select jsonb_agg(version order by version) from supabase_migrations.schema_migrations");
  for (const version of ['20261001213132', '20261012010000', '20261012011000']) assert.ok(versions.includes(version), `full replay missing ${version}`);
  assert.equal(await liveCount(), 0, 'room-social suite must start in an empty disposable room');
  assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'), false,
    'candidate activation must remain CLOSED outside the isolated fixture');
  await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    ${users.map(id => `(${lit(id)},'authenticated','authenticated',${lit(`room-social-${id}@example.test`)},now(),false)`).join(',')};
    insert into public.profiles(user_id,nickname,is_banned) values
    ${users.map((id, index) => `(${lit(id)},${lit(`방검증${index}`)},false)`).join(',')};`);
});

test.beforeEach(async () => {
  await db.query(`delete from private.world_club_room_sessions where user_id in (${userList});
    delete from private.world_room_chat_sessions where user_id in (${userList});
    delete from private.world_room_chat_limits where user_id in (${userList});
    update private.world_club_room_session_ids set created_at=clock_timestamp()-interval '2 seconds' where user_id in (${userList});
    update private.world_room_chat_config set enabled=false where singleton;`);
});

test.after(async () => {
  // Only this suite's synthetic identities and topics are removed. The default feature flag is restored.
  await db.query(`update private.world_room_chat_config set enabled=false where singleton;
    delete from realtime.messages where topic in (
      select 'world:room-chat:' || id::text from private.world_room_chat_sessions where user_id in (${userList})
      union all select 'world:club:' || room_id || ':' || session_id::text from private.world_club_room_session_ids where user_id in (${userList}));
    delete from auth.users where id in (${userList});
    delete from private.world_club_room_session_ids where user_id in (${userList});`);
  assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'), false);
  assert.equal(await db.json(`select count(*)::int from auth.users where id in (${userList})`), 0);
});

test('replayed authority is CLOSED and clients cannot mutate metadata or forge provider publications', async () => {
  const permissions = await db.json(`select jsonb_build_object(
    'clientConfig',has_table_privilege('authenticated','private.world_room_chat_config','update'),
    'clientMembership',has_table_privilege('authenticated','private.world_club_room_sessions','insert'),
    'clientLedger',has_table_privilege('authenticated','private.world_club_room_session_ids','insert'),
    'clientChatRows',has_table_privilege('authenticated','private.world_room_chat_sessions','select'),
    'clientFanout',has_function_privilege('authenticated','private.world_club_room_fanout_v1(text,uuid,text,jsonb,jsonb)','execute'))`);
  assert.ok(Object.values(permissions).every(value => value === false), JSON.stringify(permissions));
  const columns = await db.json(`select jsonb_agg(column_name order by column_name) from information_schema.columns
    where table_schema='private' and table_name in ('world_room_chat_config','world_room_chat_sessions','world_room_chat_limits')`);
  assert.ok(columns.every(name => !['text', 'body', 'message', 'payload', 'history'].includes(name)), 'application authority stores no message body');
  const session = await join(users[0]);
  assert.equal((await chatJoin(users[0], session)).allowed, false, 'room admission cannot enable the closed chat feature');
  assert.equal(await db.json('select private.world_room_publisher_safe_v1()'), true);
  await db.query(`begin; set local role authenticated;
    select realtime.send('{"forged":true}'::jsonb,'room_chat_v1','world:room-chat:forged',true); commit;`);
  assert.equal(await db.json("select count(*)::int from realtime.messages where topic='world:room-chat:forged'"),0,
    'provider RPC success-looking response must produce zero forged delivery rows');
});

test('seven independently blocked PostgreSQL admissions commit exactly six members', async t => {
  const operations = users.slice(0, 7).map(userId => ({ userId,
    expression: call('join_world_club_room_v1', [ROOM_ID, freshSession()]) }));
  const { values, contention } = await db.race(operations, 'capacity');
  assert.equal(values.filter(value => value.allowed).length, 6, JSON.stringify(values.map(({inboxNonce,...value})=>value)));
  assert.deepEqual(values.filter(value => !value.allowed).map(value => value.reason), ['ROOM_FULL']);
  assert.equal(await liveCount(), 6);
  t.diagnostic(JSON.stringify({ case: 'seven-admissions', independentBackends: contention.length, allObservedLockWaiting: true }));
});

test('two contenders for the last capacity slot cannot exceed six', async t => {
  for (const user of users.slice(0, 5)) await join(user);
  const operations = users.slice(5, 7).map(userId => ({ userId,
    expression: call('join_world_club_room_v1', [ROOM_ID, freshSession()]) }));
  const { values, contention } = await db.race(operations, 'last-slot');
  assert.equal(values.filter(value => value.allowed).length, 1);
  assert.equal(values.find(value => !value.allowed).reason, 'ROOM_FULL');
  assert.equal(await liveCount(), 6);
  t.diagnostic(JSON.stringify({ case: 'last-slot', independentBackends: contention.length, allObservedLockWaiting: true }));
});

test('all six chairs have one winner under real two-account claim contention', async t => {
  const pair = users.slice(0, 2), sessions = await Promise.all(pair.map(join));
  for (const seat of ['chair_s0', 'chair_n0', 'chair_s1', 'chair_n1', 'chair_s2', 'chair_n2']) {
    for (let i = 0; i < pair.length; i++) await rpc(pair[i], 'heartbeat_world_club_room_v1', [ROOM_ID, sessions[i]]);
    const operations = pair.map((userId, i) => ({ userId,
      expression: call('claim_world_club_room_seat_v1', [ROOM_ID, sessions[i], seat]) }));
    const { values, contention } = await db.race(operations, `seat-${seat}`);
    const winner = values.findIndex(value => value.claimed);
    assert.equal(values.filter(value => value.claimed).length, 1, JSON.stringify(values.map(({inboxNonce,...value})=>value)));
    assert.equal(values.find(value => !value.claimed).reason, 'SEAT_TAKEN');
    assert.equal(await db.json(`select count(*)::int from private.world_club_room_sessions where room_id=${lit(ROOM_ID)} and seat_id=${lit(seat)}`), 1);
    assert.equal((await rpc(pair[winner], 'release_world_club_room_seat_v1', [ROOM_ID, sessions[winner], seat])).released, true);
    t.diagnostic(JSON.stringify({ case: seat, independentBackends: contention.length, allObservedLockWaiting: true }));
  }
});

test('competing replacement UUIDs preserve one account admission; stale leave cannot erase it', async () => {
  const user = users[0], oldSession = await join(user);
  await db.query(`update private.world_club_room_session_ids set created_at=clock_timestamp()-interval '2 seconds' where user_id=${lit(user)}`);
  const replacementIds = [freshSession(), freshSession()];
  const { values } = await db.race(replacementIds.map(id => ({ userId: user,
    expression: call('join_world_club_room_v1', [ROOM_ID, id]) })), 'replacement');
  assert.equal(values.filter(value => value.allowed).length, 1);
  assert.equal(values.find(value => !value.allowed).reason, 'JOIN_COOLDOWN');
  const current = replacementIds[values.findIndex(value => value.allowed)];
  assert.equal((await rpc(user, 'leave_world_club_room_v1', [ROOM_ID, oldSession])).allowed, false);
  assert.equal((await rpc(user, 'heartbeat_world_club_room_v1', [ROOM_ID, current])).allowed, true);
  assert.equal(await liveCount(), 1);
  assert.equal((await rpc(user, 'join_world_club_room_v1', [ROOM_ID, oldSession])).reason, 'SESSION_REUSED');
});

test('expired admission and chair are reclaimed without reviving the old inbox', async () => {
  const sessions = [];
  for (const user of users.slice(0, 6)) sessions.push(await join(user));
  assert.equal((await rpc(users[0], 'claim_world_club_room_seat_v1', [ROOM_ID, sessions[0], 'chair_s0'])).claimed, true);
  await db.query(`update private.world_club_room_sessions set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=${lit(users[0])}`);
  const newcomer = await join(users[6]);
  assert.equal((await rpc(users[6], 'claim_world_club_room_seat_v1', [ROOM_ID, newcomer, 'chair_s0'])).claimed, true);
  assert.equal((await rpc(users[0], 'heartbeat_world_club_room_v1', [ROOM_ID, sessions[0]])).allowed, false);
  assert.equal(await db.asUser(users[0], `select public.can_access_world_club_room_realtime_v1(${lit(`world:club:${ROOM_ID}:${sessions[0]}`)})`), false);
  assert.equal(await liveCount(), 6);
});

test('chat rate limit serializes actual transactions and survives fresh chat leases', async t => {
  const user = users[0], session = await join(user);
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  try {
    const lease = await chatJoin(user, session); assert.equal(lease.allowed, true);
    const { values, contention } = await db.race(Array.from({ length: 4 }, (_, i) => ({ userId: user,
      expression: call('send_world_room_chat_v1', [lease.leaseId, `동시 채팅 ${i}`]) })), 'chat-rate', {
      gateQuery: `select id from private.world_room_chat_sessions where id=${lit(lease.leaseId)} for update`
    });
    assert.equal(values.filter(value => value.ok).length, 3, JSON.stringify(values.map(({inboxNonce,...value})=>value)));
    assert.equal(values.find(value => !value.ok).reason, 'rate_limited');
    const next = await chatJoin(user, session);
    assert.notEqual(next.leaseId, lease.leaseId);
    assert.equal((await rpc(user, 'send_world_room_chat_v1', [next.leaseId, '재입장 우회'])).reason, 'rate_limited');
    assert.equal((await rpc(users[1], 'send_world_room_chat_v1', [next.leaseId, '다른 계정'])).ok, false);
    assert.equal((await rpc(user, 'leave_world_club_room_v1', [ROOM_ID, session])).allowed, true);
    assert.equal((await rpc(user, 'renew_world_room_chat_v1', [next.leaseId])).allowed, false);
    t.diagnostic(JSON.stringify({ case: 'chat-rate', independentBackends: contention.length, allObservedLockWaiting: true }));
  } finally { await db.query('update private.world_room_chat_config set enabled=false where singleton'); }
});

test('production numeric actions survive actual provider SQL insertion and client decoding', async () => {
  const sender = users[0], recipient = users[1];
  const senderSession = await join(sender), recipientSession = await join(recipient);
  const topic = `world:club:${ROOM_ID}:${recipientSession}`;
  const actions = [encodeAction(0, 'jump'), ...EMOTE_IDS.map((emote, i) => encodeAction(i + 1, 'emote', { emote }))];
  for (const action of actions) {
    await db.query(`update private.world_club_room_sessions set last_action_at=null where user_id=${lit(sender)}`);
    const result = await rpc(sender, 'publish_world_club_room_v1', [ROOM_ID, senderSession, 'action', JSON.stringify(action)]);
    assert.equal(result.sent, true, JSON.stringify({allowed:result.allowed,reason:result.reason}));
    const envelopes = await db.json(`select coalesce(jsonb_agg(payload),'[]'::jsonb) from realtime.messages
      where topic=${lit(topic)} and payload->>'event'='action' and payload#>>'{p,id}'=${lit(action.id)}`);
    assert.equal(envelopes.length, 1, 'actual provider table contains exactly this numeric action');
    assert.equal(validateAction(envelopes[0].p).ok, true); assert.deepEqual(envelopes[0].p, action);
    assert.equal(validatePresence(envelopes[0].presence).ok, true);
    assert.equal(envelopes[0].presence.userId, sender);
  }
  await db.query(`delete from realtime.messages where topic=${lit(topic)}`);
});
