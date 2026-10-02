// Static checks: every script parses and index.html references only files that exist.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const skip=new Set(['node_modules','test-results','playwright-report']);
function scripts(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    if(skip.has(entry.name))return [];
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())return scripts(full);
    return /\.(c?js|mjs)$/.test(entry.name)?[full]:[];
  });
}
const files=scripts(root);
for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const tags=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const sources=tags.map(t=>/\bsrc="([^"]+)"/.exec(t[1])?.[1]).filter(Boolean);
const inline=tags.filter(t=>!/\bsrc=/.test(t[1]));
assert(inline.length>0,'index.html has no inline game script');
inline.forEach((t,i)=>new vm.Script(t[2],{filename:`index.html#inline-${i}`}));
const local=sources.filter(src=>!/^https?:/.test(src));
for(const src of local)assert(fs.existsSync(path.join(root,src)),`Missing local script: ${src}`);
for(const required of ['./stage-config.js','./stage-progress.js','supabase-public-config.js','./account.js','./audio-manager.js'])
  assert(local.includes(required),`index.html must load ${required}`);
// The game script depends on this load order.
assert.deepEqual(local,['./stage-config.js','./stage-progress.js','supabase-public-config.js','./account.js','./audio-manager.js'],'Local script order changed');
const three=sources.find(src=>src.includes('/three@'));
const pinned=require(path.join(root,'package.json')).devDependencies.three;
assert.equal(three,`https://cdn.jsdelivr.net/npm/three@${pinned}/build/three.min.js`,'Three.js CDN version must match the CI copy');
assert(sources.includes('https://inhagame.example/game-entry.js'),'Hub entry script missing');
for(const id of ['loading','mainMenu','menuStartBtn','menuStageSummary','timer','stats','wrap'])
  assert(new RegExp(`id="${id}"`).test(html),`Missing #${id}`);
for(const stage of [1,2,3,4,5,6])
  assert(new RegExp(`class="stageCardMenu[^"]*"[^>]*data-stage="${stage}"`).test(html),`Missing stage card ${stage}`);
console.log(`Survival static check: ${files.length} scripts, ${inline.length} inline blocks, ${local.length} local references: PASS`);
