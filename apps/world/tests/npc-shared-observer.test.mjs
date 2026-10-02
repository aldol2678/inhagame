import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedMeetingObserver } from '../npc-factory/npc-shared-meetings.mjs';
import { sanitizeNpcTalk, busyNpcIds } from '../src/network/npc-talk-presence.js';
import { buildPresence, validatePresence } from '../src/network/protocol.js';
import { MAIN_HALL, createWorld, createClient, run } from './support/online-harness.mjs';

const id='INKYUNG-NPC-013';
const event={eventId:'shared:1',conversation_id:'rest_01',index:1,tone:'high',cohesion:60,
  line:{npcId:id,text:'잠깐 쉬었다 가요.'},members:[{id,outward:{to:{x:0,z:0}}},{id:'INKYUNG-NPC-023',outward:{to:{x:1.7,z:0}}}]};
const input={now:100,events:[event],player:{x:0,z:1}};

test('late observers see the same current line; one scene, hysteresis, cooldown and yielding',()=>{
  const a=createSharedMeetingObserver(),b=createSharedMeetingObserver();
  assert.deepEqual(a.update(input),b.update(input));
  assert.equal(a.update({...input,events:[event,{...event,eventId:'other'}]}).eventId,event.eventId);
  assert.equal(a.update({...input,player:{x:0,z:4.5}}).index,1,'retained inside 12m exit');
  assert.equal(a.update({...input,player:{x:0,z:6.1}}),null);
  assert.equal(a.update({...input,now:170}),null,'same event never restarts');
  assert.equal(b.update({...input,busyIds:[id]}),null,'direct talk yields');
  const fresh=createSharedMeetingObserver();
  assert.equal(fresh.update({...input,player:{x:0,z:4.1}}),null,'outside 8m entry');
  assert.equal(fresh.update({...input,blocked:true}),null);
  assert.equal(fresh.update({...input,now:null}),null,'clock unavailable');
  assert.ok(fresh.update(input));
  assert.equal(fresh.update({...input,now:111,events:[{...event,eventId:'second'}]}),null,'global 60s cooldown');
  assert.ok(fresh.update({...input,now:161,events:[{...event,eventId:'second'}]}));
});

test('talk presence is bounded, sanitized, refreshed and cleared across clients',()=>{
  assert.equal(sanitizeNpcTalk({npcId:'INKYUNG-NPC-049',until:10}),null);
  assert.equal(sanitizeNpcTalk({npcId:id,until:Infinity}),null);
  const base={sessionId:'s',userId:'u',displayName:'친구',placeZoneId:MAIN_HALL,joinedAt:1};
  const presence=buildPresence({...base,npcTalk:{npcId:id,until:11000,private:'drop'}});
  assert.deepEqual(validatePresence(presence).presence.npcTalk,{npcId:id,until:11000});
  assert.deepEqual(busyNpcIds([presence],1000),[id]);
  assert.deepEqual(busyNpcIds([presence],11000),[]);
  assert.deepEqual(busyNpcIds([{npcTalk:{npcId:id,until:1000000}}],1000),[]);
  const world=createWorld(),a=createClient(world,{label:'A'}),b=createClient(world,{label:'B'});
  for(const c of [a,b]){c.net.setPlaceZone(MAIN_HALL);c.net.start();}
  run(world,300);
  const now=world.scheduler.now();
  assert.equal(a.net.setNpcTalk(id,now),true);
  assert.equal(a.net.setNpcTalk(id,now+100),false);
  run(world,100);
  assert.deepEqual(busyNpcIds(b.net.remotes.list(),world.scheduler.now()),[id]);
  assert.equal(a.net.setNpcTalk(id,now+5100),true);
  run(world,100);
  assert.equal(a.net.setNpcTalk(null,world.scheduler.now()),true);
  run(world,100);
  assert.deepEqual(busyNpcIds(b.net.remotes.list(),world.scheduler.now()),[]);
});
