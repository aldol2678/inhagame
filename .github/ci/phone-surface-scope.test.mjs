import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, declaredPaths, GUARDED_WORKFLOWS, inspect, matchPath,
  safeMainHandoff, safeModularPath } from './phone-surface-scope.mjs';

const workflow = name => readFileSync(new URL('../workflows/'+GUARDED_WORKFLOWS[name],import.meta.url),'utf8');
const graphics='Graphics integration browser QA';
const quest='Quest journal controls browser checks';
const shop='NPC shop routing browser checks';
const phone='apps/world/src/phone/phone-messages.js';
const main='apps/world/src/main.js';
const authCode=[
 '    try {',
 '      sessionStorage.setItem("inhagame-hub-message-draft-v1", JSON.stringify({ userId, createdAt: Date.now() }));',
 '      window.location.assign("/#messages");',
 '      return true;',
 '    } catch {',
 '      return false;',
 '    }'
].join('\n');
const baseMain=[
 'const playerCard = createPlayerCard({',
 '  onMessage: (userId) => {',
 authCode,
 '  },',
 '  accompany: { canFollow:()=>true }',
 '});',
 'const gameState = true;',
 ''
].join('\n');
const phoneMain=baseMain.replace(authCode,[
 '    playerCard.close();',
 '    if (smartphone?.openMessages?.(userId)) return true;',
 authCode
].join('\n'));
const decide=(files,name,opts={})=>classify(files,{
 workflowName:name,workflowYaml:workflow(name),prTitle:'feat(world): modular app',
 ...opts
});
test('all eleven guarded workflows have declarative direct paths',()=>{
 assert.equal(Object.keys(GUARDED_WORKFLOWS).length,11);
 for(const name of Object.keys(GUARDED_WORKFLOWS)){
  const paths=declaredPaths(workflow(name),name);
  assert.ok(paths?.includes('apps/world/src/main.js'),name);
  assert.ok(paths?.some(p=>p.startsWith('.github/workflows/')),name);
 }
});
test('glob matcher understands the existing source and browser fixture patterns',()=>{
 assert.equal(matchPath('apps/world/src/shop/**','apps/world/src/shop/shop-panel.js'),true);
 assert.equal(matchPath('apps/world/tests/browser/phone-messages-*','apps/world/tests/browser/phone-messages-smoke.mjs'),true);
 assert.equal(matchPath('apps/world/src/main.js','apps/world/src/main.js'),true);
 assert.equal(matchPath('apps/world/src/shop/**','apps/world/src/phone/phone-messages.js'),false);
 assert.equal(matchPath('apps/world/src/shop/*.js','apps/world/src/shop/nested/thing.js'),false);
});
test('module change skips a suite that has no direct impact, but keeps the affected one',()=>{
 assert.deepEqual(decide([phone],graphics),{skip:true,reason:'unrelated-modular-feature',paths:[phone]});
 assert.equal(decide(['apps/world/src/quest/journal-panel.js'],quest).reason,'suite-direct-impact');
 assert.equal(decide(['apps/world/src/quest/journal-panel.js'],graphics).skip,true);
 assert.equal(decide(['apps/world/src/shop/shop-panel.js'],shop).reason,'suite-direct-impact');
});
test('shared and security-sensitive changes fail closed',()=>{
 for(const file of [
  'apps/world/src/phone/phone-shell.js','apps/world/src/phone/phone-album.js',
  'apps/world/src/input/input-focus-manager.js','apps/world/src/network/transport.js',
  'apps/world/src/rooms/room-transition.js',
  'apps/world/src/online/world-online.js',
  'apps/world/src/config/supabase-public-config.js',
  'apps/world/campus/index.html','apps/world/styles.css','apps/world/qa.mjs',
  'supabase/migrations/20261012.sql',
  '.github/workflows/phone-browser.yml','.github/ci/phone-surface-scope.mjs',
  'apps/world/tests/browser/harness.mjs',
  'unknown-file.js'
 ]) assert.equal(decide([file],graphics).skip,false,file);
});
test('partial safe set combined with unknown path also forces full suite',()=>{
 assert.equal(decide([phone,'apps/world/src/online/world-online.js'],graphics).skip,false);
 assert.equal(decide([phone,phone],graphics).skip,false);
 assert.equal(decide([],graphics).skip,false);
 assert.equal(decide(null,graphics).skip,false);
 assert.equal(decide([main],graphics).skip,false);
});
test('only player-card presentation handoff is permitted in shared main',()=>{
 assert.equal(safeMainHandoff(baseMain,phoneMain),true);
 assert.equal(decide([phone,main],graphics,{mainBefore:baseMain,mainAfter:phoneMain}).skip,true);
 assert.equal(decide([phone,main],graphics,{mainBefore:baseMain,mainAfter:phoneMain+'\nconst newGameState = true;'}).skip,false);
 assert.equal(decide([phone,main],graphics,{mainBefore:baseMain,mainAfter:phoneMain.replace('window.location.assign','window.location.reload')}).skip,false);
 assert.equal(safeMainHandoff(baseMain,baseMain),false);
});
test('main.js exception rejects ANY changed callback side effect, fallback or statement order',()=> {
 const all=[
  phoneMain.replace('    playerCard.close();','    playerCard.close();\n    changeWorldState();'),
  phoneMain.replace('playerCard.close();','playerCard.open();'),
  phoneMain.replace('return true;\n    try','return false;\n    try'),
  phoneMain.replace('if (smartphone?.openMessages?.(userId)) return true;','void smartphone?.openMessages?.(userId);'),
  phoneMain.replace('    try {','    logPrivateMessage();\n    try {'),
  phoneMain.replace('    try {','    try {\n      broadcastToZone();'),
  phoneMain.replace('window.location.assign("/#messages")','window.location.reload()'),
  phoneMain.replace('      return false;','      return true;'),
  phoneMain.replace('    playerCard.close();\n    if (smartphone?.openMessages?.(userId)) return true;',
    '    if (smartphone?.openMessages?.(userId)) return true;\n    playerCard.close();'),
  phoneMain + '// unrelated change'
 ];
 for(const value of all){
  assert.equal(safeMainHandoff(baseMain,value),false);
  assert.equal(decide([main,phone],graphics,{mainBefore:baseMain,mainAfter:value}).skip,false);
 }
 assert.equal(safeMainHandoff(baseMain.replace('  accompany:', '  onMessage: (userId) => {}\n  accompany:'),phoneMain),false);
});
test('PR release/hotfix/full-ci titles and unknown workflows force full',()=>{
 for(const title of ['release(world): publish','hotfix: urgent','[full-ci] feat: app','릴리스 통합','출시 준비']){
  assert.equal(decide([phone],graphics,{prTitle:title}).reason,'release-or-unknown-pr');
 }
 assert.equal(classify([phone],{workflowName:'Unknown',prTitle:'feat: okay',workflowYaml:workflow(graphics)}).skip,false);
 assert.equal(classify([phone],{workflowName:graphics,prTitle:'feat: okay',workflowYaml:'not yaml'}).skip,false);
});
test('inspect simulates real shallow-checkout diff with exact commit, status and workflow route',()=>{
 const base='a'.repeat(40),head='b'.repeat(40);
 const call=[];
 const mock=(...args)=>{
  call.push(args);
  if(args[0]==='rev-parse')return head+'\n';
  if(args[0]==='cat-file'||args[0]==='merge-base')return '';
  if(args[0]==='diff')return 'M\0'+phone+'\0';
  throw Error('unexpected Git call');
 };
 const run=inspect({CI_HEAD_SHA:head,CI_BASE_SHA:base,CI_PR_TITLE:'feat(phone): inbox',
   CI_WORKFLOW_NAME:graphics},mock,()=>workflow(graphics));
 assert.equal(run.skip,true);
 assert.equal(run.reason,'unrelated-modular-feature');
 assert.ok(call.some(x=>x[0]==='merge-base'));
});
test('inspect refuses malformed history, missing refs, releases and unknown workflow',()=>{
 const a='a'.repeat(40),b='b'.repeat(40);
 assert.equal(inspect({}).skip,false);
 assert.equal(inspect({CI_HEAD_SHA:b,CI_BASE_SHA:a,CI_WORKFLOW_NAME:graphics}).skip,false);
 assert.equal(inspect({CI_HEAD_SHA:b,CI_BASE_SHA:a,CI_WORKFLOW_NAME:'nonexistent',CI_PR_TITLE:'feat'}).skip,false);
 assert.equal(inspect({CI_HEAD_SHA:b,CI_BASE_SHA:a,CI_WORKFLOW_NAME:graphics,CI_PR_TITLE:'[full-ci] release'}).skip,false);
 const missingBase=(...args)=>{
  if(args[0]==='rev-parse')return b+'\n';
  if(args[0]==='cat-file')throw Error('base unavailable');
  return '';
 };
 assert.equal(inspect({CI_HEAD_SHA:b,CI_BASE_SHA:a,CI_WORKFLOW_NAME:graphics,CI_PR_TITLE:'feat'},missingBase).reason,'missing-history-or-diff-error');
});
