import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSupabaseAuthVerifier} from '../src/supabase-auth.mjs';
import {IdentityService,MemoryIdentityStore} from '../src/identity-service.mjs';
import {VerifiedReceiver} from '../src/verified-receiver.mjs';
import {makeKeyPair,exportPublicKey,signFrame,signProof} from '../src/crypto.mjs';
const SQL=readFileSync(new URL('../sql/RI_TRUSTED_IDENTITY_ISOLATED_CANDIDATE.sql',import.meta.url),'utf8');
const usr='11111111-1111-4111-8111-111111111111',auth='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope='world:campus:AREA_MAIN_HALL';
const token=parts=>{
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({sub:usr,session_id:auth,exp:Math.floor(Date.now()/1000)+600,...parts})).toString('base64url');
 return `${header}.${claims}.signature-fixture-this-is-not-valid`;
};
const authFixture=({guest=false,session=true,banned=false,kicked=false}={})=>{
 let authCalls=0,sessionCalls=0;
 return {adapter:createSupabaseAuthVerifier({url:'https://test-only.supabase.co',publishableKey:'public-qa-key',
  fetcher:async (_url,{headers})=>{authCalls++;assert.equal(headers.apikey,'public-qa-key');return {ok:true,json:async()=>({id:usr,is_anonymous:guest})}},
  checkSession:async()=>{sessionCalls++;return session;},
  getProfile:async()=>({is_banned:banned,nickname:'사용자'}),isKickBlocked:async()=>kicked}),counts:()=>({authCalls,sessionCalls})};
};
test('RI-DB-01 trusted Realtime policy is SELECT-only and explicitly checks presence registry membership',()=>{
 assert.match(SQL,/CREATE POLICY "world ri trusted directory read"\s+ON realtime\.messages FOR SELECT TO authenticated/i);
 assert.match(SQL,/extension = 'broadcast'/i);
 assert.doesNotMatch(SQL,/CREATE POLICY[^;]+FOR INSERT/is);
 assert.match(SQL,/world_ri_can_read_trusted_topic_v1/);
 assert.match(SQL,/s\.user_id=v_uid AND s\.topic=v_source/);
 assert.match(SQL,/private\.world_session_kick_blocks/);
});
test('RI-DB-02 added private tables are shielded from anon and authenticated clients',()=>{
 for(const name of ['challenges','sessions','topic_revisions'])assert.match(SQL,new RegExp(`ALTER TABLE private\\.world_ri_${name} ENABLE ROW LEVEL SECURITY`));
 assert.match(SQL,/REVOKE ALL ON TABLE private\.world_ri_challenges,private\.world_ri_sessions,private\.world_ri_topic_revisions FROM PUBLIC,anon,authenticated/);
 assert.match(SQL,/GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE private\.world_ri_challenges,private\.world_ri_sessions,private\.world_ri_topic_revisions TO service_role/);
});
test('RI-DB-03 SQL does not rewrite existing Production migration or read permissions',()=>{
 assert.doesNotMatch(SQL,/DROP POLICY|DROP TABLE|TRUNCATE|DELETE\s+FROM/i);
 assert.doesNotMatch(SQL,/ALTER TABLE auth\.users|ALTER TABLE public\.profiles|ALTER TABLE public\.world_online_sessions/i);
});
test('RI-AUTH-01 verified /auth/v1/user determines guest (not user_metadata or input)',async()=>{
 const f=authFixture({guest:true});const who=await f.adapter.verify(token({is_anonymous:false,user_metadata:{isAdmin:true}}));
 assert.equal(who.guest,true);assert.equal(who.userId,usr);assert.equal(who.authSessionId,auth);
 assert.deepEqual(f.counts(),{authCalls:1,sessionCalls:1});
});
test('RI-AUTH-02 missing authenticated session invalidates otherwise valid Auth response',async()=>{
 const f=authFixture({session:false});assert.equal(await f.adapter.verify(token({})),null);
});
test('RI-AUTH-03 banned account remains denied even with a syntactically valid JWT',async()=>{
 const f=authFixture({banned:true});const who=await f.adapter.verify(token({}));assert.equal(who.banned,true);
});
test('RI-AUTH-04 kick status is returned as authority status for IdentityService denial',async()=>{
 const f=authFixture({kicked:true});const who=await f.adapter.verify(token({}));assert.equal(who.kicked,true);
});
test('RI-RECV-01 two concurrent deliveries with same signed frame cannot both be accepted',async()=>{
 const now=1000,store=new MemoryIdentityStore(),pub={async publish(){}};
 const svc=new IdentityService({auth:{verify:async()=>({userId:usr,authSessionId:auth,guest:false,displayName:'앨리스'})},
  store,publisher:pub,authorize:async()=>true,now:()=>now});
 const keys=await makeKeyPair(),publicJwk=await exportPublicKey(keys);
 const ch=await svc.challenge('Bearer '+'synthetic'.repeat(5),{kind:'register',topic:scope,publicJwk});
 const registered=await svc.finish('Bearer '+'synthetic'.repeat(5),{challengeId:ch.id,signature:await signProof(keys.privateKey,ch)});
 const recv=new VerifiedReceiver({now:()=>now});recv.reset(scope);
 recv.fromSnapshot(await svc.roster('Bearer '+'synthetic'.repeat(5),scope));
 const frame=await signFrame(keys.privateKey,registered.entry,'POSE',{v:1,seq:1,x:0,y:0,z:0},1);
 const [a,b]=await Promise.all([recv.verify(frame,scope),recv.verify(frame,scope)]);
 assert.equal([a,b].filter(v=>v.ok).length,1);
 assert.equal([a,b].filter(v=>v.reason==='REPLAY').length,1);
});
test('RI-RECV-02 asynchronous verification cannot resurrect revoked session',async()=>{
 const now=1000,store=new MemoryIdentityStore(),events=[];
 const svc=new IdentityService({auth:{verify:async()=>({userId:usr,authSessionId:auth,guest:false,displayName:'앨리스'})},
  store,publisher:{async publish(e){events.push(e)}},authorize:async()=>true,now:()=>now});
 const keys=await makeKeyPair(),pub=await exportPublicKey(keys),tkn='Bearer '+'synthetic'.repeat(5);
 const ch=await svc.challenge(tkn,{kind:'register',topic:scope,publicJwk:pub});
 const receipt=await svc.finish(tkn,{challengeId:ch.id,signature:await signProof(keys.privateKey,ch)});
 const recv=new VerifiedReceiver({now:()=>now});recv.reset(scope);recv.fromSnapshot(await svc.roster(tkn,scope));
 const msg=await signFrame(keys.privateKey,receipt.entry,'POSE',{v:1,seq:1,x:0},1);
 const pending=recv.verify(msg,scope);
 await svc.revokeByAuthority(usr);
 recv.fromTrustedEvent(events.at(-1));
 assert.notEqual((await pending).ok,true);
});

test('RI-AUTH-05 anonymous user without public profile stays eligible for guest-only presence',async()=>{
 const tok=token({});
 const verifier=createSupabaseAuthVerifier({url:'https://test-only.supabase.co',publishableKey:'qa-key',
   fetcher:async()=>({ok:true,json:async()=>({id:usr,is_anonymous:true})}),
   checkSession:async()=>true,getProfile:async()=>null,isKickBlocked:async()=>false});
 const actor=await verifier.verify(tok);
 assert.equal(actor.guest,true);assert.equal(actor.banned,false);assert.equal(actor.displayName,null);
});

test('RI-AUTH-06 missing authoritative is_anonymous signal is denied instead of assuming member',async()=>{
 const f=createSupabaseAuthVerifier({url:'https://test-only.supabase.co',publishableKey:'qa-key',
  fetcher:async()=>({ok:true,json:async()=>({id:usr})}),checkSession:async()=>true,getProfile:async()=>({nickname:'A'}),isKickBlocked:async()=>false});
 assert.equal(await f.verify(token({is_anonymous:false})),null);
});
