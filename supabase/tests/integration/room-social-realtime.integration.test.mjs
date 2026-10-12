// Isolated real Supabase WebSocket regression. All data is synthetic and local-only.
// The old socket is kept subscribed: no UI/decoder/nonce filtering can hide a leaked raw frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgHarness, lit, ROOM_ID, waitUntil } from '../../../scripts/room-social-pg-harness.mjs';
import { assertLocalApi, fixtureJwt, connectRawReceiver } from '../../../scripts/room-social-realtime-harness.mjs';

const db = createPgHarness();
assertLocalApi(process.env.API_URL);
const rpc = (user, name, args) => db.asUser(user, `select public.${name}(${args.map(v => v === null ? 'null' : lit(v)).join(',')})`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('raw cached subscribers receive zero future frames after leave and same client UUID rejoin', { timeout: 120000 }, async t => {
  const sender = randomUUID(), recipient = randomUUID(), users = [sender, recipient], topics = new Set();
  const poseIds = [randomUUID(), randomUUID()], members = new Map(), chats = new Map();
  const sockets = []; let keepAlive, pending = Promise.resolve(), keepAliveFailure;
  assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'), false);
  assert.equal(await db.json('select enabled from private.world_club_rooms'),false);
  try {
    await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values
      ${users.map(id=>`(${lit(id)},'authenticated','authenticated',${lit(`realtime-fixture-${id}@example.test`)},now(),false)`).join(',')};
      insert into public.profiles(user_id,nickname,is_banned) values
      (${lit(sender)},'전송원',false),(${lit(recipient)},'수신원',false);
      select private.world_room_cleanup_v1(); update private.world_club_rooms set enabled=true; update private.world_room_chat_config set enabled=true where singleton;`);
    for(let i=0;i<users.length;i++) {
      const member=await rpc(users[i],'join_world_club_room_v1',[ROOM_ID,poseIds[i]]);
      assert.equal(member.allowed,true); members.set(users[i],member); topics.add(member.topic);
      const chat=await rpc(users[i],'join_world_room_chat_v1',['club',ROOM_ID,poseIds[i],member.admissionId]);
      assert.equal(chat.allowed,true); chats.set(users[i],chat); topics.add(chat.topic);
    }
    // Keep only CURRENT authority alive; the retained old socket gets no reauthorization.
    const startKeepAlive=()=>{keepAlive=setInterval(()=>{pending=pending.then(async()=>{
      for(const [user,member] of members) assert.equal((await rpc(user,'heartbeat_world_club_room_v1',[ROOM_ID,member.admissionId])).allowed,true);
      for(const [user,chat] of chats) assert.equal((await rpc(user,'renew_world_room_chat_v1',[chat.leaseId])).allowed,true);
    }).catch(()=>{keepAliveFailure=true;});},5000);};
    startKeepAlive();
    const token=fixtureJwt(recipient,process.env.JWT_SECRET);
    const oldReceiver=await connectRawReceiver({apiUrl:process.env.API_URL,anonKey:process.env.ANON_KEY,token}); sockets.push(oldReceiver);
    const oldMember=members.get(recipient),oldChat=chats.get(recipient);
    await oldReceiver.join(oldMember.topic); await oldReceiver.join(oldChat.topic);
    const baseline=`baseline-${randomUUID().slice(0,8)}`;
    const baselineId=301;
    assert.equal((await rpc(sender,'publish_world_club_room_v1',[ROOM_ID,members.get(sender).admissionId,'action',JSON.stringify({v:1,id:baselineId,type:'jump',payload:{}})])).sent,true);
    assert.equal((await rpc(sender,'send_world_room_chat_v1',[chats.get(sender).leaseId,baseline])).ok,true);
    await waitUntil(()=>oldReceiver.count(oldMember.topic,`"id":${baselineId}`)===1 && oldReceiver.count(oldChat.topic,baseline)===1,
      {timeoutMs:10000,description:'old raw receiver demonstrably receives both baseline transports'});
    // Freeze keepalive while replacing authority to prevent a test-created stale heartbeat race.
    clearInterval(keepAlive); keepAlive=null; await pending; assert.equal(keepAliveFailure,undefined);
    members.delete(recipient); chats.delete(recipient);
    assert.equal((await rpc(recipient,'leave_world_club_room_v1',[ROOM_ID,oldMember.admissionId])).allowed,true);
    await db.query(`update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds' where user_id=${lit(recipient)}`);
    const fresh=await rpc(recipient,'join_world_club_room_v1',[ROOM_ID,poseIds[1]]);
    assert.equal(fresh.allowed,true); assert.equal(fresh.sessionId,oldMember.sessionId);
    assert.notEqual(fresh.admissionId,oldMember.admissionId);assert.notEqual(fresh.topic,oldMember.topic);topics.add(fresh.topic);members.set(recipient,fresh);
    const freshChat=await rpc(recipient,'join_world_room_chat_v1',['club',ROOM_ID,poseIds[1],fresh.admissionId]);
    assert.equal(freshChat.allowed,true);assert.notEqual(freshChat.topic,oldChat.topic);topics.add(freshChat.topic);chats.set(recipient,freshChat);
    assert.equal((await rpc(recipient,'send_world_room_chat_v1',[oldChat.leaseId,'stale send'])).ok,false);
    assert.equal((await rpc(recipient,'renew_world_room_chat_v1',[oldChat.leaseId])).allowed,false);
    assert.equal(await rpc(recipient,'can_receive_world_room_chat_v1',[oldChat.topic]),false);
    assert.equal((await rpc(recipient,'leave_world_club_room_v1',[ROOM_ID,oldMember.admissionId])).allowed,false);
    assert.equal((await rpc(recipient,'heartbeat_world_club_room_v1',[ROOM_ID,fresh.admissionId])).allowed,true);
    startKeepAlive();
    const freshReceiver=await connectRawReceiver({apiUrl:process.env.API_URL,anonKey:process.env.ANON_KEY,token});sockets.push(freshReceiver);
    await freshReceiver.join(fresh.topic);await freshReceiver.join(freshChat.topic);
    // Refresh current sender without touching either retained old topic.
    assert.equal((await rpc(sender,'heartbeat_world_club_room_v1',[ROOM_ID,members.get(sender).admissionId])).allowed,true);
    const marker=`fresh-${randomUUID().slice(0,8)}`,actionId=302;
    await db.query(`update private.world_club_room_sessions set last_action_at=null where user_id=${lit(sender)}`);
    assert.equal((await rpc(sender,'publish_world_club_room_v1',[ROOM_ID,members.get(sender).admissionId,'action',JSON.stringify({v:1,id:actionId,type:'jump',payload:{}})])).sent,true);
    assert.equal((await rpc(sender,'send_world_room_chat_v1',[chats.get(sender).leaseId,marker])).ok,true);
    await waitUntil(()=>freshReceiver.count(fresh.topic,`"id":${actionId}`)===1 && freshReceiver.count(freshChat.topic,marker)===1,
      {timeoutMs:10000,description:'fresh raw receiver gets actual committed provider broadcasts'});
    await pause(1500);oldReceiver.assertSubscribed(oldMember.topic);oldReceiver.assertSubscribed(oldChat.topic);freshReceiver.assertSubscribed(fresh.topic);freshReceiver.assertSubscribed(freshChat.topic);assert.equal(keepAliveFailure,undefined);
    assert.equal(oldReceiver.count(oldMember.topic,`"id":${actionId}`),0,'old raw club subscriber receives zero replacement packets');
    assert.equal(oldReceiver.count(oldChat.topic,marker),0,'old raw chat subscriber receives zero replacement messages');
    assert.equal(await db.json(`select count(*)::int from realtime.messages where topic in (${lit(oldMember.topic)},${lit(oldChat.topic)})
      and (payload->>'text'=${lit(marker)} or payload#>>'{p,id}'=${lit(actionId)})`),0,'provider inserted no future row for either old inbox');
    t.diagnostic(JSON.stringify({case:'raw-old-subscriber-same-client-uuid',oldSubscriberStayedConnected:true,
      baselineClubFrames:1,baselineChatFrames:1,freshClubFrames:1,freshChatFrames:1,oldFutureClubFrames:0,oldFutureChatFrames:0,
      oldProviderFutureRows:0,postDeliveryObservationMs:1500}));
  } finally {
    clearInterval(keepAlive);await pending;for(const socket of sockets) socket.close();
    await db.query(`update private.world_room_chat_config set enabled=false where singleton;
      update private.world_club_rooms set enabled=false;
      delete from realtime.messages where topic in (${[...topics].map(lit).join(',')||"''"});
      delete from auth.users where id in (${users.map(lit).join(',')});`);
    assert.equal(await db.json('select enabled from private.world_room_chat_config where singleton'),false);
  }
});
