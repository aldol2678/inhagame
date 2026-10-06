import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const world=fileURLToPath(new URL('../',import.meta.url));
const endpoint=join(world,'api/world-collection-book.js');
const A='11111111-1111-4111-8111-111111111111';
const empty={version:1,entries:[],discoveredCount:0,trackableCount:0};
function run(script,extra={},strict=true){
  const result=spawnSync(process.execPath,[...(strict?['--no-experimental-detect-module']:[]),'--input-type=module','-e',script],{
    encoding:'utf8',timeout:15000,env:{...process.env,SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
      SUPABASE_SERVICE_ROLE_KEY:'',NPC_AI_CLOUD_RUN_URL:'https://cloud.fixture.invalid',...extra}});
  assert.equal(result.status,0,result.stderr||result.error?.message);return JSON.parse(result.stdout.trim());
}
function strictProxy(authorization){return run(`
  import {createRequire} from 'node:module';const calls=[];
  globalThis.fetch=async(url,options)=>{if(url!=='https://cloud.fixture.invalid/collection-book')throw Error('Unexpected network');
    calls.push({url,method:options.method,headers:options.headers,redirect:options.redirect});return new Response(JSON.stringify(${JSON.stringify(empty)}));};
  const handler=createRequire(import.meta.url)(${JSON.stringify(endpoint)});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
  await handler({method:'GET',url:'/api/world-collection-book',headers:{host:'fixture.invalid',authorization:${JSON.stringify(authorization)}}},res);
  console.log(JSON.stringify({status:res.code,body:res.body,headers:res.headers,calls}));
`);}
test('strict CJS proxy reaches unauthenticated401 without backend or service credentials',()=>{
  const result=strictProxy(null);assert.equal(result.status,401);assert.deepEqual(result.body,{error:'AUTH_REQUIRED'});assert.deepEqual(result.calls,[]);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
});
test('strict CJS proxy uses only existing backend URL and forwards no service credentials',()=>{
  const authorization='Bearer '+'x'.repeat(30),result=strictProxy(authorization);assert.equal(result.status,200);assert.deepEqual(result.body,empty);
  assert.deepEqual(result.calls,[{url:'https://cloud.fixture.invalid/collection-book',method:'GET',headers:{Authorization:authorization},redirect:'error'}]);
});
test('new native Collection module reaches401 with strict module detection disabled',()=>{
  const result=run(`
    const {createCollectionBookCloudHandler}=await import(${JSON.stringify(new URL('../npc-factory/collection-book-cloud-handler.mjs',import.meta.url).href)});
    globalThis.fetch=()=>{throw Error('Unexpected network');};
    const res={setHeader(){},writeHead(code){this.code=code;},end(body){this.body=body?JSON.parse(body):null;}};
    await createCollectionBookCloudHandler()({method:'GET',url:'/collection-book',headers:{}},res);
    console.log(JSON.stringify({status:res.code,body:res.body}));
  `);
  assert.deepEqual(result,{status:401,body:{error:'AUTH_REQUIRED'}});
});
test('Docker COPY closure boots Cloud router with Docker CMD module detection and preserves quest/AI routes without sockets',()=>{
  const target=mkdtempSync(join(tmpdir(),'collection-packaging-'));
  try{
    const docker=readFileSync(join(world,'Dockerfile'),'utf8');
    for(const [,source,dest] of docker.matchAll(/^COPY ([a-z-]+) \.\/([a-z-]+)$/gm))cpSync(join(world,source),join(target,dest),{recursive:true});
    const result=run(`
      import http from 'node:http';import {Readable} from 'node:stream';import {pathToFileURL} from 'node:url';
      let handler,listen;http.createServer=callback=>{handler=callback;return{listen:(port,host)=>{listen={port,host};}};};
      const calls=[];globalThis.fetch=async(url,options)=>{
        if(!url.startsWith('https://fixture.invalid/'))throw Error('Unexpected network');
        calls.push({url,body:options.body?JSON.parse(options.body):null});
        if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:${JSON.stringify(A)},is_anonymous:false}));
        if(url.endsWith('/rest/v1/rpc/world_collection_list_v1'))return new Response(JSON.stringify({userId:${JSON.stringify(A)},entries:[{
          entryId:'collection.fish.carp',category:'FISH',persistenceMode:'SERVER_PERSISTED',ownerDomain:null,ownerRef:null,
          catalogStatus:'ACTIVE',definitionVersion:1,discoveryState:'UNKNOWN',discovered:false,firstDiscoveredAt:null,lastDiscoveredAt:null,discoveryCount:0,version:0}]}));
        throw Error('Unexpected RPC or write');};
      await import(pathToFileURL(${JSON.stringify(join(target,'npc-factory/npc-ai-cloud-run.mjs'))}));
      async function invoke(url,method='GET',authorization){const req=Object.assign(Readable.from(method==='POST'?['{}']:[]),
        {url,method,headers:{host:'cloud.fixture.invalid','content-type':'application/json',authorization}});
        const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code){this.code=code;},end(body){this.body=body?JSON.parse(body):null;}};
        await handler(req,res);return{status:res.code,body:res.body};}
      const book=await invoke('/collection-book','GET','Bearer '+'x'.repeat(30));
      const quest=await invoke('/quest','POST'),questQuery=await invoke('/quest?x','POST'),ai=await invoke('/','POST');
      const bookPost=await invoke('/collection-book','POST'),query=await invoke('/collection-book?','GET');
      console.log(JSON.stringify({listen,book,quest,questQuery,ai,bookPost,query,calls}));
    `,{NPC_AI_ENABLED:'1',NPC_AI_PROJECT:'fixture-project',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',PORT:'8080'},false);
    assert.deepEqual(result.listen,{port:8080,host:'0.0.0.0'});assert.equal(result.book.status,200);assert.equal(result.book.body.entries[0].state,'UNKNOWN');
    assert.doesNotMatch(JSON.stringify(result.book),/carp|붕어|userId|fixture-service-key/);
    assert.deepEqual(result.calls.map(x=>new URL(x.url).pathname),['/auth/v1/user','/rest/v1/rpc/world_collection_list_v1']);
    assert.deepEqual(result.calls[1].body,{p_user:A});
    assert.equal(result.quest.body.error,'QUEST_AUTH_REQUIRED');assert.equal(result.questQuery.body.error,'QUEST_AUTH_REQUIRED');
    assert.equal(result.ai.body.error,'PILOT_AUTH_REQUIRED');assert.equal(result.bookPost.status,405);assert.equal(result.query.status,400);
  }finally{rmSync(target,{recursive:true,force:true});}
});
test('browser compatibility exports preserve canonical authority and share the projected-contract parser',async()=>{
  const configJs=await import('../src/config/supabase-public-config.js'),registryJs=await import('../src/collection/collection-discovery-contract.js');
  const configMjs=await import('../src/config/supabase-public-config.mjs'),registryMjs=await import('../src/collection/collection-discovery-contract.mjs');
  assert.deepEqual(Object.keys(configJs),Object.keys(configMjs));assert.deepEqual(Object.keys(registryJs),Object.keys(registryMjs));
  assert.equal(configJs.getPublicSupabaseConfig,configMjs.getPublicSupabaseConfig);assert.equal(registryJs.COLLECTION_ENTRY_REGISTRY,registryMjs.COLLECTION_ENTRY_REGISTRY);
  const browser=await import('../src/collection/collection-book-client.js');
  const contract=await import('../src/collection/collection-book-contract.mjs').catch(()=>({}));
  assert.equal(typeof contract.parseCollectionBook,'function');assert.equal(browser.parseCollectionBook,contract.parseCollectionBook);
});
