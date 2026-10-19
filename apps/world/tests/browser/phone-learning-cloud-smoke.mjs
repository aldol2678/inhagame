import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke} from './harness.mjs';
import {localLearningBackend} from '../../../../supabase/tests/support/learning-local.mjs';
const backend=localLearningBackend(),output='test-results/phone-learning-cloud';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Loopback Supabase Auth/PostgREST only; synthetic course.','Chromium desktop and 360px emulation, not physical Android/iOS.']};
if(process.env.PHONE_HEAD_SHA)assert.equal(report.head,process.env.PHONE_HEAD_SHA);
const sdk=await readFile(new URL('./node_modules/@supabase/supabase-js/dist/umd/supabase.js',import.meta.url));
try{for(const [name,viewport,mobile] of [['desktop',{width:1280,height:900},false],['android-360',{width:360,height:640},true]]){
 const a=await backend.signup(),b=await backend.signup(),smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile}});
 const entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 try{
  await smoke.context.addInitScript(config=>window.learningTestConfig=config,{url:backend.url,key:backend.key,session:a});
  await smoke.context.route('**/tests/browser/learning-test-sdk.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await smoke.context.route(backend.url+'/**',r=>r.continue());
  const page=await smoke.context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const open=()=>page.evaluate(()=>{window.fixture.phone.open();window.fixture.phone.launch('learning');});
  const snap=()=>page.evaluate(()=>window.fixture.snapshot());
  const button=n=>page.getByRole('button',{name:n,exact:true});
  const synced=()=>page.waitForFunction(()=>window.fixture?.learning.snapshot().cloud.status==='synced');
  const stats=async()=>{await button('학습 기록').click();await button('클라우드 다시 확인').click();};
  await page.goto(smoke.origin+'/tests/browser/phone-learning-cloud-harness.html');await synced();await open();await button('이어서 배우기').click();
  for(let i=0;i<6;i++){
   const r=(await snap()).learning.run,q=r.questions[r.index];
   if(q.type==='order')for(const part of q.parts)await page.locator('.learning-answers').getByRole('button',{name:part,exact:true}).first().click();
   else if(q.type==='match')for(const [l,v] of q.pairs){await page.locator('.learning-match').getByRole('button',{name:l,exact:true}).click();await page.locator('.learning-match').getByRole('button',{name:v,exact:true}).click();}
   else await button(`${String.fromCharCode(65+q.a)}. ${q.options[q.a]}`).click();
   await button('정답 확인하기').click();await button(i===5?'결과 확인하기':'다음 문제').click();
  }
  await stats();await synced();assert.equal((await snap()).learning.progress.completed.e01,true);
  const saved=await backend.rpc(a,'world_learning_read_v1');assert.equal(saved.data.progress.completed.e01,true);
  await page.reload();await synced();assert.equal((await snap()).learning.progress.completed.e01,true);
  await page.evaluate(b=>window.fixture.switchAccount(b),b);await synced();assert.deepEqual((await snap()).learning.progress.completed,{});assert.equal((await snap()).world,true);
  await page.evaluate(()=>window.fixture.switchAccount(null));assert.deepEqual((await snap()).learning.progress.completed,{});
  await page.evaluate(a=>window.fixture.switchAccount(a),a);await synced();await open();
  entry.checks.push('real Auth, lesson save, separate RPC readback, reload, A/B/logout isolation');
  // Offline legacy JSON import persists locally; explicit sync after reconnect uses the real RPC.
  await smoke.context.setOffline(true);await button('학습 기록').click();await button('기록 백업 · 가져오기').click();
  await page.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(JSON.stringify({completed:{e02:true},masteries:{'e02-0':{level:1}},wrong:{'e02-0':true},coins:99}));
  await button('가져오기 검토').click();await button('현재 계정에 병합 확인').click();assert.equal((await snap()).learning.progress.completed.e02,true);
  await smoke.context.setOffline(false);await stats();await synced();assert.equal((await backend.rpc(a,'world_learning_read_v1')).data.progress.completed.e02,true);
  entry.checks.push('offline legacy import retains local record and reconnect readback confirms cloud migration');
  // Second browser context has no localStorage, so this proves actual cross-device restoration.
  const fresh=await smoke.context.browser().newContext({viewport});
  await fresh.addInitScript(config=>window.learningTestConfig=config,{url:backend.url,key:backend.key,session:a});
  await fresh.route('**/tests/browser/learning-test-sdk.js',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await fresh.route('**/*',r=>{const u=new URL(r.request().url());return [smoke.origin,backend.url].includes(u.origin)?r.fallback():r.abort();});
  const other=await fresh.newPage();await other.goto(smoke.origin+'/tests/browser/phone-learning-cloud-harness.html');await other.waitForFunction(()=>window.fixture?.learning.snapshot().cloud.status==='synced');
  assert.equal(await other.evaluate(()=>window.fixture.learning.snapshot().progress.completed.e02),true);await fresh.close();entry.checks.push('new browser context restores cloud-only records');
  await page.screenshot({path:output+'/'+name+'.png'});assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>{const n=document.querySelector('.smartphone-content');return n.scrollWidth>n.clientWidth+2;}),false);
  await button('스마트폰 닫기').click();assert.equal((await snap()).world,true);entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}finally{await smoke.close();}
}report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}finally{backend.cleanup();await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
