import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningProgress,emptyProgress} from '../src/learning/learning-progress.js';
import {createLearningSync} from '../src/learning/learning-sync.js';
import {createLearningCloudTransport,LEARNING_CLOUD_RELEASE} from '../src/learning/learning-cloud.js';
import {createLearningCatalog} from '../src/learning/learning-content.js';
import {memoryStorage,learningFixture} from './support/learning-fixture.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function backend(){
 const rows=new Map(),requests=new Map();let writes=0,reads=0,lost=false,failRead=false,hold=null;
 return {rows,requests,get writes(){return writes;},get reads(){return reads;},set lost(v){lost=v;},set failRead(v){failRead=v;},set hold(v){hold=v;},enabled:true,
 async read(account){reads++;if(failRead)throw Error('NETWORK');return clone(rows.get(account)||{owner:account,revision:0,progress:null});},
 async write(account,p){writes++;if(hold)await hold;
 const key=account+p.id,prior=requests.get(key);if(prior){assert.deepEqual(prior.pending,p);return clone(prior.ack);}
 if((rows.get(account)?.revision??0)!==p.revision)throw Error('CONFLICT');
 const ack={owner:account,revision:p.revision+1,requestId:p.id};rows.set(account,{owner:account,revision:ack.revision,progress:clone(p.progress)});requests.set(key,{pending:clone(p),ack});
 if(lost){lost=false;throw Error('NETWORK');}return ack;}
 };
}
function setup(server,{storage=memoryStorage(),account=A,win={navigator:{onLine:true}},onStatus=()=>{},isBusy=()=>false}={}){
 const progress=createLearningProgress({getStorage:()=>storage});progress.setAccount(account);
 const sync=createLearningSync({progress,transport:server,getStorage:()=>storage,win,onStatus,isBusy,retryMs:100000});sync.setAccount(account);
 return {progress,sync,storage,win};
}
async function settled(s){await s.sync.sync();}
function complete(s,id='e01'){s.progress.state.completed[id]=true;assert.equal(s.progress.save(),true);}
test('release OFF performs no RPC; session mismatch/anonymous denied; JWT pinned and abort forwarded',async()=>{
 assert.equal(LEARNING_CLOUD_RELEASE.enabled,false);let args;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:A,is_anonymous:false},access_token:'SYNTHETIC_A'}}})},rpc(name,body){args={name,body};return {setHeader(k,v){args[k]=v;return this;},abortSignal(signal){args.signal=signal;return Promise.resolve({data:{owner:A,revision:0,progress:null}});}};}};
 await assert.rejects(createLearningCloudTransport({getClient:()=>client}).read(A),/UNAVAILABLE/);assert.equal(args,undefined);
 const cloud=createLearningCloudTransport({getClient:()=>client,enabled:true}),ac=new AbortController();
 await assert.rejects(cloud.read(B,ac.signal),/ACCOUNT_CHANGED/);await cloud.read(A,ac.signal);assert.equal(args.Authorization,'Bearer SYNTHETIC_A');assert.equal(args.signal,ac.signal);
 client.auth.getSession=async()=>({data:{session:{user:{id:A,is_anonymous:true}}}});await assert.rejects(cloud.read(A,ac.signal),/ACCOUNT_CHANGED/);
});
test('A saves, reloads and restores on a different device; B and guest see no A',async()=>{
 const server=backend(),a=setup(server);await settled(a);complete(a);await settled(a);assert.equal(a.sync.snapshot().status,'synced');
 const fresh=setup(server);await settled(fresh);assert.equal(fresh.progress.state.completed.e01,true);
 fresh.sync.setAccount(null);fresh.progress.setAccount(B);fresh.sync.setAccount(B);await settled(fresh);assert.deepEqual(fresh.progress.state.completed,{});
 fresh.sync.setAccount(null);fresh.progress.setAccount(null);assert.deepEqual(fresh.progress.state.completed,{});assert.equal(server.rows.has(B),false);
 a.sync.dispose();fresh.sync.dispose();
});
test('lost response retries immutable ID after restart; separate readback required',async()=>{
 const server=backend(),a=setup(server);await settled(a);complete(a);server.lost=true;await settled(a);
 assert.equal(a.sync.snapshot().status,'retry');assert.equal(a.sync.snapshot().pending,true);assert.equal(server.rows.get(A).revision,1);a.sync.dispose();
 const statuses=[],again=setup(server,{storage:a.storage,onStatus:s=>statuses.push(s.status)});await settled(again);
 assert.equal(server.rows.get(A).revision,1);assert.equal(server.requests.size,1);assert.equal(again.sync.snapshot().status,'synced');assert.ok(statuses.includes('acknowledged'));again.sync.dispose();
});
test('server accepted but readback fails is never synced; retry does not double count',async()=>{
 const server=backend(),a=setup(server);await settled(a);complete(a);const write=server.write;server.write=async(...args)=>{const ack=await write(...args);server.failRead=true;return ack;};
 await settled(a);assert.equal(a.sync.snapshot().status,'retry');assert.equal(a.sync.snapshot().pending,true);
 server.write=write;server.failRead=false;await settled(a);assert.equal(a.sync.snapshot().status,'synced');assert.equal(server.rows.get(A).revision,1);a.sync.dispose();
});
test('offline edits remain durable and reconnect safely syncs',async()=>{
 const server=backend(),a=setup(server);await settled(a);a.win.navigator.onLine=false;complete(a,'e02');await settled(a);assert.equal(a.sync.snapshot().status,'offline');assert.equal(server.writes,0);
 a.win.navigator.onLine=true;await settled(a);assert.equal(server.rows.get(A).progress.completed.e02,true);a.sync.dispose();
});
test('two devices conflict; no automatic merge; explicit local resolution uses current revision',async()=>{
 const server=backend(),a=setup(server),b=setup(server);await Promise.all([settled(a),settled(b)]);complete(a);complete(b,'e02');await settled(a);await settled(b);
 assert.equal(b.sync.snapshot().status,'conflict');assert.deepEqual(b.progress.state.completed,{e02:true});assert.deepEqual(server.rows.get(A).progress.completed,{e01:true});
 await b.sync.resolve('local');assert.equal(b.sync.snapshot().status,'synced');assert.deepEqual(server.rows.get(A).progress.completed,{e02:true});
 assert.ok([...b.storage.rows.keys()].some(k=>k.includes(':recovery:')));a.sync.dispose();b.sync.dispose();
});
test('server advances while conflict prompt is open: confirmation must be reviewed again',async()=>{
 const server=backend(),a=setup(server),b=setup(server);await Promise.all([settled(a),settled(b)]);complete(a);await settled(a);complete(b,'e02');await settled(b);complete(a,'e03');await settled(a);
 await b.sync.resolve('cloud');assert.equal(b.sync.snapshot().status,'conflict');assert.deepEqual(b.progress.state.completed,{e02:true});
 await b.sync.resolve('cloud');assert.equal(b.sync.snapshot().status,'synced');assert.deepEqual(b.progress.state.completed,{e01:true,e03:true});a.sync.dispose();b.sync.dispose();
});
test('logout/account switch during write aborts UI ownership even if server commits late',async()=>{
 const server=backend(),a=setup(server);await settled(a);let release;server.hold=new Promise(r=>release=r);complete(a);const pending=a.sync.sync();await new Promise(r=>setImmediate(r));
 a.sync.setAccount(null);a.progress.setAccount(B);a.sync.setAccount(B);await settled(a);release();await pending;
 assert.deepEqual(a.progress.state.completed,{});assert.equal(a.sync.snapshot().revision,0);assert.equal(server.rows.has(B),false);a.sync.dispose();
});
test('editing during pending save preserves latest record and uploads a second revision',async()=>{
 const server=backend(),a=setup(server);await settled(a);let release;server.hold=new Promise(r=>release=r);complete(a);const pending=a.sync.sync();await new Promise(r=>setImmediate(r));complete(a,'e02');server.hold=null;release();await pending;
 assert.deepEqual(server.rows.get(A).progress.completed,{e01:true,e02:true});assert.equal(server.rows.get(A).revision,2);a.sync.dispose();
});
test('legacy backup imports locally then cloud readback; no answers, rewards or ranks',async()=>{
 const server=backend(),a=setup(server);await settled(a);a.progress.import(JSON.stringify({completed:{e03:true},masteries:{'e03-0':{level:1}},wrong:{'e03-0':true},coins:99,rank:10,answer:'secret'}),{catalog:createLearningCatalog(learningFixture()),confirm:true});
 await settled(a);assert.equal(a.sync.snapshot().status,'synced');assert.ok(server.rows.get(A).progress.masteries['qv:test.en.e03.p1@1']);assert.doesNotMatch(JSON.stringify(server.rows.get(A)),/secret|coins|rank/);a.sync.dispose();
});
test('unknown local/outbox versions and malformed server payload fail closed',async()=>{
 const server=backend(),storage=memoryStorage();storage.setItem(`inha-world-learning-sync-v1:user:${A}`,JSON.stringify({version:2}));const a=setup(server,{storage});await settled(a);assert.equal(a.sync.snapshot().status,'blocked');assert.equal(server.reads,0);a.sync.dispose();
 server.rows.set(A,{owner:A,revision:1,progress:{...emptyProgress(),answer:'not allowed'}});const b=setup(server);await settled(b);assert.equal(b.sync.snapshot().status,'blocked');assert.deepEqual(b.progress.state.completed,{});b.sync.dispose();
});
test('active question defers remote restore; metadata race and archive failure never overwrite',async()=>{
 const server=backend(),a=setup(server);await settled(a);complete(a);await settled(a);
 let busy=true;const b=setup(server,{isBusy:()=>busy});await settled(b);assert.equal(b.sync.snapshot().status,'deferred');assert.deepEqual(b.progress.state.completed,{});busy=false;await settled(b);assert.equal(b.progress.state.completed.e01,true);
 b.storage.setItem(`inha-world-learning-sync-v1:user:${A}`,'other tab');complete(b,'e02');await settled(b);assert.equal(b.sync.snapshot().status,'blocked');assert.equal(server.rows.get(A).revision,1);a.sync.dispose();b.sync.dispose();
});
