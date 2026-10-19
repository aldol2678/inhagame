// Actual World launcher and separate web document; no backend/network authority.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {installWebQA,webButton,webSnapshot,answerWeb} from './learning-web-test-support.mjs';
const output='test-results/learning-web-campus';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Synthetic content and local response-only launcher activation.','Desktop/360px Chromium; installed Android PWA new-tab behavior UNKNOWN.']};
if(process.env.PHONE_HEAD_SHA)assert.equal(report.head,process.env.PHONE_HEAD_SHA);
try{for(const [name,viewport,mobile] of [['pc',{width:1280,height:900},false],['mobile-360',{width:360,height:800},true]]){
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile}}),entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 try{
  const page=await smoke.context.newPage(),requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(60000);
  const boot=async()=>{await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished,null,{timeout:120000});};
  const state=()=>page.evaluate(()=>({input:window.__INHAGAME_P0__.controller.inputEnabled,orbit:window.__INHAGAME_P0__.orbit.inputEnabled,phone:window.__INHAGAME_P0__.smartphone.status()}));
  await boot();assert.equal(requests.some(u=>/\/src\/learning\//.test(u)),false,'World must not import the learning engine/cloud at all');
  await page.locator('#phone-toggle').click();assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.smartphone.launch('learning')),false);await webButton(page,'스마트폰 닫기').click();
  const original=await readFile(new URL('../../src/main.js',import.meta.url),'utf8'),needle='const learning = createLearningLauncher({';assert.ok(original.includes(needle));
  await smoke.context.route('**/src/main.js*',r=>r.fulfill({contentType:'text/javascript',body:original.replace(needle,needle+'\n enabled:true,')}));
  await installWebQA(smoke.context,{content:true});await boot();
  await page.locator('#phone-toggle').click();const before=(await state()).phone.preferences;
  await page.locator('.smartphone-app[data-app-id="learning"]').click();assert.equal((await state()).input,false);assert.equal(await page.locator('.learning-app').count(),0);
  const link=page.getByRole('link',{name:'웹 학습 시작',exact:true});assert.equal(await link.getAttribute('href'),'/learn/');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  const opened=smoke.context.waitForEvent('page');await link.click();const learn=await opened;await learn.bringToFront();learn.setDefaultTimeout(60000);const webRequests=[];learn.on('request',r=>webRequests.push(r.url()));learn.on('pageerror',e=>errors.push(String(e)));
  await learn.waitForFunction(()=>window.webApp?.snapshot().mounted);assert.equal(await learn.evaluate(()=>window.opener),null);assert.equal(await learn.evaluate(()=>!!window.__INHAGAME_P0__),false);
  await webButton(learn,'이어서 배우기').click();for(let i=0;i<6;i++)await answerWeb(learn);assert.equal((await webSnapshot(learn)).learning.progress.completed.e01,true);
  assert.equal(webRequests.some(u=>/\/src\/main\.js|playcanvas|\.glb|\.wasm|\/src\/phone\//.test(u)),false);
  await learn.screenshot({path:`${output}/${name}-web-result.png`});assert.equal(await learn.getByRole('link',{name:'캠퍼스로 이동',exact:true}).getAttribute('href'),'/campus/?lobby=1');await learn.close();await page.bringToFront();
  assert.equal((await state()).phone.current.appId,'learning');await webButton(page,'게임으로 돌아가기').click();assert.equal((await state()).input,true);assert.equal((await state()).orbit,true);
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="learning"]').click();await webButton(page,'홈 화면으로').click();await page.locator('.smartphone-app[data-app-id="maps"]').click();await webButton(page,'뒤로').click();await webButton(page,'스마트폰 닫기').click();assert.equal((await state()).input,true);
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="album"]').click();await webButton(page,'홈 화면으로').click();await page.locator('.smartphone-app[data-app-id="camera"]').click();await page.evaluate(()=>window.__INHAGAME_P0__.photoMode.close('escape'));await webButton(page,'스마트폰 닫기').click();assert.equal((await state()).orbit,true);
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="daily-quiz"]').click();assert.equal((await state()).phone.current.appId,'daily-quiz');await webButton(page,'홈 화면으로').click();await webButton(page,'스마트폰 닫기').click();
  await page.locator('#phone-toggle').click();await page.locator('.smartphone-app[data-app-id="learning"]').click();await page.keyboard.press('Escape');assert.equal((await state()).phone.state,'HOME');await page.keyboard.press('Escape');assert.equal((await state()).phone.state,'CLOSED');assert.equal((await state()).input,true);
  assert.deepEqual((await state()).phone.preferences,before,'launcher must not reorder home/dock or write preferences');assert.deepEqual(errors,[]);
  entry.checks.push('World default OFF and zero learning engine imports','explicit noopener link opens independent page; six-question result; closing web retains original game; return releases player/orbit focus','Phone Escape/Back/Home/Close, maps/album/camera/daily-quiz and unchanged home/dock preferences');entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}finally{await smoke.close();}
}report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
