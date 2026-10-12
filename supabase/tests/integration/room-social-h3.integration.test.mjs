// Real PostgreSQL lock/clock regressions for H3 and the private friend-CARE lease bridge.
// Local disposable identities only; no hosted DB, production activation or external output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgHarness, lit, waitUntil } from '../../../scripts/room-social-pg-harness.mjs';
const db=createPgHarness(), owner=randomUUID(), visitor=randomUUID(), users=[owner,visitor];
let room;
const rpc=(user,name,args=[])=>db.asUser(user,`select public.${name}(${args.map(v=>v===null?'null':typeof v==='boolean'?String(v):lit(v)).join(',')})`);
const claims=user=>lit(JSON.stringify({sub:user,role:'authenticated',is_anonymous:false}));
const helper=(session,lease)=>`private.world_room_chat_plant_lease_v1(${lit(visitor)},${lit(room)},${lit(session)},${lit(lease)})`;
const care=(session,lease)=>db.json(`begin;set local request.jwt.claims=${claims(visitor)};select ${helper(session,lease)};commit;`);
async function admittedVisit(){
  await rpc(owner,'list_my_room_knocks_v1');
  const knock=await rpc(visitor,'knock_friend_personal_room_v1',[owner]);assert.equal(knock.status,'PENDING');
  assert.equal((await rpc(owner,'respond_room_knock_v1',[knock.knockId,true])).status,'ACCEPTED');
  await db.query('update private.world_room_chat_config set enabled=true where singleton');
  const session=randomUUID(),lease=await rpc(visitor,'join_world_room_chat_v1',['personal',room,session,null]);
  assert.equal(lease.allowed,true);return {session,lease,knock};
}
async function observedWait(gateName,waitingName,expirySql){
  return waitUntil(async()=>{
    const rows=await db.json(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'waiting',wait_event_type='Lock')),'[]')
      from pg_stat_activity where application_name in (${lit(gateName)},${lit(waitingName)})`);
    if(rows.length!==2||!rows.find(row=>row.name===waitingName)?.waiting)return false;
    assert.equal(new Set(rows.map(row=>row.pid)).size,2);
    if(expirySql)assert.equal(await db.json(expirySql),true,'contender must be blocked before expiry');
    return rows;
  },{description:'distinct real backends contend before the authority expiry'});
}
test.before(async()=>{
  assert.equal(await db.json('select enabled from private.world_club_rooms'),false,'H3/CARE never activates club');
  assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'),false);
  assert.equal(await db.json('select private.world_room_chat_personal_authority_ready_v1()'),true);
  await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
    ${users.map(id=>`(${lit(id)},'authenticated','authenticated',${lit(`h3-fixture-${id}@example.test`)},now(),false)`).join(',')};
    insert into public.profiles(user_id,nickname,is_banned) values(${lit(owner)},'방주인검증',false),(${lit(visitor)},'방손님검증',false);
    insert into public.world_friendships(user_low,user_high,status,requested_by,accepted_at) values
      (${lit([...users].sort()[0])},${lit([...users].sort()[1])},'accepted',${lit(owner)},now());`);
  room=(await rpc(owner,'get_or_create_my_personal_room_v1')).roomId;
});
test.beforeEach(async()=>{
  await db.query(`update public.world_player_rooms set visibility='friends' where id=${lit(room)};
    delete from private.world_room_knocks where room_id=${lit(room)};
    delete from private.world_room_owner_presence where room_id=${lit(room)};
    delete from private.world_room_chat_sessions where user_id in (${users.map(lit).join(',')});
    delete from public.world_user_blocks where blocker_id in (${users.map(lit).join(',')});
    update private.world_room_chat_config set enabled=false where singleton;
    select private.world_room_cleanup_v1();`);
});
test.afterEach(async()=>{
  await db.query('update private.world_room_chat_config set enabled=false where singleton; select private.world_room_cleanup_v1();');
  assert.equal(await db.json('select enabled from private.world_club_rooms'),false,'personal CARE stays independent of closed club');
});
test.after(async()=>{
  await db.query(`update private.world_room_chat_config set enabled=false where singleton;delete from auth.users where id in (${users.map(lit).join(',')});`);
});
test('private CARE capability is exact and dependent on current personal authority, never club activation',async()=>{
  const {session,lease,knock}=await admittedVisit();
  assert.equal(await care(session,lease.leaseId),true);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await db.json(`select has_function_privilege(${lit(role)},'private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)','execute')`),false);
  assert.equal(await care(randomUUID(),lease.leaseId),false);
  await db.query('update private.world_room_chat_config set enabled=false where singleton');assert.equal(await care(session,lease.leaseId),false);
  await db.query("update private.world_room_chat_config set enabled=true where singleton;update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp()-interval '91 seconds'");assert.equal(await care(session,lease.leaseId),false);
  await db.query('select private.world_room_cleanup_v1()');
  await db.query(`insert into public.world_user_blocks(blocker_id,blocked_id) values(${lit(owner)},${lit(visitor)})`);assert.equal(await care(session,lease.leaseId),false);
  await db.query(`delete from public.world_user_blocks where blocker_id=${lit(owner)};update private.world_room_knocks set created_at=clock_timestamp()-interval '2 hours 1 second' where id=${lit(knock.knockId)}`);
  assert.equal(await care(session,lease.leaseId),false);
  await db.query(`update private.world_room_knocks set created_at=clock_timestamp() where id=${lit(knock.knockId)}`);
  assert.equal((await rpc(owner,'respond_room_knock_v1',[knock.knockId,false])).status,'ACCEPTED','a second false answer is not an invented cancellation API');
  assert.equal(await rpc(visitor,'leave_world_room_chat_v1',[lease.leaseId]),true);assert.equal(await care(session,lease.leaseId),false);
});
test('owner response waiting on a room lock cannot approve a knock that expires during the wait',async t=>{
  await rpc(owner,'list_my_room_knocks_v1');const knock=await rpc(visitor,'knock_friend_personal_room_v1',[owner]);assert.equal(knock.status,'PENDING');
  await db.query(`update private.world_room_knocks set expires_at=clock_timestamp()+interval '3 seconds' where id=${lit(knock.knockId)}`);
  const suffix=randomUUID().slice(0,8),gateName=`room-h3-response-gate-${suffix}`,waitName=`room-h3-response-wait-${suffix}`;
  let waiting;
  const gate=db.query(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';select id from public.world_player_rooms where id=${lit(room)} for update;select pg_sleep(5);rollback;`).then(()=>({}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    waiting=db.asUser(owner,`select public.respond_room_knock_v1(${lit(knock.knockId)},true)`,waitName).then(value=>({value}),error=>({error}));
    const evidence=await observedWait(gateName,waitName,`select clock_timestamp() < expires_at from private.world_room_knocks where id=${lit(knock.knockId)}`);
    const released=await gate;if(released.error)throw released.error;const result=await waiting;if(result.error)throw result.error;
    assert.equal(result.value.status,'EXPIRED');
    t.diagnostic(JSON.stringify({case:'H3-response-lock-expiry',independentBackends:evidence.length,observedWaitBeforeExpiry:true,lateApproval:false}));
  }finally{await Promise.all([gate,waiting].filter(Boolean));}
});
test('CARE lease SHARE lock waits for renewal/delete and evaluates expiry after acquiring it',async t=>{
  const {session,lease}=await admittedVisit();
  await db.query(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()+interval '3 seconds' where id=${lit(lease.leaseId)}`);
  const suffix=randomUUID().slice(0,8),gateName=`room-care-expiry-gate-${suffix}`,waitName=`room-care-expiry-wait-${suffix}`;let waiting;
  const gate=db.query(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';select id from private.world_room_chat_sessions where id=${lit(lease.leaseId)} for update;select pg_sleep(5);rollback;`).then(()=>({}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    waiting=db.json(`begin;set local application_name=${lit(waitName)};set local statement_timeout='15s';set local request.jwt.claims=${claims(visitor)};
      select id from public.world_player_rooms where id=${lit(room)} for update;select ${helper(session,lease.leaseId)};commit;`).then(value=>({value}),error=>({error}));
    const evidence=await observedWait(gateName,waitName,`select clock_timestamp() < lease_expires_at from private.world_room_chat_sessions where id=${lit(lease.leaseId)}`);
    const released=await gate;if(released.error)throw released.error;const result=await waiting;if(result.error)throw result.error;
    assert.equal(result.value,false,'expired waiting lease never authorizes CARE');
    t.diagnostic(JSON.stringify({case:'CARE-lease-lock-expiry',independentBackends:evidence.length,observedWaitBeforeExpiry:true,allowed:false}));
  }finally{await Promise.all([gate,waiting].filter(Boolean));}
});
test('CARE holding a valid chat lease still rejects H3 admission expiry during a lease-row lock wait',async t=>{
  const {session,lease,knock}=await admittedVisit();
  await db.query(`update private.world_room_knocks set created_at=clock_timestamp()-interval '2 hours'+interval '3 seconds' where id=${lit(knock.knockId)}`);
  const suffix=randomUUID().slice(0,8),gateName=`room-care-expiry-gate-${suffix}`,waitName=`room-care-expiry-wait-${suffix}`;let waiting;
  const gate=db.query(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';select id from private.world_room_chat_sessions where id=${lit(lease.leaseId)} for update;select pg_sleep(5);rollback;`).then(()=>({}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    waiting=db.json(`begin;set local application_name=${lit(waitName)};set local statement_timeout='15s';set local request.jwt.claims=${claims(visitor)};
      select id from public.world_player_rooms where id=${lit(room)} for update;select ${helper(session,lease.leaseId)};commit;`).then(value=>({value}),error=>({error}));
    const evidence=await observedWait(gateName,waitName,`select clock_timestamp() < created_at+interval '2 hours' from private.world_room_knocks where id=${lit(knock.knockId)}`);
    const released=await gate;if(released.error)throw released.error;const result=await waiting;if(result.error)throw result.error;
    assert.equal(result.value,false,'expired H3 admission denies CARE even while its 30-second chat lease is current');
    t.diagnostic(JSON.stringify({case:'CARE-H3-lock-expiry',independentBackends:evidence.length,observedWaitBeforeExpiry:true,allowed:false}));
  }finally{await Promise.all([gate,waiting].filter(Boolean));}
});
test('a successful private CARE validation holds SHARE until the enclosing transaction finishes',async t=>{
  const {session,lease}=await admittedVisit();const suffix=randomUUID().slice(0,8),gateName=`room-care-share-${suffix}`,waitName=`room-care-leave-${suffix}`;let leaving;
  const holding=db.json(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';set local request.jwt.claims=${claims(visitor)};
    select id from public.world_player_rooms where id=${lit(room)} for update;select ${helper(session,lease.leaseId)};select pg_sleep(4);commit;`).then(value=>({value}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    leaving=db.asUser(visitor,`select public.leave_world_room_chat_v1(${lit(lease.leaseId)})`,waitName).then(value=>({value}),error=>({error}));
    const evidence=await observedWait(gateName,waitName);
    const prior=await holding;if(prior.error)throw prior.error;assert.equal(prior.value,true);
    const result=await leaving;if(result.error)throw result.error;assert.equal(result.value,true);assert.equal(await care(session,lease.leaseId),false);
    t.diagnostic(JSON.stringify({case:'CARE-share-serializes-leave',independentBackends:evidence.length,leaveObservedWaiting:true,revokedAfterCommit:true}));
  }finally{await Promise.all([holding,leaving].filter(Boolean));}
});
test('H3 cleanup preserves rate evidence, removes expired authority, and prevents late response after deletion',async()=>{
  const ids=Array.from({length:6},()=>randomUUID());
  await db.query(`insert into private.world_room_knocks(id,room_id,visitor_user_id,status,created_at,expires_at,responded_at) values
    (${lit(ids[0])},${lit(room)},${lit(visitor)},'ACCEPTED',clock_timestamp()-interval '2 hours 1 second',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour'),
    (${lit(ids[1])},${lit(room)},${lit(visitor)},'OPEN',clock_timestamp()-interval '2 hours 1 second',clock_timestamp()-interval '1 second',clock_timestamp()-interval '2 hours'),
    (${lit(ids[2])},${lit(room)},${lit(visitor)},'DECLINED',clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '10 minutes 30 seconds',clock_timestamp()-interval '10 minutes 1 second'),
    (${lit(ids[3])},${lit(room)},${lit(visitor)},'PENDING',clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '91 seconds',null),
    (${lit(ids[4])},${lit(room)},${lit(visitor)},'EXPIRED',clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '91 seconds',null),
    (${lit(ids[5])},${lit(room)},${lit(visitor)},'EXPIRED',clock_timestamp()-interval '60 seconds',clock_timestamp()-interval '30 seconds',null);
    insert into private.world_room_owner_presence(room_id,seen_at) values(${lit(room)},clock_timestamp()-interval '13 seconds');select private.world_room_cleanup_v1();`);
  assert.deepEqual(await db.json(`select jsonb_agg(id) from private.world_room_knocks where room_id=${lit(room)}`),[ids[5]]);
  assert.equal(await db.json(`select count(*)::int from private.world_room_owner_presence where room_id=${lit(room)}`),0);
  await assert.rejects(()=>rpc(owner,'respond_room_knock_v1',[ids[3],true]),/KNOCK_NOT_FOUND/);
});
test('CARE rechecks privacy after acquiring the room lock held by a concurrent visibility change',async t=>{
  const {session,lease}=await admittedVisit();const suffix=randomUUID().slice(0,8),gateName=`room-care-privacy-${suffix}`,waitName=`room-care-private-wait-${suffix}`;let waiting;
  const changing=db.query(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';
    update public.world_player_rooms set visibility='private' where id=${lit(room)};select pg_sleep(4);commit;`).then(()=>({}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    waiting=db.json(`begin;set local application_name=${lit(waitName)};set local statement_timeout='15s';set local request.jwt.claims=${claims(visitor)};
      select id from public.world_player_rooms where id=${lit(room)} for update;select ${helper(session,lease.leaseId)};commit;`).then(value=>({value}),error=>({error}));
    const evidence=await observedWait(gateName,waitName);const prior=await changing;if(prior.error)throw prior.error;
    const result=await waiting;if(result.error)throw result.error;assert.equal(result.value,false);
    t.diagnostic(JSON.stringify({case:'CARE-privacy-room-lock',independentBackends:evidence.length,changedPrivacyRechecked:true,allowed:false}));
  }finally{await Promise.all([changing,waiting].filter(Boolean));}
});
test('cleanup waits room-before-lease behind CARE and completes without a lock-order deadlock',async t=>{
  const {session,lease}=await admittedVisit();const suffix=randomUUID().slice(0,8),gateName=`room-care-cleanup-${suffix}`,waitName=`room-cleanup-wait-${suffix}`;let cleaning;
  await db.query(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()+interval '2 seconds' where id=${lit(lease.leaseId)}`);
  const holding=db.json(`begin;set local application_name=${lit(gateName)};set local statement_timeout='15s';set local request.jwt.claims=${claims(visitor)};
    select id from public.world_player_rooms where id=${lit(room)} for update;select ${helper(session,lease.leaseId)};select pg_sleep(5);commit;`).then(value=>({value}),error=>({error}));
  try{
    await waitUntil(()=>db.json(`select exists(select 1 from pg_stat_activity where application_name=${lit(gateName)} and wait_event='PgSleep')`));
    await waitUntil(()=>db.json(`select lease_expires_at <= clock_timestamp() from private.world_room_chat_sessions where id=${lit(lease.leaseId)}`),{description:'lease becomes an eligible cleanup row while CARE holds SHARE'});
    cleaning=db.query(`begin;set local application_name=${lit(waitName)};set local statement_timeout='15s';select private.world_room_cleanup_v1();commit;`).then(()=>({}),error=>({error}));
    const evidence=await observedWait(gateName,waitName);const prior=await holding;if(prior.error)throw prior.error;assert.equal(prior.value,true);
    const result=await cleaning;if(result.error)throw result.error;assert.equal(await db.json(`select count(*)::int from private.world_room_chat_sessions where id=${lit(lease.leaseId)}`),0);
    t.diagnostic(JSON.stringify({case:'CARE-cleanup-lock-order',independentBackends:evidence.length,cleanupObservedWaiting:true,deadlock:false,expiredLeaseRows:0}));
  }finally{await Promise.all([holding,cleaning].filter(Boolean));}
});
test('visitor and owner account deletion cascade H3 and personal lease metadata',async()=>{
  const {session,lease}=await admittedVisit();assert.equal(await care(session,lease.leaseId),true);
  await db.query(`delete from auth.users where id=${lit(visitor)}`);
  assert.equal(await db.json(`select count(*)::int from private.world_room_knocks where visitor_user_id=${lit(visitor)}`),0);
  assert.equal(await db.json(`select count(*)::int from private.world_room_chat_sessions where user_id=${lit(visitor)}`),0);
  await db.query(`delete from auth.users where id=${lit(owner)}`);
  assert.equal(await db.json(`select count(*)::int from private.world_room_owner_presence where room_id=${lit(room)}`),0);
  assert.equal(await db.json(`select count(*)::int from public.world_player_rooms where id=${lit(room)}`),0);
});
