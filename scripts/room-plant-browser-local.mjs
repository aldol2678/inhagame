// Only a disposable loopback DB from Supabase CLI; production credentials are removed.
import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const env={...process.env};delete env.SUPABASE_ACCESS_TOKEN;delete env.SUPABASE_DB_PASSWORD;
const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.match(local.DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
env.DB_URL=local.DB_URL;env.ROOM_PLANT_LOCAL_QA='1';
const result=spawnSync(process.execPath,['apps/world/tests/browser/room-plant-friend-live-smoke.mjs'],{env,stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
