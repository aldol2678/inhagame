// Use only a disposable loopback stack. Local keys remain in process memory, never artifacts.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const env={...process.env};
delete env.SUPABASE_ACCESS_TOKEN;
delete env.SUPABASE_DB_PASSWORD;
const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{
  env,encoding:'utf8',stdio:['ignore','pipe','pipe']
}));
const api=new URL(local.API_URL??'invalid:');
const db=new URL(local.DB_URL??'invalid:');
assert.equal(api.protocol,'http:');
assert.ok(['127.0.0.1','localhost'].includes(api.hostname)&&api.port);
assert.ok(!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/');
assert.ok(['postgres:','postgresql:'].includes(db.protocol));
assert.ok(['127.0.0.1','localhost'].includes(db.hostname)&&db.port);
assert.ok(!db.search&&!db.hash);
for(const key of ['API_URL','DB_URL','ANON_KEY','SERVICE_ROLE_KEY']){
  assert.ok(local[key],`Missing disposable ${key}`);env[key]=local[key];
}
env.CONVENIENCE_CAMPUS_LOCAL_QA='1';
env.NODE_ENV='test';
env.WORLD_INCOME_CANDIDATE_ENABLED='1';
env.WORLD_CONVENIENCE_AUTHORITY_CANDIDATE='1';
env.WORLD_INCOME_CANDIDATE_SUPABASE_URL=local.API_URL;
env.WORLD_INCOME_CANDIDATE_ANON_KEY=local.ANON_KEY;
env.WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY=local.SERVICE_ROLE_KEY;
const result=spawnSync(process.execPath,['apps/world/tests/browser/convenience-campus-smoke.mjs'],{
  env,stdio:'inherit'
});
if(result.error)throw result.error;
process.exit(result.status??1);
