import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudentId } from '../src/phone/student-id.js';
test('student ID shows guest/unavailable honestly and never invents progression', async () => {
  let identity = null;
  const id = createStudentId({ getIdentity:()=>identity, getClient:()=>({rpc:async()=>({error:true})}), getProgression:()=>({state:'UNAVAILABLE'}) });
  await id.refresh(); assert.equal(id.snapshot().state,'GUEST'); assert.equal(id.snapshot().progression,null);
  identity = {userId:'a',displayName:'A'}; await id.refresh(); assert.equal(id.snapshot().state,'UNAVAILABLE'); assert.equal(id.snapshot().nickname,'A');
});
test('late account RPC does not leak old profile into the new identity', async () => {
  let done, identity = {userId:'a'};
  const id = createStudentId({getIdentity:()=>identity,getProgression:()=>null,getClient:()=>({rpc:()=>new Promise(r=>done=r)})});
  const pending = id.refresh(); identity = {userId:'b'}; id.invalidate(); done({data:{profile:{department:'OLD'}}}); await pending;
  assert.notEqual(id.snapshot().department,'OLD');
});
test('normal ID reads existing authority, caps badges at three and does not mutate server data', async () => {
  const profile={profile:{nickname:'A',department:'콘텐츠',title:'탐험가',avatar:'explorer'},stats:{playedGames:2}};
  const achievements={achievements:Array.from({length:5},(_,i)=>({earned:true,title:`Badge ${i}`,earnedAt:`2026-10-0${i+1}`}))};
  const before=structuredClone({profile,achievements});
  const id=createStudentId({getIdentity:()=>({userId:'a',displayName:'A'}),getClient:()=>({rpc:async name=>({data:name==='get_my_profile'?profile:achievements})}),
    getProgression:()=>({state:'READY',snapshot:{level:9,totalExp:321,nextLevelExp:999,progressExp:21,progressRequired:100}})});
  await id.refresh();const p=id.snapshot();assert.equal(p.department,'콘텐츠');assert.equal(p.progression.levelText,'Lv.9');assert.equal(p.badges.length,3);
  assert.deepEqual({profile,achievements},before);
});
