// Real PostgreSQL processes against the fully replayed, disposable Supabase local stack.
// The lock gate observes every distinct backend waiting before releasing competing RPCs.
// This proves database contention, not live Realtime WebSocket delivery or a production rollout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgHarness, lit, ROOM_ID, waitUntil } from '../../../scripts/room-social-pg-harness.mjs';
import { encodeAction, validateAction, validatePresence, EMOTE_IDS } from '../../../apps/world/src/network/protocol.js';

const db = createPgHarness();
const users = Array.from({ length: 8 }, () => randomUUID());
const userList = users.map(lit).join(',');
const sessionIds = new Set(), admissions = new Map(), chatTopics = new Set();
const freshSession = () => { const id = randomUUID(); sessionIds.add(id); return id; };
const call = (name, args) => `public.${name}(${args.map(value => value === null ? 'null' : lit(value)).join(',')})`;
const rpc = (user, name, args) => db.asUser(user, `select ${call(name, args)}`);
const join = async user => {
  const sessionId = freshSession();
  const result = await rpc(user, 'join_world_club_room_v1', [ROOM_ID, sessionId]);
  assert.equal(result.allowed, true, JSON.stringify({allowed:result.allowed,reason:result.reason}));
  assert.ok(result.participants.every(p => validatePresence(p).ok));
  admissions.set(result.admissionId, result);
  return result.admissionId;
};
const liveCount = () => db.json(`select count(*)::int from private.world_club_room_sessions where room_id=${lit(ROOM_ID)}`);
const chatJoin = async (user, admissionId) => { const result = await rpc(user, 'join_world_room_chat_v1', ['club', ROOM_ID, admissions.get(admissionId).sessionId, admissionId]); if(result.allowed) chatTopics.add(result.topic); return result; };

