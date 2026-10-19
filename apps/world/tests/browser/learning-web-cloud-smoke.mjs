// Real Auth/PostgREST on a disposable loopback database; response-only QA content.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke} from './harness.mjs';
import {localLearningBackend} from '../../../../supabase/tests/support/learning-local.mjs';
import {installWebQA,webButton,webSnapshot,answerWeb,webLogin} from './learning-web-test-support.mjs';
const backend=localLearningBackend(),output='test-results/learning-web-cloud';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Loopback Auth/PostgREST and synthetic content only. Physical devices and production UNKNOWN.']};
if(process.env.PHONE_HEAD_SHA)assert.equal(report.head,process.env.PHONE_HEAD_SHA);
const sdk=await readFile(new URL('./node_modules/@supabase/supabase-js/dist/umd/supabase.js',import.meta.url));
const password='LocalWebOnly-82741!';
const setup=async context=>{await installWebQA(context,{content:true,cloud:true,sdk,config:{url:backend.url,publishableKey:backend.key}});await context.route(backend.url+'/**',r=>r.continue());};
const synced=page=>page.waitForFunction(()=>window.webApp?.snapshot().learning?.cloud.status==='synced');
const flush=async page=>{await webButton(page,'학습 기록').click();await webButton(page,'클라우드 다시 확인').click();await synced(page);};
const importLesson=async(page,id)=>{
 await webButton(page,'학습 기록').click();await webButton(page,'기록 백업 · 가져오기').click();
 await page.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(JSON.stringify({completed:{[id]:true},masteries:{},wrong:{}}));
 await webButton(page,'가져오기 검토').click();await webButton(page,'현재 계정에 병합 확인').click();
};
try{for(const [name,viewport,mobile] of [['pc',{width:1280,height:900},false],['mobile-360',{width:360,height:800},true]]){
 const a=await backend.signup(),b=await backend.signup();
 for(const s of [a,b])assert.equal((await backend.request('/auth/v1/user',{method:'PUT',token:s.access_token,body:{password}})).status,200);
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile}}),entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);let fresh;
 try{
  await setup(smoke.context);const page=await smoke.context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(smoke.origin+'/learn/');await page.getByText('게스트 · 이 브라우저에 기록 보관',{exact:true}).waitFor();
  await webLogin(page,a.user.email,password);await synced(page);assert.equal((await webSnapshot(page)).account,a.user.id);
  await webButton(page,'이어서 배우기').click();for(let i=0;i<6;i++)await answerWeb(page);await flush(page);
  assert.equal((await backend.rpc(a,'world_learning_read_v1')).data.progress.completed.e01,true);
  await page.reload();await synced(page);assert.equal((await webSnapshot(page)).learning.progress.completed.e01,true);
  await webButton(page,'로그아웃').click();await page.getByText('게스트 · 이 브라우저에 기록 보관',{exact:true}).waitFor();assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{});
  await webLogin(page,b.user.email,password);await synced(page);assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{});
  await webButton(page,'로그아웃').click();await webLogin(page,a.user.email,password);await synced(page);
  entry.checks.push('real password login, getUser verification, default shared session storage, lesson save and separate readback, reload, A/B/logout isolation');
  await smoke.context.setOffline(true);await importLesson(page,'e02');assert.equal((await webSnapshot(page)).learning.progress.completed.e02,true);
  await smoke.context.setOffline(false);await flush(page);assert.equal((await backend.rpc(a,'world_learning_read_v1')).data.progress.completed.e02,true);
  entry.checks.push('offline explicit legacy import preserves local source; reconnect and separate readback');
  fresh=await smoke.context.browser().newContext({viewport});
  await fresh.route('**/*',r=>[smoke.origin,backend.url].includes(new URL(r.request().url()).origin)?r.fallback():r.abort());await setup(fresh);
  const other=await fresh.newPage();other.setDefaultTimeout(20000);other.on('pageerror',e=>errors.push(String(e)));await other.goto(smoke.origin+'/learn/');await webLogin(other,a.user.email,password);await synced(other);
  assert.equal((await webSnapshot(other)).learning.progress.completed.e02,true);
  await smoke.context.setOffline(true);await importLesson(page,'e03');await importLesson(other,'e04');await flush(other);
  await smoke.context.setOffline(false);await webButton(page,'학습 기록').click();await webButton(page,'클라우드 다시 확인').click();
  await page.waitForFunction(()=>window.webApp.snapshot().learning.cloud.status==='conflict');assert.equal((await webSnapshot(page)).learning.progress.completed.e03,true);
  await webButton(page,'이 기기 기록을 서버에 적용 확인').click();await synced(page);
  const record=(await backend.rpc(a,'world_learning_read_v1')).data;assert.equal(record.progress.completed.e03,true);assert.equal(record.progress.completed.e04,undefined);
  await webButton(page,'기록 백업 · 가져오기').click();await webButton(page,'충돌 복구 사본 내보내기').click();
  const recovery=JSON.parse(await page.getByRole('textbox',{name:'백업 JSON'}).inputValue());assert.ok(recovery.records.map(r=>JSON.parse(r.raw)).some(r=>r.local?.completed.e03&&r.cloud?.progress.completed.e04));
  entry.checks.push('fresh browser cloud restoration; offline cross-device revision conflict, explicit choice, both copies exportable');
  // A second same-origin tab uses the hub-compatible SDK session. Its signout
  // must clear the first page through Auth broadcasts, without a page refresh.
  const tab=await smoke.context.newPage();await tab.goto(smoke.origin+'/learn/');await synced(tab);assert.equal((await webSnapshot(tab)).account,a.user.id);
  await webButton(tab,'로그아웃').click();await page.waitForFunction(()=>window.webApp.snapshot().auth.status==='guest'&&window.webApp.snapshot().account===null);
  assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{});await tab.close();
  assert.deepEqual(errors,[]);await page.screenshot({path:`${output}/${name}.png`});entry.checks.push('same-origin cross-tab real Auth logout immediately removes A data');entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}finally{await fresh?.close();await smoke.close();}
}report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}finally{backend.cleanup();await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
