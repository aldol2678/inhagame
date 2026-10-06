import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const endpoint = fileURLToPath(new URL('../api/world-collection-book.js', import.meta.url));
const ACTOR = '11111111-1111-4111-8111-111111111111';

// Vercel's CJS function loader must not rely on Node's automatic .js ESM detection.
// Every HTTP call is replaced before importing the real deployment entrypoint.
function strictRuntime(authorization) {
  const script = `
    const actor = ${JSON.stringify(ACTOR)};
    const calls = [];
    globalThis.fetch = async (url, options) => {
      if (!url.startsWith('https://fixture.invalid/')) throw Error('Unexpected network destination');
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url.endsWith('/auth/v1/user')) return { ok:true, json:async()=>({id:actor,is_anonymous:false}) };
      if (url.endsWith('/rest/v1/rpc/world_collection_list_v1')) return { ok:true, json:async()=>({
        userId:actor, entries:[{entryId:'collection.fish.carp',category:'FISH',persistenceMode:'SERVER_PERSISTED',
          ownerDomain:null,ownerRef:null,catalogStatus:'ACTIVE',definitionVersion:1,discoveryState:'UNKNOWN',
          discovered:false,firstDiscoveredAt:null,lastDiscoveredAt:null,discoveryCount:0,version:0}]
      }) };
      throw Error('Unexpected RPC or write');
    };
    const handler = require(${JSON.stringify(endpoint)});
    const res = { headers:{}, setHeader(k,v){this.headers[k]=v;}, status(code){this.code=code;return this;},
      json(body){this.body=body;return this;}, end(){return this;} };
    handler({method:'GET',url:'/api/world-collection-book',headers:{host:'fixture.invalid',authorization:${JSON.stringify(authorization)}}},res)
      .then(()=>console.log(JSON.stringify({status:res.code,body:res.body,headers:res.headers,calls})))
      .catch(error=>{console.error(error.message);process.exitCode=1;});
  `;
  const result = spawnSync(process.execPath, ['--no-experimental-detect-module', '--input-type=commonjs', '-e', script], {
    encoding:'utf8', timeout:10000, env:{...process.env,
      SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
      SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key'}
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout.trim());
}

test('strict CJS runtime reaches unauthenticated 401 without any auth or RPC request',()=>{
  const result = strictRuntime(null);
  assert.equal(result.status,401);
  assert.deepEqual(result.body,{error:'AUTH_REQUIRED'});
  assert.deepEqual(result.calls,[]);
  assert.equal(result.headers['Cache-Control'],'private, no-store');
});
test('strict CJS runtime verifies synthetic actor and returns only filtered read projection',()=>{
  const result = strictRuntime('Bearer '+'x'.repeat(30));
  assert.equal(result.status,200);
  assert.deepEqual(result.calls.map(call=>new URL(call.url).pathname),['/auth/v1/user','/rest/v1/rpc/world_collection_list_v1']);
  assert.deepEqual(result.calls[1].body,{p_user:ACTOR});
  assert.equal(result.body.entries[0].state,'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result.body),/carp|붕어|userId|fixture-service-key/);
});
test('browser .js entrypoints re-export the same canonical ESM authority instances',async()=>{
  const configJs = await import('../src/config/supabase-public-config.js');
  const registryJs = await import('../src/collection/collection-discovery-contract.js');
  const configMjs = await import('../src/config/supabase-public-config.mjs').catch(()=>null);
  const registryMjs = await import('../src/collection/collection-discovery-contract.mjs').catch(()=>null);
  assert.ok(configMjs,'explicit ESM config entrypoint exists');assert.ok(registryMjs,'explicit ESM registry entrypoint exists');
  assert.deepEqual(Object.keys(configJs),Object.keys(configMjs));
  assert.deepEqual(Object.keys(registryJs),Object.keys(registryMjs));
  assert.equal(configJs.getPublicSupabaseConfig,configMjs.getPublicSupabaseConfig);
  assert.equal(registryJs.COLLECTION_ENTRY_REGISTRY,registryMjs.COLLECTION_ENTRY_REGISTRY);
});