test.before(async () => {
  const versions = await db.json("select jsonb_agg(version order by version) from supabase_migrations.schema_migrations");
  for (const version of ['20261001213132', '20261012023000', '20261012023100']) assert.ok(versions.includes(version), `full replay missing ${version}`);
  assert.equal(await db.json('select enabled from private.world_club_rooms'),false,'club starts CLOSED');
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
    delete from private.world_club_room_admission_limits where user_id in (${userList});
    select private.world_room_cleanup_v1();
    update private.world_room_chat_config set enabled=false where singleton;
    update private.world_club_rooms set enabled=true;`);
});

test.after(async () => {
  // Only this suite's synthetic identities and topics are removed. The default feature flag is restored.
  await db.query(`update private.world_room_chat_config set enabled=false where singleton;
    update private.world_club_rooms set enabled=false;
    delete from realtime.messages where topic in (${[...admissions.values()].map(v=>v.topic).concat([...chatTopics]).map(lit).join(',') || "''"});
    delete from auth.users where id in (${userList});
    delete from private.world_club_room_admission_limits where user_id in (${userList});`);
  assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'), false);
  assert.equal(await db.json(`select count(*)::int from auth.users where id in (${userList})`), 0);
});

test('replayed authority is CLOSED and clients cannot mutate metadata or forge provider publications', async () => {
  const permissions = await db.json(`select jsonb_build_object(
    'clientConfig',has_table_privilege('authenticated','private.world_room_chat_config','update'),
    'clientMembership',has_table_privilege('authenticated','private.world_club_room_sessions','insert'),
    'clientLedger',has_table_privilege('authenticated','private.world_club_room_admission_limits','insert'),
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
  await db.query(`update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds' where user_id=${lit(user)}`);
  const replacementIds = [freshSession(), freshSession()];
  const { values } = await db.race(replacementIds.map(id => ({ userId: user,
    expression: call('join_world_club_room_v1', [ROOM_ID, id]) })), 'replacement');
  assert.equal(values.filter(value => value.allowed).length, 1);
  assert.equal(values.find(value => !value.allowed).reason, 'JOIN_COOLDOWN');
  const current = values.find(value => value.allowed).admissionId;
  admissions.set(current,values.find(value => value.allowed));
  assert.equal((await rpc(user, 'leave_world_club_room_v1', [ROOM_ID, oldSession])).allowed, false);
  assert.equal((await rpc(user, 'heartbeat_world_club_room_v1', [ROOM_ID, current])).allowed, true);
  assert.equal(await liveCount(), 1);
  assert.equal((await rpc(user, 'join_world_club_room_v1', [ROOM_ID, admissions.get(oldSession).sessionId])).reason, 'JOIN_COOLDOWN');
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

test('chat send waiting on its lease row rejects expiry before writing rate state or provider rows', async t => {
  const sender = users[0], recipient = users[1];
  const senderSession = await join(sender), recipientSession = await join(recipient);
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  let gate, sending;
  try {
    const lease = await chatJoin(sender, senderSession), target = await chatJoin(recipient, recipientSession);
    assert.equal(lease.allowed, true); assert.equal(target.allowed, true);
    const suffix = randomUUID().slice(0, 8), gateName = `room-social-expiry-gate-${suffix}`;
    const senderName = `room-social-expiry-send-${suffix}`;
    // Only the chat lease expires. The separate 20-second club admissions and recipient's
    // 30-second chat lease remain live, so unrelated permission checks cannot mask this bug.
    await db.query(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()+interval '5 seconds'
      where id=${lit(lease.leaseId)}`);
    gate = db.query(`begin; set local statement_timeout='15s';
      set local application_name=${lit(gateName)};
      select id from private.world_room_chat_sessions where id=${lit(lease.leaseId)} for update;
      select pg_sleep(7); rollback;`).then(() => ({}), error => ({ error }));
    await waitUntil(() => db.json(`select exists(select 1 from pg_stat_activity
      where application_name=${lit(gateName)} and wait_event='PgSleep')`),
    { description: 'independent expiry gate holds the exact sender lease row' });
    sending = db.asUser(sender, `select jsonb_build_object('backendPid',pg_backend_pid(),'result',
      public.send_world_room_chat_v1(${lit(lease.leaseId)},'잠금 대기 중 만료'))`, senderName)
      .then(value => ({ value }), error => ({ error }));
    const evidence = await waitUntil(async () => {
      const rows = await db.json(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,
        'name',application_name,'waiting',wait_event_type='Lock',
        'beforeExpiry',clock_timestamp() < (select lease_expires_at from private.world_room_chat_sessions
          where id=${lit(lease.leaseId)}))),'[]'::jsonb)
        from pg_stat_activity where application_name in (${lit(gateName)},${lit(senderName)})`);
      const blocked = rows.find(row => row.name === senderName);
      if (!blocked?.waiting) return false;
      assert.equal(blocked.beforeExpiry, true, 'send must be observed waiting before its original chat lease expires');
      assert.equal(rows.length, 2); assert.equal(new Set(rows.map(row => row.pid)).size, 2);
      return rows;
    }, { description: 'authenticated sender really waits on a held row before expiry' });
    const gateResult = await gate; if (gateResult.error) throw gateResult.error;
    const completed = await sending; if (completed.error) throw completed.error;
    assert.equal(completed.value.backendPid, evidence.find(row => row.name === senderName).pid);
    assert.equal(completed.value.result.ok, false, 'time must be re-read after acquiring the row lock');
    assert.equal(completed.value.result.reason, 'denied');
    assert.equal(await db.json(`select count(*)::int from private.world_room_chat_limits where user_id=${lit(sender)}`), 0,
      'expired waiting send neither creates nor advances rate state');
    assert.equal(await db.json(`select count(*)::int from realtime.messages where topic=${lit(target.topic)}`), 0,
      'expired waiting send inserts no recipient provider row');
    assert.equal((await rpc(sender, 'heartbeat_world_club_room_v1', [ROOM_ID, senderSession])).allowed, true,
      'separate club admission remains valid and did not cause the denial');
    t.diagnostic(JSON.stringify({ case: 'chat-lock-wait-expiry', independentBackends: evidence.length,
      senderObservedLockWaitingBeforeExpiry: true, providerRows: 0, rateRows: 0 }));
  } finally {
    // Settle both independent transactions before restoring the closed fixture state.
    await Promise.all([gate, sending].filter(Boolean));
    await db.query('update private.world_room_chat_config set enabled=false where singleton');
  }
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


test('reusing a client pose UUID creates a fresh inbox and never resurrects old club/chat authority', async () => {
  const user=users[0], oldId=await join(user), old=admissions.get(oldId);
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  try {
    const oldChat=await chatJoin(user,oldId); assert.equal(oldChat.allowed,true);
    assert.equal((await rpc(user,'leave_world_club_room_v1',[ROOM_ID,oldId])).allowed,true);
    await db.query(`update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds' where user_id=${lit(user)}`);
    const fresh=await rpc(user,'join_world_club_room_v1',[ROOM_ID,old.sessionId]);
    assert.equal(fresh.allowed,true); assert.equal(fresh.sessionId,old.sessionId);
    assert.notEqual(fresh.admissionId,oldId); assert.notEqual(fresh.topic,old.topic); admissions.set(fresh.admissionId,fresh);
    for(const operation of ['heartbeat_world_club_room_v1','leave_world_club_room_v1'])
      assert.equal((await rpc(user,operation,[ROOM_ID,oldId])).allowed,false);
    for(const operation of ['claim_world_club_room_seat_v1','release_world_club_room_seat_v1'])
      assert.equal((await rpc(user,operation,[ROOM_ID,oldId,'chair_s0'])).allowed,false);
    assert.equal((await rpc(user,'publish_world_club_room_v1',[ROOM_ID,oldId,'presence','{}'])).allowed,false);
    assert.equal(await rpc(user,'can_access_world_club_room_realtime_v1',[old.topic]),false);
    assert.equal((await rpc(user,'send_world_room_chat_v1',[oldChat.leaseId,'old admission'])).ok,false);
    assert.equal((await rpc(user,'renew_world_room_chat_v1',[oldChat.leaseId])).allowed,false);
    assert.equal(await rpc(user,'can_receive_world_room_chat_v1',[oldChat.topic]),false);
    assert.equal((await rpc(user,'join_world_room_chat_v1',['club',ROOM_ID,old.sessionId,oldId])).allowed,false);
    const freshChat=await chatJoin(user,fresh.admissionId);assert.equal(freshChat.allowed,true);
    assert.notEqual(freshChat.leaseId,oldChat.leaseId);
    assert.equal((await rpc(user,'heartbeat_world_club_room_v1',[ROOM_ID,fresh.admissionId])).allowed,true);
  } finally { await db.query('update private.world_room_chat_config set enabled=false where singleton'); }
});

test('actual pg_cron deletes expired identifying metadata without any user activity', async t => {
  assert.equal(await db.json("select exists(select 1 from pg_extension where extname='pg_cron')"),true);
  assert.equal(await db.json("select count(*)::int from cron.job where jobname='world-room-social-cleanup-v1' and active and schedule='* * * * *' and command='select private.world_room_cleanup_v1();'"),1);
  assert.equal(await db.json("select to_regclass('private.world_club_room_session_ids') is null"),true,'no permanent tombstone table exists');
  const user=users[0], member=await join(user);
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  try {
    const chat=await chatJoin(user,member);assert.equal(chat.allowed,true);
    await db.query(`update private.world_club_room_sessions set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=${lit(user)};
      update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '1 hour 1 second' where user_id=${lit(user)};
      insert into private.world_room_chat_limits(user_id,sent_at) values(${lit(user)},array[clock_timestamp()-interval '6 seconds']);`);
    const before=await db.json('select to_jsonb(last_succeeded_at) from private.world_room_cleanup_state');
    await waitUntil(async()=> {
      const state=await db.json(`select jsonb_build_object('club',(select count(*) from private.world_club_room_sessions where user_id=${lit(user)}),
        'chat',(select count(*) from private.world_room_chat_sessions where user_id=${lit(user)}),
        'rates',(select count(*) from private.world_room_chat_limits where user_id=${lit(user)}),
        'admissions',(select count(*) from private.world_club_room_admission_limits where user_id=${lit(user)}),
        'advanced',(select last_succeeded_at > ${lit(before)}::timestamptz from private.world_room_cleanup_state))`);
      return state.advanced && [state.club,state.chat,state.rates,state.admissions].every(v=>v===0);
    },{timeoutMs:90000,pollMs:1000,description:'actual once/minute pg_cron worker removes old rows'});
    t.diagnostic(JSON.stringify({case:'actual-pg-cron-expiry',backgroundCleanupObserved:true,identifyingRowsRemaining:0}));
  } finally { await db.query('update private.world_room_chat_config set enabled=false where singleton'); }
});

test('cleanup outage fails closed and account deletion cascades every application metadata row', async () => {
  const user=users[7], member=await join(user);
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  try {
    const chat=await chatJoin(user,member);assert.equal(chat.allowed,true);
    assert.equal((await rpc(user,'send_world_room_chat_v1',[chat.leaseId,'account cleanup'])).ok,true);
    await db.query("update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp()-interval '91 seconds'");
    assert.equal((await rpc(user,'heartbeat_world_club_room_v1',[ROOM_ID,member])).reason,'CLEANUP_UNAVAILABLE');
    assert.equal((await rpc(user,'send_world_room_chat_v1',[chat.leaseId,'cleanup unavailable'])).ok,false);
    await db.query(`select private.world_room_cleanup_v1(); delete from auth.users where id=${lit(user)}`);
    for(const table of ['world_club_room_sessions','world_club_room_admission_limits','world_room_chat_sessions','world_room_chat_limits'])
      assert.equal(await db.json(`select count(*)::int from private.${table} where user_id=${lit(user)}`),0);
  } finally { await db.query('select private.world_room_cleanup_v1(); update private.world_room_chat_config set enabled=false where singleton'); }
});
