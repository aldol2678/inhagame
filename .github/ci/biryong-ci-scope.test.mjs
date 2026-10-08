import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBiryongScope, changedBiryongFiles } from './biryong-ci-scope.mjs';

const cli = fileURLToPath(new URL('./biryong-ci-scope.mjs', import.meta.url));
const A = 'apps/world/assets/ui-icons/p0-v1/';
const asset = A + 'svg/map.svg';

for (const [name, files, want] of [
  ['complete icon pack', [A+'README.md', A+'manifest.json', ...['album','attendance','camera','chat','collection','friends','help','inventory','lock','map','mobility','notification','profile','quest','quiz','settings','shop','student-id','wardrobe'].map(x => A+'svg/'+x+'.svg')], 'asset_only'],
  ['new standalone icon', [asset], 'asset_only'],
  ['blank', [], 'measure'],
  ['unknown', null, 'measure'],
  ['malformed', [asset, null], 'measure'],
  ['graphics source', ['apps/world/src/biryong/biryong-realm-renderer.js'], 'measure'],
  ['graphics budget', ['apps/world/src/biryong/biryong-performance-budget.js'], 'measure'],
  ['mixed icon and graphics', [asset, 'apps/world/src/graphics-presets.js'], 'measure'],
  ['test code', ['apps/world/tests/browser/biryong-performance-smoke.mjs'], 'measure'],
  ['workflow change', ['.github/workflows/biryong-main-control-browser.yml'], 'measure'],
  ['policy changes', ['.github/ci/biryong-ci-scope.mjs'], 'measure'],
  ['test changes', ['.github/ci/biryong-ci-scope.test.mjs'], 'measure'],
  ['unreviewed other assets', ['apps/world/assets/annyongi-flight-v1.glb'], 'measure'],
  ['item textures not allowlisted', ['apps/world/assets/item-icons/active8-v1/png/64/head.inha_cap.png'], 'measure'],
  ['out-of-scope icon dir', ['apps/world/assets/ui-icons/p0-v2/svg/map.svg'], 'measure'],
  ['svg disguised JS', [A+'svg/map.js'], 'measure'],
  ['deep nested path', [A+'svg/nested/map.svg'], 'measure'],
  ['path traversal', [A+'svg/../../src/main.js'], 'measure'],
  ['newline/injection', [asset+'\napps/world/src/main.js'], 'measure'],
  ['manifest typo', [A+'manifests.json'], 'measure'],
  ['renamed code into safe asset must include old path', ['apps/world/src/main.js', asset], 'measure'],
]) test(name, () => assert.equal(classifyBiryongScope(files), want));

function init(t) {
  const cwd = mkdtempSync(join(tmpdir(),'biryong-scope-'));
  t.after(() => rmSync(cwd,{recursive:true,force:true}));
  const git = (...args) => execFileSync('git', args, {cwd, encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  const put = (p,v) => { mkdirSync(dirname(join(cwd,p)),{recursive:true});writeFileSync(join(cwd,p),v); };
  const commit = title => {git('add','-A');git('commit','-q','-m',title);return git('rev-parse','HEAD')};
  put('apps/world/src/main.js','main');put(asset,'original');const base=commit('initial');
  return {cwd,git,put,commit,base};
}
function mode(cwd, event, base, head) {
  const r=spawnSync(process.execPath,[cli],{cwd,env:{...process.env,CI_EVENT:event,PR_BASE_SHA:base,PR_HEAD_SHA:head},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/^mode=(asset_only|measure)\n$/);
  return r.stdout.trim().split('=')[1];
}
test('git diff limited to exact P0 assets is safe',t=>{const r=init(t);r.put(asset,'changed');const head=r.commit('asset');assert.equal(mode(r.cwd,'pull_request',r.base,head),'asset_only');});
test('mixed asset with source fails closed',t=>{const r=init(t);r.put(asset,'changed');r.put('apps/world/src/main.js','changed');const head=r.commit('mixed');assert.equal(mode(r.cwd,'pull_request',r.base,head),'measure');});
test('rename out of source fails closed',t=>{const r=init(t);r.git('mv','apps/world/src/main.js',A+'svg/source.svg');const head=r.commit('rename');assert.equal(mode(r.cwd,'pull_request',r.base,head),'measure');});
test('no changed files cannot fast-path',t=>{const r=init(t);assert.equal(mode(r.cwd,'pull_request',r.base,r.base),'measure');});
test('checkout head mismatch cannot fast-path',t=>{const r=init(t);r.put(asset,'changed');r.commit('asset');assert.equal(mode(r.cwd,'pull_request',r.base,r.base),'measure');});
test('unknown PR base cannot fast-path',t=>{const r=init(t);r.put(asset,'changed');const head=r.commit('asset');assert.equal(mode(r.cwd,'pull_request','f'.repeat(40),head),'measure');});
test('workflow_dispatch cannot fast-path',t=>{const r=init(t);r.put(asset,'changed');const head=r.commit('asset');assert.equal(mode(r.cwd,'workflow_dispatch',r.base,head),'measure');});
test('unsupported event cannot fast-path',t=>{const r=init(t);r.put(asset,'changed');const head=r.commit('asset');assert.equal(mode(r.cwd,'push',r.base,head),'measure');});
