// Real Smartphone + InputFocus + Learning, synthetic data by default. No live backend.
// Optional private fixture stays in memory and all evidence MUST be outside this checkout.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {startSmoke} from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.PHONE_HEAD_SHA)assert.equal(head,process.env.PHONE_HEAD_SHA);
const privateFile=process.env.LEARNING_PRIVATE_FIXTURE;
const output=resolve(process.env.LEARNING_EVIDENCE_DIR||'test-results/phone-learning');
if(privateFile){const path=relative(process.cwd(),output);assert.ok(path.startsWith('..')||isAbsolute(path),'Private evidence must be outside the repository');}
await mkdir(output,{recursive:true});
const sources=['src/learning/learning-content.js','src/learning/learning-progress.js','src/learning/learning-engine.js','src/learning/learning-controller.js','src/learning/learning-view.js','src/learning/learning-speech.js','src/phone/smartphone.js','src/phone/phone-preferences.js','learning.css'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
const report={head,sourceHashes:hashes,privateFixture:!!privateFile,cases:[],limits:['Chromium viewport/touch emulation; not a physical Android device.','Real Phone and InputFocus with World/Daily Quiz test doubles; live reward backend not exercised.']};
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
async function check(name,viewport,mobile){
 const entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'}});
 try{
  if(privateFile){const payload=await readFile(privateFile,'utf8');await smoke.context.route('**/tests/support/learning-fixture.mjs',r=>r.fulfill({contentType:'text/javascript',body:`export const learningFixture=()=>(${payload});`}));}
  const page=await smoke.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(15000);
  await page.goto(smoke.origin+'/tests/browser/phone-learning-harness.html');await page.waitForFunction(()=>window.fixture);
  const snap=()=>page.evaluate(()=>window.fixture.snapshot());
  const button=name=>page.getByRole('button',{name,exact:true});
  async function open(){await page.evaluate(()=>{window.fixture.phone.open();window.fixture.phone.launch('learning');});}
  async function answer(wrong=false){
    const r=(await snap()).learning.run,q=r.questions[r.index];
    if(q.type==='order')for(const part of q.parts)await page.locator('.learning-answers').getByRole('button',{name:part,exact:true}).first().click();
    else if(q.type==='match')for(const [l,v] of q.pairs){await page.locator('.learning-match').getByRole('button',{name:l,exact:true}).click();await page.locator('.learning-match').getByRole('button',{name:v,exact:true}).click();}
    else {const i=wrong?(q.a+1)%q.options.length:q.a;await button(`${String.fromCharCode(65+i)}. ${q.options[i]}`).click();}
    await button('정답 확인하기').click();
    await button(r.index+1===r.questions.length?'결과 확인하기':'다음 문제').click();
  }
  assert.equal((await snap()).world,true);await open();assert.equal((await snap()).world,false);
  await button('이어서 배우기').click();for(let i=0;i<6;i++)await answer(i===0);
  assert.equal((await snap()).learning.screen,'result');assert.equal((await snap()).learning.progress.completed.e01,true);
  assert.equal(Object.keys((await snap()).learning.progress.wrong).length,1);
  await page.screenshot({path:output+'/'+name+'-result.png'});
  await button('홈 화면으로').click();await button('스마트폰 닫기').click();assert.equal((await snap()).world,true);
  await open();await button('오답 복습').click();await page.locator('.learning-app').getByRole('button',{name:/^오답 ·/}).click();await answer();
  assert.equal(Object.keys((await snap()).learning.progress.wrong).length,0);
  await button('학습 홈').click();await button('오늘의 퀴즈').click();assert.equal((await snap()).phone.current.appId,'daily-quiz');
  assert.equal((await snap()).learning.mounted,false);assert.equal(await page.evaluate(()=>window.fixture.dailyOpens),1);
  await button('뒤로').click();assert.equal((await snap()).phone.current.appId,'learning');await button('홈 화면으로').click();await button('스마트폰 닫기').click();
  entry.checks.push('World → Phone → six-question lesson → result → Home → World; wrong review; Daily Quiz deep link and Back');
  await page.reload();await page.waitForFunction(()=>window.fixture);await open();assert.equal((await snap()).learning.progress.completed.e01,true);
  const saved=(await snap()).learning.progress;await page.evaluate(B=>window.fixture.switchAccount(B),B);assert.equal((await snap()).world,true);assert.deepEqual((await snap()).learning.progress.completed,{});assert.equal((await snap()).learning.run,null);
  await open();await button('이어서 배우기').click();await answer(true);assert.equal((await snap()).learning.progress.learningHistory[Object.keys(saved.learningHistory)[0]].answered,1);
  await page.evaluate(()=>window.fixture.switchAccount(null));assert.deepEqual((await snap()).learning.progress.completed,{});
  await page.evaluate(A=>window.fixture.switchAccount(A),A);assert.deepEqual((await snap()).learning.progress,saved);await open();
  entry.checks.push('actual localStorage reload, A/B/logout isolation, checked answers and versions retained');
  await button('듣기 · 말하기 연습').click();await button('문장 음성 재생').click();await page.getByRole('textbox',{name:'연습 문장 직접 입력'}).fill('typed practice');await button('입력 확인').click();
  assert.equal(Object.values((await snap()).learning.progress.speech)[0].typed,1);
  await button('학습 기록').click();await button('기록 백업 · 가져오기').click();await button('백업 JSON 만들기').click();
  const backup=await page.getByRole('textbox',{name:'백업 JSON'}).inputValue();assert.doesNotMatch(backup,/"coins"|"campusXp"|"prompt"|"rank"/);
  await page.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(backup);await button('가져오기 검토').click();await button('현재 계정에 병합 확인').click();
  await page.evaluate(()=>window.fixture.failRender());await button('학습 홈').click();assert.equal((await snap()).learning.screen,'home');
  await button('스마트폰 닫기').click();assert.equal((await snap()).world,true);await open();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal((await snap()).world,true);assert.equal((await snap()).learning.mounted,false);
  await open();await page.screenshot({path:output+'/'+name+'-home.png'});
  assert.equal(await page.evaluate(()=>{const n=document.querySelector('.smartphone-content');return n.scrollWidth>n.clientWidth+2;}),false);
  assert.deepEqual(errors,[]);entry.checks.push('speech text fallback, manual export/import, render exception recovery, pagehide teardown, no horizontal overflow or page errors');entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}
 finally{await smoke.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
}
try{for(const [name,viewport,mobile] of [['desktop',{width:1280,height:900},false],['android-360',{width:360,height:640},true]])await check(name,viewport,mobile);report.status='PASS';}
catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}
finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
