import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCollectionBookClient } from '../src/collection/collection-book-client.js';
const cloud = await import('../npc-factory/collection-book-cloud-handler.mjs').catch(() => ({}));
const proxy = await import('../server/collection-book-proxy.mjs').catch(() => ({}));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const token='Bearer '+'a'.repeat(30),other='Bearer '+'b'.repeat(30);
const empty=()=>({version:1,entries:[],discoveredCount:0,trackableCount:0});
const raw=actor=>({userId:actor,entries:[{entryId:'collection.fish.carp',category:'FISH',persistenceMode:'SERVER_PERSISTED',
  ownerDomain:null,ownerRef:null,catalogStatus:'ACTIVE',definitionVersion:1,discoveryState:'UNKNOWN',discovered:false,
  firstDiscoveredAt:null,lastDiscoveredAt:null,discoveryCount:0,version:0,sourceRef:'PRIVATE'}]});
const req=(extra={})=>({method:'GET',url:'/api/world-collection-book',headers:{host:'world.test',authorization:token},...extra});
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},writeHead(n){this.code=n;},
  json(body){this.data=body;return this;},end(body){if(body)this.data=JSON.parse(body);return this;}};}
const native=(extra={})=>Object.assign(Readable.from([]),req({url:'/collection-book',...extra}));
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('native Cloud GET verifies permanent actor and projects only its ledger',async()=>{
  assert.equal(typeof cloud.createCollectionBookCloudHandler,'function'); const calls=[];
  const handler=cloud.createCollectionBookCloudHandler({verifyUser:async auth=>auth===token?A:auth===other?B:null,
    rpc:async(name,args)=>{calls.push({name,args});return raw(args.p_user);}});
  for(const [authorization,actor] of [[token,A],[other,B]]){const r=res();await handler(native({headers:{host:'cloud.test',authorization}}),r);
    assert.equal(r.code,200);assert.equal(r.data.entries[0].state,'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(r.data),/carp|붕어|PRIVATE|userId|sourceRef/);assert.equal(calls.at(-1).args.p_user,actor);
    assert.equal(calls.at(-1).name,'world_collection_list_v1');assert.equal(r.headers['Cache-Control'],'private, no-store');}
});
test('native Cloud rejects anonymous, foreign ledger, query and framed GET bodies before RPC',async()=>{
  assert.equal(typeof cloud.createCollectionBookCloudHandler,'function');let reads=0;
  const handler=cloud.createCollectionBookCloudHandler({verifyUser:async auth=>auth?A:null,rpc:async()=>{reads++;return raw(B);}});
  for(const [extra,status] of [[{headers:{host:'cloud.test'}},401],[{method:'POST'},405],[{url:'/collection-book?userId='+B},400],
    [{headers:{'content-length':'2',authorization:token}},400],[{headers:{'transfer-encoding':'chunked',authorization:token}},400],
    [{headers:{'content-length':'invalid',authorization:token}},400],[{headers:{host:'cloud.test',origin:'https://other.test',authorization:token}},403]]){
    const r=res();await handler(native(extra),r);assert.equal(r.code,status);assert.equal(reads,0);}
  const r=res();await handler(native(),r);assert.equal(r.code,503);assert.deepEqual(r.data,{error:'COLLECTION_BOOK_UNAVAILABLE'});
});
test('fixed proxy forwards only Bearer to configured HTTPS read path and strips extra response fields',async()=>{
  assert.equal(typeof proxy.createCollectionBookProxy,'function');let calls=0;
  const handler=proxy.createCollectionBookProxy({url:'https://trusted.test/',fetcher:async(url,options)=>{
    calls++;assert.equal(url,'https://trusted.test/collection-book');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');assert.deepEqual(options.headers,{Authorization:token});assert.equal(options.body,undefined);
    assert.ok(options.signal instanceof AbortSignal);return response({...empty(),userId:A,serviceRole:'PRIVATE'});}});
  const r=res();await handler(req({headers:{host:'world.test',origin:'https://world.test',authorization:token,cookie:'private',actor:B}}),r);
  assert.equal(calls,1);assert.equal(r.code,200);assert.deepEqual(r.data,empty());assert.equal(r.headers.Vary,'Authorization');
});
test('proxy rejects method, query, body, cross-origin and missing credentials without forwarding',async()=>{
  assert.equal(typeof proxy.createCollectionBookProxy,'function');const handler=proxy.createCollectionBookProxy({url:'https://trusted.test',fetcher:()=>assert.fail()});
  for(const [extra,status] of [[{method:'POST'},405],[{url:'/api/world-collection-book?userId='+B},400],[{body:{userId:B}},400],
    [{headers:{host:'world.test',origin:'https://evil.test',authorization:token}},403],[{headers:{host:'world.test'}},401],
    [{headers:{host:'world.test',authorization:'Bearer invalid'}},401]]){const r=res();await handler(req(extra),r);assert.equal(r.code,status);}
});
test('proxy fails closed on absent or unsafe backend configuration',async()=>{
  assert.equal(typeof proxy.createCollectionBookProxy,'function');
  for(const url of [undefined,'','http://trusted.test','https://user:secret@trusted.test','https://trusted.test?dest=evil','https://trusted.test#x']){
    const r=res();await proxy.createCollectionBookProxy({url,fetcher:()=>assert.fail()})(req(),r);assert.equal(r.code,503);assert.deepEqual(r.data,{error:'COLLECTION_BOOK_UNAVAILABLE'});}
});
test('proxy sanitizes upstream failures, rejects raw ledgers and oversized payloads',async()=>{
  assert.equal(typeof proxy.createCollectionBookProxy,'function');
  for(const [reply,status,error] of [[response({error:'AUTH_REQUIRED'},401),401,'AUTH_REQUIRED'],[response({error:'ACCOUNT_UNAVAILABLE'},403),403,'ACCOUNT_UNAVAILABLE'],
    [response({error:'private'},401),503,'COLLECTION_BOOK_UNAVAILABLE'],[response({error:'private'},403),503,'COLLECTION_BOOK_UNAVAILABLE'],
    [response({private:'secret'},500),503,'COLLECTION_BOOK_UNAVAILABLE'],[response(raw(A)),503,'COLLECTION_BOOK_UNAVAILABLE'],
    [new Response('not json'),503,'COLLECTION_BOOK_UNAVAILABLE'],[new Response(' '.repeat(1048577)),503,'COLLECTION_BOOK_UNAVAILABLE'],
    [response(empty(),302),503,'COLLECTION_BOOK_UNAVAILABLE']]){const r=res();await proxy.createCollectionBookProxy({url:'https://trusted.test',fetcher:async()=>reply})(req(),r);
    assert.equal(r.code,status);assert.deepEqual(r.data,{error});}
  const r=res();await proxy.createCollectionBookProxy({url:'https://trusted.test',fetcher:async()=>{throw Error('PRIVATE timeout or redirect');}})(req(),r);
  assert.equal(r.code,503);assert.deepEqual(r.data,{error:'COLLECTION_BOOK_UNAVAILABLE'});
});
test('real client retries a failed fixed-proxy read without changing account or writing',async()=>{
  assert.equal(typeof proxy.createCollectionBookProxy,'function');let down=true,calls=0;
  const handler=proxy.createCollectionBookProxy({url:'https://trusted.test',fetcher:async()=>{calls++;if(down)throw Error('offline');return response(empty());}});
  const client=createCollectionBookClient({getToken:async()=>token.slice(7),fetcher:async(_url,options)=>{const r=res();await handler(req({headers:{host:'world.test',authorization:options.headers.Authorization}}),r);return response(r.data,r.code);}});
  client.setAccount(A);assert.equal(await client.refresh(),false);assert.equal(client.state,'UNAVAILABLE');down=false;
  assert.equal(await client.refresh(),true);assert.equal(client.state,'READY');assert.equal(calls,2);assert.equal(client.accountId,A);
});

test('native route refuses anonymous identity using the existing real verifier',async()=>{
  const {verifyNpcAiUser}=await import('../npc-factory/npc-ai-auth.mjs');let authCalls=0;
  const handler=cloud.createCollectionBookCloudHandler({verifyUser:authorization=>verifyNpcAiUser(authorization,async()=>{
    authCalls++;return response({id:A,is_anonymous:true});}),rpc:()=>assert.fail('anonymous actor cannot reach RPC')});
  const r=res();await handler(native(),r);assert.equal(r.code,401);assert.equal(authCalls,1);
});
test('Collection RPC forbids credential-bearing redirects',async()=>{
  const {createCollectionBookRpc}=await import('../server/collection-book-service.mjs');
  const rpc=createCollectionBookRpc({url:'https://db.fixture.invalid',serviceKey:'fixture-secret',fetcher:async(_url,options)=>{
    assert.equal(options.redirect,'error');throw Error('redirect refused');}});
  await assert.rejects(rpc('world_collection_list_v1',{p_user:A}),/COLLECTION_BOOK_UNAVAILABLE/);
});

test('client to fixed proxy to native service uses real verifier/RPC with only synthetic self reads',async()=>{
  const {verifyNpcAiUser}=await import('../npc-factory/npc-ai-auth.mjs');
  const {createCollectionBookRpc}=await import('../server/collection-book-service.mjs');
  const calls=[];
  const authFetch=async(url,options)=>{assert.ok(url.endsWith('/auth/v1/user'));calls.push('auth');
    return response({id:options.headers.Authorization===token?A:B,is_anonymous:false});};
  const rpc=createCollectionBookRpc({url:'https://db.fixture.invalid',serviceKey:'fixture-service-key',fetcher:async(url,options)=>{
    assert.equal(url,'https://db.fixture.invalid/rest/v1/rpc/world_collection_list_v1');assert.equal(options.redirect,'error');
    assert.deepEqual(Object.keys(JSON.parse(options.body)),['p_user']);const actor=JSON.parse(options.body).p_user;
    calls.push(actor);return response(raw(actor));}});
  const handler=cloud.createCollectionBookCloudHandler({verifyUser:auth=>verifyNpcAiUser(auth,authFetch),rpc});
  const forwarding=proxy.createCollectionBookProxy({url:'https://cloud.fixture.invalid',fetcher:async(url,options)=>{
    assert.equal(url,'https://cloud.fixture.invalid/collection-book');const r=res();
    await handler(native({headers:{host:'cloud.fixture.invalid',authorization:options.headers.Authorization}}),r);return response(r.data,r.code);}});
  const client=createCollectionBookClient({getToken:async actor=>(actor===A?token:other).slice(7),fetcher:async(_url,options)=>{
    const r=res();await forwarding(req({headers:{host:'world.test',authorization:options.headers.Authorization}}),r);return response(r.data,r.code);}});
  for(const actor of [A,B]){client.setAccount(actor);assert.equal(await client.refresh(),true);assert.equal(client.snapshot.entries[0].state,'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(client.snapshot),/carp|붕어|PRIVATE|fixture-service-key|userId/);}
  assert.deepEqual(calls,['auth',A,'auth',B]);
});
