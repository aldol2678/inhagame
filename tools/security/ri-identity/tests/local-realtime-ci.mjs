/**
 * One-shot REAL localhost Supabase Realtime protocol gate (not a mock).
 * Refuses remote API and DB URLs before all writes; disposable local Auth only.
 * Distinct from the 30 fake-backed crypto/HTTP tests.
 * Requires: Supabase local stack, psql, Node 24 WebSocket, local env from `supabase status`.
 */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {makeKeyPair,exportPublicKey} from '../src/crypto.mjs';

const SAFE_HOST = new Set(['127.0.0.1','localhost','[::1]']);
if (process.env.RI_REQUIRE_LOCAL_ONLY!=='1') throw Error('RI_CI_GUARD: explicit local-only opt-in required');
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_DB_PASSWORD) throw Error('RI_CI_GUARD: remote Supabase credential present');
const repoRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const config=readFileSync(new URL('../../../../supabase/config.toml',import.meta.url),'utf8');
assert.match(config,/^project_id\s*=\s*"p2-public-local"/m,'local config not pinned to disposable public project');
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const api=new URL(status.API_URL||'');
const db=new URL(status.DB_URL||'');
if(api.protocol!=='http:'||db.protocol!=='postgresql:'&&db.protocol!=='postgres:'||!SAFE_HOST.has(api.hostname)||!SAFE_HOST.has(db.hostname)||!status.ANON_KEY||!status.SERVICE_ROLE_KEY){
  throw Error('RI_CI_GUARD: non-local URL or missing local keys');
}
const base=api.href.replace(/\/$/,'');
const trusted='world:trusted:campus:AREA_MAIN_HALL';
const source='world:campus:AREA_MAIN_HALL';
const cases=[];
function ok(condition,label,details=''){cases.push({label,ok:!!condition,details});assert.ok(condition,`${label}: ${details}`);}
function psql(sql,options={}){
  const args=['-X','-q','-v','ON_ERROR_STOP=1','-d',db.href];
  if(options.file)args.push('-f',options.file);else args.push('-At','-c',sql);
  const p=spawnSync('psql',args,{encoding:'utf8',timeout:45000,env:{...process.env,PGCONNECT_TIMEOUT:'5'}});
  if(p.error||p.status!==0)throw Error(`LOCAL_PSQL_FAILED:${String(p.error||p.stderr).slice(0,280)}`);
  return (p.stdout||'').trim();
}
async function auth(path,body,key=status.ANON_KEY,method='POST'){
  const res=await fetch(`${base}/auth/v1/${path}`,{method,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const text=await res.text();let value;try{value=JSON.parse(text)}catch{value={error:text.slice(0,100)}}
  if(!res.ok)throw Error(`LOCAL_AUTH_${res.status}:${path}:${JSON.stringify(value).slice(0,150)}`);
  return value;
}
async function syntheticMember(label){
  const email=`ri-ci-${label}-${randomUUID()}@example.test`;
  const password=randomBytes(24).toString('base64url');
  const created=await auth('admin/users',{email,password,email_confirm:true},status.SERVICE_ROLE_KEY);
  const session=await auth('token?grant_type=password',{email,password});
  const token=session.access_token;
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  assert.match(claims.session_id,/^[0-9a-f-]{36}$/i);
  assert.equal(claims.sub,created.id);
  return {userId:created.id,authSessionId:claims.session_id,token};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class PhoenixClient {
  constructor(userToken,channelTopic){
    this.token=userToken;this.channelTopic=channelTopic;
    this.messages=[];this.pending=new Set();this.seq=0;
    const ws=new URL(`${api.protocol==='http:'?'ws:':'wss:'}//${api.host}/realtime/v1/websocket`);
    ws.searchParams.set('apikey',status.ANON_KEY);
    ws.searchParams.set('vsn','1.0.0');
    this.socket=new WebSocket(ws);
    this.ready=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('WEBSOCKET_OPEN_TIMEOUT')),10000);
      this.socket.addEventListener('open',()=>{clearTimeout(timeout);resolve()},{once:true});
      this.socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('WEBSOCKET_CONNECT_ERROR'))},{once:true});
    });
    this.socket.addEventListener('message',e=>{
      try{this.messages.push(JSON.parse(e.data));for(const cb of this.pending)cb();}catch{ /* invalid wire ignored, assertions eventually fail */ }
    });
  }
  async emit(event,payload,ref){
    await this.ready;
    this.socket.send(JSON.stringify({topic:`realtime:${this.channelTopic}`,event,payload,ref,join_ref:'1'}));
  }
  async wait(predicate,timeoutMs=8500){
    const hit=()=>this.messages.find(predicate);
    if(hit())return hit();
    return new Promise(resolve=>{
      const stop=()=>{clearTimeout(timer);this.pending.delete(handler)};
      const handler=()=>{const m=hit();if(m){stop();resolve(m)}};
      const timer=setTimeout(()=>{stop();resolve(null)},timeoutMs);
      this.pending.add(handler);
    });
  }
  async join(){
    await this.emit('phx_join',{config:{broadcast:{ack:true,self:false},presence:{enabled:false},private:true,postgres_changes:[]},access_token:this.token},'1');
    const msg=await this.wait(m=>m.event==='phx_reply' && String(m.ref)==='1');
    return {accepted:msg?.payload?.status==='ok',status:msg?.payload?.status||'TIMEOUT',response:msg};
  }
  async broadcast(marker){
    const ref=String(++this.seq+1);
    await this.emit('broadcast',{type:'broadcast',event:'ri.qa.client-write',payload:{marker}},ref);
    const msg=await this.wait(m=>m.event==='phx_reply' && String(m.ref)===ref,6500);
    return {status:msg?.payload?.status||'NO_ACK',message:msg};
  }
  close(){try{this.socket.close(1000,'done')}catch{}}
}
const active=[];
try{
  const sqlPath=fileURLToPath(new URL('../sql/RI_TRUSTED_IDENTITY_ISOLATED_CANDIDATE.sql',import.meta.url));
  psql(null,{file:sqlPath});
  ok(psql(`SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='world ri trusted directory read' AND cmd='SELECT'`)==='1','RI trusted RLS SELECT policy installed');
  ok(psql(`SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='world ri trusted directory read' AND cmd='INSERT'`)==='0','No RI trusted client INSERT policy');
  const a=await syntheticMember('a'),b=await syntheticMember('b');
  ok(a.userId!==b.userId,'Two separate real local Auth identities');
  const notYet=new PhoenixClient(a.token,trusted);active.push(notYet);
  const before=await notYet.join();ok(!before.accepted && before.status!=='TIMEOUT','Unregistered member blocked from trusted channel',before.status);
  notYet.close();
  const keys=await makeKeyPair();const jwk=await exportPublicKey(keys);
  const sid=randomUUID();
  // Only disposable DB inputs; every variable is synthetic or strictly validated as UUID/EC JWK.
  for(const v of [a.userId,a.authSessionId,sid])assert.match(v,/^[0-9a-f-]{36}$/i);
  const escapedJwk=JSON.stringify(jwk).replaceAll("'","''");
  psql(`INSERT INTO private.world_ri_sessions(sid,user_id,auth_session_id,guest,display_name,topic,epoch,public_jwk,issued_at,expires_at,revision) VALUES ('${sid}'::uuid,'${a.userId}'::uuid,'${a.authSessionId}'::uuid,false,'QA MEMBER','${source}',1,'${escapedJwk}'::jsonb,now(),now()+interval '10 minutes',1)`);
  const allowed=new PhoenixClient(a.token,trusted);active.push(allowed);
  const joined=await allowed.join();ok(joined.accepted,'Registered member joins actual local Realtime',joined.status);
  const outsider=new PhoenixClient(b.token,trusted);active.push(outsider);
  const denied=await outsider.join();ok(!denied.accepted && denied.status!=='TIMEOUT','Unregistered member denied by Realtime RLS',denied.status);
  const attempted=await allowed.broadcast(randomUUID());
  ok(attempted.status!=='ok','Verified subscriber cannot broadcast to trusted topic',attempted.status);
  const marker=randomUUID();
  let received=null;
  for(let n=0;n<3 && !received;n++){
    // PostgreSQL-originated server broadcast, not a direct client channel send.
    psql(`SELECT realtime.send(jsonb_build_object('probe','${marker}'),'ri.qa.server','${trusted}',true)`);
    received=await allowed.wait(m=>m.event==='broadcast'&&m.payload?.event==='ri.qa.server'&&m.payload?.payload?.probe===marker,4500);
    if(!received)await sleep(300);
  }
  ok(!!received,'Server-originated private Broadcast received over WebSocket');
  ok(!outsider.messages.some(m=>m.event==='broadcast'&&m.payload?.event==='ri.qa.server'),'Denied member receives no trusted broadcasts');
  const legacy=new PhoenixClient(b.token,source);active.push(legacy);
  const legacyJoined=await legacy.join();ok(legacyJoined.accepted,'Existing campus channel remains accessible to signed-in users',legacyJoined.status);
  const blockedRoom=new PhoenixClient(a.token,'world:trusted:room:11111111-1111-4111-8111-111111111111');active.push(blockedRoom);
  const roomJoin=await blockedRoom.join();ok(!roomJoin.accepted && roomJoin.status!=='TIMEOUT','Unknown personal room trusted topic denied',roomJoin.status);
  psql(`UPDATE private.world_ri_sessions SET revoked_at=now() WHERE sid='${sid}'::uuid`);
  const revoked=new PhoenixClient(a.token,trusted);active.push(revoked);
  const revokeJoin=await revoked.join();ok(!revokeJoin.accepted && revokeJoin.status!=='TIMEOUT','Revoked member cannot rejoin trusted channel',revokeJoin.status);
  console.log(JSON.stringify({gate:'LOCAL_SUPABASE_REALTIME_WEBSOCKET',result:'PASS',cases,provider:'local Docker Supabase only',production:'NOT_TOUCHED',existingWebsocketRevoke:'NOT_PROVEN'}));
}finally{
  for(const socket of active)socket.close();
}
