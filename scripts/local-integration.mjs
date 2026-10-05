import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const cli = process.env.PUBLIC_LOCAL_SUPABASE_CLI || 'supabase';
const workdir = process.env.PUBLIC_LOCAL_SUPABASE_WORKDIR || process.cwd();
const env = { ...process.env };
delete env.SUPABASE_ACCESS_TOKEN;
delete env.SUPABASE_DB_PASSWORD;
const status = JSON.parse(execFileSync(cli, ['--workdir', workdir, 'status', '-o', 'json'], {
  env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
}));
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(status.API_URL || '')) throw Error('NON_LOCAL_API');
if (!/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(status.DB_URL || '')) throw Error('NON_LOCAL_DB');
for (const key of ['API_URL', 'DB_URL', 'ANON_KEY', 'JWT_SECRET']) {
  if (!status[key]) throw Error(`MISSING_LOCAL_${key}`);
  env[key] = status[key];
}
env.SUPABASE_URL = status.API_URL;
env.SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY;
const tests = readdirSync('supabase/tests/integration').filter(name => name.endsWith('.test.mjs'))
  .sort().map(name => `supabase/tests/integration/${name}`);
if (!tests.length) throw Error('NO_INTEGRATION_TESTS');
const result = spawnSync(process.execPath, ['--import', './scripts/local-test-config.mjs', '--test', '--test-concurrency=1', ...tests], {
  env, stdio: 'inherit'
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
