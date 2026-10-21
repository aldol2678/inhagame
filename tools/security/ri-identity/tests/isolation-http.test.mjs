import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {IdentityService,MemoryIdentityStore,RIError} from '../src/identity-service.mjs';
import {createIdentityHttpHandler,API_BASE} from '../src/identity-http.mjs';
import {VerifiedReceiver} from '../src/verified-receiver.mjs';
import {makeKeyPair,exportPublicKey,signProof,signFrame,trustedTopic} from '../src/crypto.mjs';

const TOPIC='world:campus:AREA_MAIN_HALL', OTHER='world:campus:AREA_AGORA_6_9',ROOM='world:room:55555555-5555-4555-8555-555555555555';
const U={alice:'11111111-1111-4111-8111-111111111111',victim:'22222222-2222-4222-8222-222222222222',guest:'33333333-3333-4333-8333-333333333333',gm:'44444444-4444-4444-8444-444444444444'};
const authS={alice:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',victim:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',guest:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',gm:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
const TOKENS=Object.fromEntries(Object.keys(U).map(k=>[k,`${k}.synthetic.local-only.${'a'.repeat(30)}`]));
const baseActor=(k)=>({userId:U[k],authSessionId:authS[k],guest:k==='guest',displayName:k==='guest'?null:k==='gm'?'운영자':k==='victim'?'피해자':'앨리스',banned:false,kicked:false});
const act=(kind,n,txt='hello')=>({v:1,id:n,type:kind,payload:kind==='chat'?{text:txt,x:0,y:0,z:0}:{}});
const pose=n=>({v:1,seq:n,x:0,y:0,z:0,yaw:0,vx:0,vz:0,anim:'idle'});
async function fixture(){
 let now=100_000;const tokens=new Map(Object.keys(U).map(k=>[TOKENS[k],baseActor(k)]));const denied=new Set(),calls=[];
 const bus={async publish(e){calls.push(e);}};
 const store=new MemoryIdentityStore();
 const service=new IdentityService({auth:{verify:async token=>tokens.get(token)??null},store,publisher:bus,now:()=>now,
  authorize:async({actor,topic})=>!denied.has(actor.userId)&&(!topic.startsWith('world:room:')||actor.userId===U.alice||actor.userId===U.victim)});
 const server=createServer(createIdentityHttpHandler(service));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function request(k,method,path,body=null){const headers={authorization:`Bearer ${TOKENS[k]}`};if(body)headers['content-type']='application/json';const r=await fetch(origin+API_BASE+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function login(k,topic=TOPIC,options={}){
  const keys=await makeKeyPair(),publicJwk=await exportPublicKey(keys);
  const c=await request(k,'POST','/challenge',{kind:'register',topic,publicJwk,...options});
  assert.equal(c.status,200,JSON.stringify(c));
  const signature=await signProof(keys.privateKey,c.data);
  const r=await request(k,'POST','/finish',{challengeId:c.data.id,signature});
  assert.equal(r.status,200,JSON.stringify(r));
  return {keys,publicJwk,challenge:c.data,entry:r.data.entry};
 }
 return {service,store,tokens,denied,calls,origin,request,login,advance:ms=>{now+=ms},now:()=>now,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('RI-HTTP-01 register issues server-owned sid; ignores/blocks client self-asserted identity',async()=>{
 const f=await fixture();try{
  const k=await makeKeyPair(),pub=await exportPublicKey(k);
  const claim=await f.request('guest','POST','/challenge',{kind:'register',topic:TOPIC,publicJwk:pub,userId:U.gm,guest:false});
  assert.equal(claim.status,400);assert.equal(claim.data.error,'UNKNOWN_FIELD');
  const entry=await f.login('guest');assert.equal(entry.entry.guest,true);assert.equal(entry.entry.userId,U.guest);
  assert.ok(entry.entry.sid!==authS.guest);assert.equal(entry.entry.epoch,1);
 }finally{await f.close()}
});
test('RI-HTTP-02 no token, invalid bearer and unauthorized roster fail closed',async()=>{
 const f=await fixture();try{
  const no=await fetch(f.origin+API_BASE+'/roster?topic='+encodeURIComponent(TOPIC));assert.equal(no.status,401);
  const r=await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC));assert.equal(r.status,403);
  const invalid=await fetch(f.origin+API_BASE+'/roster?topic='+encodeURIComponent(TOPIC),{headers:{authorization:'Bearer invalid'}});
  assert.equal(invalid.status,401);
 }finally{await f.close()}
});
test('RI-HTTP-03 proof-of-possession rejects another key, valid finish and one-time replay',async()=>{
 const f=await fixture();try{
  const a=await makeKeyPair(),b=await makeKeyPair(),pub=await exportPublicKey(a);
  const challenge=(await f.request('alice','POST','/challenge',{kind:'register',topic:TOPIC,publicJwk:pub})).data;
  const wrong=await f.request('alice','POST','/finish',{challengeId:challenge.id,signature:await signProof(b.privateKey,challenge)});
  assert.equal(wrong.status,403);assert.equal(wrong.data.error,'PROOF_INVALID');
  const good=await f.request('alice','POST','/finish',{challengeId:challenge.id,signature:await signProof(a.privateKey,challenge)});
  assert.equal(good.status,200);
  const replay=await f.request('alice','POST','/finish',{challengeId:challenge.id,signature:await signProof(a.privateKey,challenge)});
  assert.equal(replay.status,409);
 }finally{await f.close()}
});
test('RI-HTTP-04 JWT owner mismatch cannot complete a challenge',async()=>{
 const f=await fixture();try{
  const keys=await makeKeyPair();const pub=await exportPublicKey(keys);
  const c=(await f.request('alice','POST','/challenge',{kind:'register',topic:TOPIC,publicJwk:pub})).data;
  const bad=await f.request('victim','POST','/finish',{challengeId:c.id,signature:await signProof(keys.privateKey,c)});
  assert.equal(bad.status,403);assert.equal(bad.data.error,'CHALLENGE_OWNER_MISMATCH');
 }finally{await f.close()}
});
test('RI-HTTP-05 signed-v2 genuine movement/chat passes, spoofed sid cannot impersonate',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice'),b=await f.login('victim');
  const snap=(await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data;
  const receiver=new VerifiedReceiver({now:f.now});receiver.reset(TOPIC);assert.equal(receiver.fromSnapshot(snap),true);
  const legit=await signFrame(a.keys.privateKey,a.entry,'ACTION',act('chat',1,'안녕'),1);
  assert.equal((await receiver.verify(legit,TOPIC)).userId,U.alice);
  const spoof=await signFrame(b.keys.privateKey,{...b.entry,sid:a.entry.sid},'ACTION',act('chat',2,'나는 앨리스'),2);
  assert.equal((await receiver.verify(spoof,TOPIC)).reason,'SIGNATURE_INVALID');
  assert.equal((await receiver.verify(await signFrame(a.keys.privateKey,a.entry,'POSE',pose(1),1),TOPIC)).ok,true);
 }finally{await f.close()}
});
test('RI-HTTP-06 Guest cannot masquerade as member; genuine guest movement remains',async()=>{
 const f=await fixture();try{
  const a=await f.login('guest');const snap=(await f.request('guest','GET','/roster?topic='+encodeURIComponent(TOPIC))).data;
  const receiver=new VerifiedReceiver({now:f.now});receiver.reset(TOPIC);assert.equal(receiver.fromSnapshot(snap),true);
  assert.equal((await receiver.verify(await signFrame(a.keys.privateKey,a.entry,'ACTION',act('chat',1,'스팸'),1),TOPIC)).reason,'GUEST_FORBIDDEN');
  assert.equal((await receiver.verify(await signFrame(a.keys.privateKey,a.entry,'POSE',pose(1),1),TOPIC)).ok,true);
 }finally{await f.close()}
});
test('RI-HTTP-07 register/renew/leave event revisions; stale signed epoch rejected',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice');const receiver=new VerifiedReceiver({now:f.now});receiver.reset(TOPIC);
  receiver.fromSnapshot((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data);
  const early=await signFrame(a.keys.privateKey,a.entry,'POSE',pose(1),1);
  const c=(await f.request('alice','POST','/challenge',{kind:'renew',topic:TOPIC,sid:a.entry.sid,publicJwk:a.publicJwk})).data;
  const renewed=(await f.request('alice','POST','/finish',{challengeId:c.id,signature:await signProof(a.keys.privateKey,c)})).data;
  assert.equal(renewed.entry.epoch,2);
  assert.equal(receiver.fromTrustedEvent(f.calls.at(-1)),true);
  assert.equal((await receiver.verify(early,TOPIC)).reason,'NO_ACTIVE_BINDING');
  const latest=await signFrame(a.keys.privateKey,renewed.entry,'POSE',pose(1),1);
  assert.equal((await receiver.verify(latest,TOPIC)).ok,true);
  const lc=(await f.request('alice','POST','/challenge',{kind:'leave',topic:TOPIC,sid:a.entry.sid,publicJwk:a.publicJwk})).data;
  const left=(await f.request('alice','POST','/finish',{challengeId:lc.id,signature:await signProof(a.keys.privateKey,lc)})).data;
  assert.equal(left.event,'REVOKE');assert.equal(receiver.fromTrustedEvent(f.calls.at(-1)),true);
  assert.equal((await receiver.verify(await signFrame(a.keys.privateKey,renewed.entry,'POSE',pose(2),2),TOPIC)).reason,'NO_ACTIVE_BINDING');
 }finally{await f.close()}
});
test('RI-HTTP-08 expiration, challenge replay and late ban forbid admission',async()=>{
 const f=await fixture();try{
  const k=await makeKeyPair(),pub=await exportPublicKey(k);
  const c=(await f.request('alice','POST','/challenge',{kind:'register',topic:TOPIC,publicJwk:pub})).data;
  f.advance(21_000);
  const expired=await f.request('alice','POST','/finish',{challengeId:c.id,signature:await signProof(k.privateKey,c)});
  assert.equal(expired.status,409);
  const c2=(await f.request('alice','POST','/challenge',{kind:'register',topic:TOPIC,publicJwk:pub})).data;
  f.denied.add(U.alice);
  const denied=await f.request('alice','POST','/finish',{challengeId:c2.id,signature:await signProof(k.privateKey,c2)});
  assert.equal(denied.status,403);
 }finally{await f.close()}
});
test('RI-HTTP-09 room requires allowed permanent account and no guest',async()=>{
 const f=await fixture();try{
  const pub=await exportPublicKey(await makeKeyPair());
  assert.equal((await f.request('guest','POST','/challenge',{kind:'register',topic:ROOM,publicJwk:pub})).status,403);
  assert.equal((await f.request('gm','POST','/challenge',{kind:'register',topic:ROOM,publicJwk:pub})).status,403);
  assert.equal((await f.request('alice','POST','/challenge',{kind:'register',topic:ROOM,publicJwk:pub})).status,200);
 }finally{await f.close()}
});
test('RI-HTTP-10 unsigned V1, tamper, replay and wrong scope rejected',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice');const r=new VerifiedReceiver({now:f.now});r.reset(TOPIC);
  r.fromSnapshot((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data);
  assert.equal((await r.verify({v:1,sid:a.entry.sid},TOPIC)).reason,'BAD_ENVELOPE');
  const frame=await signFrame(a.keys.privateKey,a.entry,'ACTION',act('chat',1),1);
  assert.equal((await r.verify({...frame,topic:OTHER},TOPIC)).reason,'BAD_ENVELOPE');
  assert.equal((await r.verify({...frame,payload:act('chat',1,'tampered')},TOPIC)).reason,'SIGNATURE_INVALID');
  assert.equal((await r.verify(frame,TOPIC)).ok,true);
  assert.equal((await r.verify(frame,TOPIC)).reason,'REPLAY');
 }finally{await f.close()}
});
test('RI-HTTP-11 forged max-seq does not poison good session',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice'),b=await f.login('victim'),r=new VerifiedReceiver({now:f.now});r.reset(TOPIC);
  r.fromSnapshot((await f.request('victim','GET','/roster?topic='+encodeURIComponent(TOPIC))).data);
  const poisoned=await signFrame(b.keys.privateKey,{...b.entry,sid:a.entry.sid},'ACTION',act('chat',Number.MAX_SAFE_INTEGER),Number.MAX_SAFE_INTEGER);
  assert.equal((await r.verify(poisoned,TOPIC)).reason,'SIGNATURE_INVALID');
  assert.equal((await r.verify(await signFrame(a.keys.privateKey,a.entry,'ACTION',act('chat',1),1),TOPIC)).ok,true);
 }finally{await f.close()}
});
test('RI-HTTP-12 trusted event gap fails closed and requires HTTPS resnapshot',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice');const r=new VerifiedReceiver({now:f.now});r.reset(TOPIC);
  r.fromSnapshot((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data);
  assert.equal(r.fromTrustedEvent({type:'JOIN',topic:TOPIC,revision:r.revision+2,entry:a.entry}),false);
  assert.equal((await r.verify(await signFrame(a.keys.privateKey,a.entry,'POSE',pose(1),1),TOPIC)).reason,'ROSTER_UNSYNCED');
  assert.equal(r.fromSnapshot((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data),true);
 }finally{await f.close()}
});
test('RI-HTTP-13 backend-only revoke means valid signed frame is no longer trusted',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice'),r=new VerifiedReceiver({now:f.now});r.reset(TOPIC);
  r.fromSnapshot((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).data);
  const valid=await signFrame(a.keys.privateKey,a.entry,'POSE',pose(1),1);
  assert.equal((await r.verify(valid,TOPIC)).ok,true);
  assert.equal((await f.service.revokeByAuthority(U.alice)).sessionsRevoked,1);
  assert.equal(r.fromTrustedEvent(f.calls.at(-1)),true);
  assert.equal((await r.verify(await signFrame(a.keys.privateKey,a.entry,'POSE',pose(2),2),TOPIC)).reason,'NO_ACTIVE_BINDING');
  assert.equal((await f.request('alice','GET','/roster?topic='+encodeURIComponent(TOPIC))).status,403);
 }finally{await f.close()}
});
test('RI-HTTP-14 trusted channel mapping is disjoint from current campus/room data namespaces',()=>{
 assert.equal(trustedTopic(TOPIC),'world:trusted:campus:AREA_MAIN_HALL');
 assert.equal(trustedTopic(ROOM),'world:trusted:room:55555555-5555-4555-8555-555555555555');
 assert.throws(()=>trustedTopic('world:campus:RC_0_0'));
});
test('RI-HTTP-15 no arbitrary remote user revocation endpoint is exposed',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('alice','POST','/kick',{userId:U.victim})).status,404);
 }finally{await f.close()}
});
test('RI-HTTP-16 attacker cannot finish or renew another active user session',async()=>{
 const f=await fixture();try{
  const a=await f.login('alice'),keys=await makeKeyPair(),pub=await exportPublicKey(keys);
  const attempt=await f.request('victim','POST','/challenge',{kind:'renew',sid:a.entry.sid,topic:TOPIC,publicJwk:pub});
  assert.equal(attempt.status,403);
 }finally{await f.close()}
});
