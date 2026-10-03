const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
// Classic scripts (not modules) share one global scope, so the order is part of the contract:
// see README.md "Module layout".
const APP_SCRIPTS=['js/dom.js','js/online.js','js/game.js','js/boot.js'];
const srcs=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]);
assert.deepEqual(srcs,['badge-system.js','secret-run.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','js/supabase-public-config.js',...APP_SCRIPTS],
  'Script tags and their order changed');
const styles=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m=>m[1]);
assert.deepEqual(styles,['classic.css','secret-session.css'],'Stylesheets and their cascade order changed');
for(const file of [...APP_SCRIPTS,...styles,'badge-system.js','secret-run.js'])assert.ok(fs.existsSync(file),'Missing '+file);
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const app=APP_SCRIPTS.map(file=>fs.readFileSync(file,'utf8'));
app.forEach((code,i)=>new vm.Script(code,{filename:APP_SCRIPTS[i]}));
// As one program: no top-level name is declared twice across files.
new vm.Script(app.join('\n'),{filename:'classic-app'});
new vm.Script(fs.readFileSync('secret-run.js','utf8'));
// Everything the page executes or renders, for the contract checks below.
const source=html+'\n'+app.join('\n');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate DOM IDs');
for(const id of fs.readFileSync('js/dom.js','utf8').matchAll(/getElementById\('([^']+)'\)/g))
  assert.ok(ids.includes(id[1]),'js/dom.js looks up a missing element #'+id[1]);
for(const img of html.matchAll(/<img[^>]*\bsrc="([^"]+)"/g))
  assert.ok(/^(https?:|data:)/.test(img[1])||fs.existsSync(img[1]),'Missing image '+img[1]);
assert.ok(!/data:image\//.test(html),'Sprites belong in assets/, not inline in index.html');
for(const name of ['secret-run.js','secret-session.css'])assert.ok(html.includes(name));
assert.ok(source.includes("const CLASSIC_PRODUCTION_HOSTS=new Set(['inha-duck.example','duck.inhagame.example']);"),'Production host allowlist missing');
assert.ok(source.includes("const TELEMETRY_RUN_TYPE=CLASSIC_PRODUCTION_HOSTS.has(location.hostname)?'production':'qa';"),'Telemetry must recognize custom production domain');
assert.ok(source.includes("const runType=CLASSIC_PRODUCTION_HOSTS.has(location.hostname)?'ranked':'qa';"),'Ranked sessions must recognize custom production domain');
assert.ok(source.includes("const PREVIEW_RANKED_UNLOCK=!CLASSIC_PRODUCTION_HOSTS.has(location.hostname);"),'Ranked preview gate must exclude production hosts');
for(const id of ['accountOpenBtn','accountOverlay','accountSignupTab','accountLoginTab','accountSignupEmailInput','accountSignupBtn','accountLoginEmailInput','accountLoginPasswordInput','accountPasswordLoginBtn','accountNewPasswordInput','accountSetPasswordBtn'])assert.ok(html.includes('id="'+id+'"'),'Missing account UI '+id);
assert.ok(source.includes('signInWithPassword'),'Password login missing');
assert.ok(source.includes('updateUser({password}'),'Password setup missing');
assert.ok(source.includes("save_my_game_progress"),'Cloud progress RPC missing');
assert.ok(source.includes("touch_inhagame_member_activity_v1"),'Shared member activity RPC missing');
assert.ok(source.includes('Classic 진행도는 플레이 중 자동 저장되고, 로그인한 계정에 자동으로 동기화됩니다.'),'Automatic cloud sync copy missing');
assert.ok(!fs.existsSync('api/ops.js'),'Private OPS server must be absent');
assert.ok(html.includes('src="https://inhagame.app/api/brand-media?asset=annyongi.png"'),'Annyongi runtime brand media route missing');
assert.ok(html.includes('src="https://inhagame.app/api/brand-media?asset=indeoki.png"'),'Indeoki runtime brand media route missing');
console.log('Public Classic static checks PASS');
