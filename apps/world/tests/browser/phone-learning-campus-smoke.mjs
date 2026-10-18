// Actual campus offline. First verify shipped OFF, then inject only synthetic QA
// content via Playwright's local main.js response (no shipped URL/global bypass).
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.PHONE_HEAD_SHA)assert.equal(head,process.env.PHONE_HEAD_SHA);
const output='test-results/phone-learning-campus';await mkdir(output,{recursive:true});
const report={head,cases:[],limits:['Offline campus, synthetic learning fixture injected into local main.js response.','Chromium mobile emulation, not physical Android. Live signed-in Daily Quiz rewards not exercised.']};
for(const [name,viewport,mobile] of [['desktop',{width:1280,height:900},false],['android-360',{width:360,height:640},true]]){
 const entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'}});
 try{
  const page=await smoke.context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(60000);
  const boot=async()=>{await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});};
  const button=n=>page.getByRole('button',{name:n,exact:true});
  const world=()=>page.evaluate(()=>({input:window.__INHAGAME_P0__.controller.inputEnabled,orbit:window.__INHAGAME_P0__.orbit.inputEnabled}));
  await boot();await page.locator('#phone-toggle').click();assert.equal(await page.locator('.smartphone-app[data-app-id="learning"] .smartphone-app-name').count(),0);
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.launch('learning')),false);await button('스마트폰 닫기').click();
  entry.checks.push('unmodified main defaults OFF; no Learning icon or launch');
  const original=await readFile(new URL('../../src/main.js',import.meta.url),'utf8');
  const needle='const learning = createLearningController({';assert.ok(original.includes(needle));
  const instrumented=`import {createLearningCatalog} from './learning/learning-content.js';\nimport {learningFixture} from '/tests/support/learning-fixture.mjs';\n`+original.replace(needle,needle+'\n  content:createLearningCatalog(learningFixture()),');
  await smoke.context.route('**/src/main.js*',r=>r.fulfill({contentType:'text/javascript',body:instrumented}));await boot();
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="learning"]').click();assert.deepEqual(await world(),{input:false,orbit:false});
  await button('이어서 배우기').click();
  await button('A. test-correct').click();await button('정답 확인하기').click();await button('다음 문제').click();
  await button('test-one').click();await button('test-two').click();await button('정답 확인하기').click();await button('다음 문제').click();
  for(let i=1;i<=2;i++){await button(`test-left-${i}`).click();await button(`test-right-${i}`).click();}
  await button('정답 확인하기').click();await button('다음 문제').click();
  for(let i=3;i<6;i++){await button('A. test-correct').click();await button('정답 확인하기').click();await button(i===5?'결과 확인하기':'다음 문제').click();}
  await page.getByRole('heading',{name:'학습 완료! 🌱'}).waitFor();await page.screenshot({path:output+'/'+name+'-result.png'});
  await button('홈 화면으로').click();await button('스마트폰 닫기').click();assert.deepEqual(await world(),{input:true,orbit:true});
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="learning"]').click();await button('학습 홈').click();await button('오늘의 퀴즈').click();
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.status().current.appId),'daily-quiz');await button('뒤로').click();assert.equal(await page.locator('.learning-app').count(),1);await button('홈 화면으로').click();
  await page.locator('.smartphone-app[data-app-id="maps"]').click();await button('홈 화면으로').click();await page.locator('.smartphone-app[data-app-id="album"]').click();await button('홈 화면으로').click();
  await page.locator('.smartphone-app[data-app-id="camera"]').click();assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.status().state),'CAMERA');
  await page.evaluate(()=>window.__INHAGAME_P0__.photoMode.close('escape'));await button('스마트폰 닫기').click();assert.deepEqual(await world(),{input:true,orbit:true});
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="learning"]').click();await button('학습 홈').click();await page.screenshot({path:output+'/'+name+'-home.png'});
  assert.equal(await page.evaluate(()=>{const n=document.querySelector('.smartphone-content');return n.scrollWidth>n.clientWidth+2;}),false);
  assert.deepEqual(errors,[]);entry.checks.push('actual World → Phone → Learning → Lesson → Result → Home → World with player/orbit restored','existing daily-quiz surface and Back, maps, album, camera handoff, 360px no overflow');entry.status='PASS';
 }catch(error){entry.status='FAIL';entry.error=String(error.stack);process.exitCode=1;}
 finally{await smoke.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
 if(process.exitCode)break;
}
report.status=report.cases.length===2&&report.cases.every(x=>x.status==='PASS')?'PASS':'FAIL';await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
