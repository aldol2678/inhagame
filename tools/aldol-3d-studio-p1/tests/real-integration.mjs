import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=process.env.INHA_WORLD_EDITOR_DIR;
const expected=['world-document.js','world-schema.js','world-serialization.js','editor-commands.js','path-spline.js','building-mass.js'];
if(!dir||expected.some(file=>!existsSync(join(resolve(dir),file)))){
  console.error(`BLOCKED: provide INHA_WORLD_EDITOR_DIR containing real files: ${expected.join(', ')}`);
  process.exit(2);
}
const result=spawnSync(process.execPath,['--test','tests/real.test.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:process.env,encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
if(result.status!==0)process.exit(result.status??2);
if(!/# pass 8\b/.test(result.stdout)||!/# skipped 2\b/.test(result.stdout)||!/# fail 0\b/.test(result.stdout)) {
 console.error('BLOCKED: real test gate expected exactly 8 PASS, 2 SKIP, 0 FAIL');process.exit(2);
}
console.log('REAL INTEGRATION GATE: 8 PASS / 2 SKIP (C13 C14 remain separate)');
