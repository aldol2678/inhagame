// Resolve only a disposable loopback stack. Tokens are passed in memory, never logged or archived.
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const env={...process.env}; delete env.SUPABASE_ACCESS_TOKEN; delete env.SUPABASE_DB_PASSWORD;
const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.match(local.API_URL??'',/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
assert.match(local.DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
for(const key of ['API_URL','DB_URL','ANON_KEY','JWT_SECRET']) { assert.ok(local[key]); env[key]=local[key]; }
env.STARTER_FURNITURE_LOCAL_QA='1';
const result=spawnSync(process.execPath,['apps/world/tests/browser/starter-furniture-smoke.mjs'],{env,stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
