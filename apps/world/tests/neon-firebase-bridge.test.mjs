import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeonAuthReadBridge,NeonAuthBridgeError} from '../src/neon-auth/read-bridge.js';
import {neonAuthQaAllowed} from '../src/neon-auth/qa-ui.js';
import {onRequest} from '../functions/neon-qa/[[path]].js';

const DEVICE='11111111-1111-4111-8111-111111111111';
const PROFILE='22222222-2222-4222-8222-222222222222';
const FIREBASE_UID='firebase-uid-for-test';
const TOKEN='e'.repeat(200);
const SESSION_KEY='inhaworld-firebase-session-v1';
const PROFILE_KEY='inhaworld-profile-user-v1';
const store=(initial={})=>{
  const map=new Map(Object.entries(initial));
  return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k),snapshot:()=>Object.fromEntries(map)};
};
function response(status,body){return {ok:status>=200&&status<300,status,json:async()=>body};}
function rig({initial={},responses={}}={}){
 const memory=store(initial),calls=[];
 const bridge=createNeonAuthReadBridge({
   storage:memory,baseUrl:'https://inhagame-playcanvas-live.pages.dev',apiPrefix:'/neon-qa',
   fetchImpl:async(url,options)=>{
     calls.push({url,options});
     const path=new URL(url).pathname.replace(/^\/neon-qa/,'');
     return responses[path]??response(404,{error:'NOT_FOUND'});
   }
 });
 return {memory,calls,bridge};
}
test('QA UI stays off on live official domain and needs explicit preview flag',()=>{
 assert.equal(neonAuthQaAllowed('inhagame.app','?neon_auth_qa=1'),false);
 assert.equal(neonAuthQaAllowed('evilinhagame-playcanvas-live.pages.dev.attacker.tld','?neon_auth_qa=1'),false);
 assert.equal(neonAuthQaAllowed('inhagame-playcanvas-live.pages.dev',''),false);
 assert.equal(neonAuthQaAllowed('abc.inhagame-playcanvas-live.pages.dev','?neon_auth_qa=1'),true);
});
test('Bridge fails closed on HTTP, arbitrary proxy prefixes and invalid local sessions',async()=>{
 assert.throws(()=>createNeonAuthReadBridge({baseUrl:'http://remote.example',storage:store(),fetchImpl:async()=>{}}),/HTTPS_REQUIRED/);
 assert.throws(()=>createNeonAuthReadBridge({baseUrl:'https://example.com',apiPrefix:'/api',storage:store(),fetchImpl:async()=>{}}),/INVALID_API_PREFIX/);
 const {bridge,calls}=rig({initial:{[SESSION_KEY]:'not-a-session'}});
 await assert.rejects(bridge.me(),e=>e.code==='AUTH_REQUIRED');
 assert.equal(calls.length,0);
});
test('No guest bridge proof, no profile writes and verified Firebase UID only',async()=>{
 const {bridge,calls,memory}=rig({responses:{
  '/api/auth/firebase/login':response(200,{deviceSessionId:DEVICE,userId:null}),
  '/api/auth/firebase/me':response(200,{firebaseUid:FIREBASE_UID,guest:true,profileUserId:null})
 }});
 const result=await bridge.login(TOKEN,{expectedUid:FIREBASE_UID});
 assert.equal(result.linked,false);
 assert.equal(bridge.getSessionId(),DEVICE);
 assert.equal(memory.getItem(PROFILE_KEY),null);
 assert.equal(calls[0].options.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].options.body),{idToken:TOKEN});
 assert.equal(calls[0].url,'https://inhagame-playcanvas-live.pages.dev/neon-qa/api/auth/firebase/login');
 assert.equal(calls[0].options.credentials,'omit');
 assert.equal(calls[1].options.headers['X-Session-Id'],DEVICE);
 assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
});
test('Server UUID malformed response cannot create trusted local session',async()=>{
 const {bridge,memory}=rig({responses:{
  '/api/auth/firebase/login':response(200,{deviceSessionId:'wrong',userId:PROFILE})
 }});
 await assert.rejects(bridge.login(TOKEN,{expectedUid:FIREBASE_UID}),e=>e.code==='INVALID_SESSION_RESPONSE');
 assert.equal(memory.getItem(SESSION_KEY),null);
});
test('Server Firebase UID mismatch clears device session',async()=>{
 const {bridge,memory}=rig({responses:{
  '/api/auth/firebase/login':response(200,{deviceSessionId:DEVICE}),
  '/api/auth/firebase/me':response(200,{firebaseUid:'another-uid',guest:false,profileUserId:PROFILE})
 }});
 await assert.rejects(bridge.login(TOKEN,{expectedUid:FIREBASE_UID}),e=>e.code==='FIREBASE_UID_MISMATCH');
 assert.equal(memory.getItem(SESSION_KEY),null);
 assert.equal(memory.getItem(PROFILE_KEY),null);
});
test('Read-only snapshot follows verified device session and exposes no mutating method',async()=>{
 const replies={};
 for(const path of ['/api/world-profile','/api/world-wallet','/api/world-progression','/api/world-inventory'])
  replies[path]=response(200,{snapshot:path});
 replies['/api/auth/firebase/me']=response(200,{firebaseUid:FIREBASE_UID,guest:false,profileUserId:PROFILE});
 const {bridge,calls,memory}=rig({initial:{[SESSION_KEY]:DEVICE},responses:replies});
 const result=await bridge.readSnapshot();
 assert.equal(result.linked,true);
 assert.equal(Object.keys(result.resources).length,4);
 assert(result.resources.wallet.ok);
 assert.equal(memory.getItem(PROFILE_KEY),PROFILE);
 assert.equal(calls.length,5);
 assert(calls.every(x=>x.options.method==='GET'&&x.options.headers['X-Session-Id']===DEVICE));
 assert.equal(bridge.createProfile,undefined);
 assert.equal(bridge.saveProgress,undefined);
 assert.equal(bridge.link,undefined);
});
test('401 invalidates only local session and prevents any follow-on reads',async()=>{
 const {bridge,memory,calls}=rig({initial:{[SESSION_KEY]:DEVICE,[PROFILE_KEY]:PROFILE},responses:{
  '/api/auth/firebase/me':response(401,{error:'AUTH_REQUIRED'})
 }});
 await assert.rejects(bridge.readSnapshot(),e=>e.status===401);
 assert.equal(calls.length,1);
 assert.equal(memory.getItem(SESSION_KEY),null);
 assert.equal(memory.getItem(PROFILE_KEY),null);
});
test('Network failures do not fabricate profiles or clear a valid session',async()=>{
 const memory=store({[SESSION_KEY]:DEVICE});
 const b=createNeonAuthReadBridge({storage:memory,baseUrl:'https://x.pages.dev',
  fetchImpl:()=>Promise.reject(new Error('offline'))});
 await assert.rejects(b.me(),e=>e.code==='NETWORK_UNAVAILABLE');
 assert.equal(memory.getItem(SESSION_KEY),DEVICE);
});
test('In-flight session read cannot restore a profile after signout',async()=>{
 let fulfill;
 const pending=new Promise(r=>{fulfill=r;});
 const memory=store({[SESSION_KEY]:DEVICE});
 const b=createNeonAuthReadBridge({storage:memory,baseUrl:'https://x.pages.dev',fetchImpl:()=>pending});
 const p=b.me();b.forgetSession();
 fulfill(response(200,{firebaseUid:FIREBASE_UID,guest:false,profileUserId:PROFILE}));
 await assert.rejects(p,e=>e.code==='STALE_AUTH_RESPONSE');
 assert.equal(memory.getItem(PROFILE_KEY),null);
});
test('Logout calls only device endpoint then clears local state',async()=>{
 const {bridge,calls,memory}=rig({initial:{[SESSION_KEY]:DEVICE},responses:{
  '/api/auth/firebase/logout':response(200,{ok:true})
 }});
 assert.deepEqual(await bridge.logout(),{ok:true});
 assert.equal(memory.getItem(SESSION_KEY),null);
 assert.equal(calls[0].options.headers['X-Session-Id'],DEVICE);
});
function proxyRequest(path,{host='abc.inhagame-playcanvas-live.pages.dev',method='GET',headers={},body}={}){
 return new Request('https://'+host+path,{method,headers,body});
}
test('QA proxy blocks official hostname, mutable data endpoints and cross-site origin',async()=>{
 const examples=[
  [proxyRequest('/neon-qa/api/auth/firebase/config',{host:'inhagame.app'}),404],
  [proxyRequest('/neon-qa/api/world-wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),405],
  [proxyRequest('/neon-qa/api/auth/firebase/link',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),405],
  [proxyRequest('/neon-qa/api/world-profile',{headers:{Origin:'https://evil.example'}}),403],
  [proxyRequest('/neon-qa/api/world-profile?unsafe=1'),400],
  [proxyRequest('/neon-qa/api/world-profile',{headers:{'X-Session-Id':'other-user'}}),400],
 ];
 for(const [request,status] of examples) assert.equal((await onRequest({request})).status,status);
});
test('QA proxy forwards allowlisted GET to Tier4 Worker with validated session only',async()=>{
 const originalFetch=globalThis.fetch,calls=[];
 try {
  globalThis.fetch=async(url,options)=>{
   calls.push({url,options});return new Response(JSON.stringify({guest:false}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const request=proxyRequest('/neon-qa/api/auth/firebase/me',{headers:{'X-Session-Id':DEVICE}});
  const result=await onRequest({request});
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{guest:false});
  assert.equal(calls[0].url,'https://inha-world-tier04.aldol-lab.workers.dev/api/auth/firebase/me');
  assert.equal(calls[0].options.headers.get('X-Session-Id'),DEVICE);
  assert.equal(calls[0].options.headers.get('Authorization'),null);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
 } finally {globalThis.fetch=originalFetch;}
});
