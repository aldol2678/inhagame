// Starts no services and applies no migrations. Uses only an already-running loopback stack.
import {execFileSync,spawnSync} from 'node:child_process';
const env={...process.env};delete env.SUPABASE_ACCESS_TOKEN;delete env.SUPABASE_DB_PASSWORD;
const cli=env.PUBLIC_LOCAL_SUPABASE_CLI||'supabase';
const status=JSON.parse(execFileSync(cli,['status','-o','json'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(status.API_URL||'')||!/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(status.DB_URL||''))throw Error('LOCAL_STACK_REQUIRED');
Object.assign(env,{API_URL:status.API_URL,ANON_KEY:status.ANON_KEY,DB_URL:status.DB_URL,WORLD_SMOKE_DISABLE_WEBGPU:'1'});
const args=process.argv.includes('--browser')?['apps/world/tests/browser/phone-learning-cloud-smoke.mjs']:['--test','supabase/tests/integration/learning-progress.integration.test.mjs'];
const result=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);
