import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke} from './harness.mjs';
import {installWebQA,webButton,webSnapshot,answerWeb,webLogin,assertWebLayout} from './learning-web-test-support.mjs';
const output='test-results/learning-web';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Synthetic Auth response adapter and synthetic course; real Auth is a separate cloud suite.','Chromium viewport/touch emulation only; normal browser tabs. Physical Android/iOS and installed PWA UNKNOWN.']};
if(process.env.PHONE_HEAD_SHA)assert.equal(report.head,process.env.PHONE_HEAD_SHA);
try{for(const [name,width,height,mobile] of [['pc',1280,900,false],['mobile-360',360,800,true],['mobile-390',390,844,true],['landscape-844',844,390,true]]){
 const smoke=await startSmoke({viewport:{width,height},contextOptions:{isMobile:mobile,hasTouch:mobile}}),entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 try{
  await installWebQA(smoke.context);const page=await smoke.context.newPage(),errors=[],requests=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>{window.graphicsCalls=0;if(Object.getOwnPropertyDescriptor(navigator,'gpu')?.configurable!==false)Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter(){window.graphicsCalls++;throw Error('UNEXPECTED_GPU');}}});const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl|webgpu/.test(kind)){window.graphicsCalls++;throw Error('UNEXPECTED_3D');}return get.call(this,kind,...args);};});
  const response=await page.goto(smoke.origin+'/learn?enable=1&returnTo=https://evil.test#access_token=synthetic');assert.equal(response.status(),200);await page.getByText('게스트 · 이 브라우저에 기록 보관',{exact:true}).waitFor();assert.equal(page.url(),smoke.origin+'/learn/');
  assert.equal(await page.locator('.learning-app').count(),0);await assertWebLayout(page);await page.screenshot({path:`${output}/${name}-preparing.png`});
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex,nofollow');
  assert.equal(requests.some(u=>/\/src\/main\.js|\/src\/phone\/|playcanvas|\.glb|\.wasm|\/learning-content\/|phone\.css|\/campus\/index/.test(u)),false);
  assert.equal(await page.evaluate(()=>window.graphicsCalls),0);
  entry.checks.push('/learn HTTP 200 and canonical route; default OFF has zero questions/content requests; no World/Phone/3D/GPU dependencies; redirect/token input ignored');
  await page.evaluate(async()=>{const {emptyProgress}=await import('/src/learning/learning-progress.js');const a=emptyProgress(),b=emptyProgress();a.completed.e02=true;b.completed.e03=true;localStorage.setItem('inha-world-learning-v1:user:A',JSON.stringify(a));localStorage.setItem('inha-world-learning-v1:user:B',JSON.stringify(b));});
  await installWebQA(smoke.context,{content:true});await page.reload();await page.waitForFunction(()=>window.webApp?.snapshot().mounted);assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{});
  await page.evaluate(()=>window.webVerifyDelay=true);await page.getByLabel('이메일',{exact:true}).fill('A@example.test');await page.getByLabel('비밀번호',{exact:true}).fill('synthetic-only');await webButton(page,'기존 계정으로 로그인').click();
  await page.waitForFunction(()=>window.webVerifyRelease);assert.equal(await page.locator('#learn-root').isVisible(),false);assert.equal((await webSnapshot(page)).auth.user,null);
  await page.evaluate(()=>{window.webVerifyDelay=false;window.webVerifyRelease();});await page.waitForFunction(()=>window.webApp?.snapshot().mounted);assert.equal((await webSnapshot(page)).learning.progress.completed.e02,true);
  await webButton(page,'이어서 배우기').click();for(let i=0;i<5;i++)await answerWeb(page,{wrong:i===0});
  if(name==='mobile-360'){
   assert.equal(await page.evaluate(()=>{let name;for(const size of [262144,1024,32])for(let i=0;i<10000;i++)try{localStorage.setItem(`web-padding:${size}:${i}`,'x'.repeat(size));}catch(e){name=e.name;break;}return name;}),'QuotaExceededError');
  }
  await answerWeb(page);assert.equal((await webSnapshot(page)).learning.progress.completed.e01,true);assert.equal(Object.keys((await webSnapshot(page)).learning.progress.wrong).length,1);
  if(name==='mobile-360'){
   await page.getByRole('heading',{name:'풀이 종료 · 기록 미저장'}).waitFor();await webButton(page,'현재 결과 백업하기').click();await webButton(page,'백업 JSON 만들기').click();assert.equal(JSON.parse(await page.getByRole('textbox',{name:'백업 JSON'}).inputValue()).progress.completed.e01,true);
   await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('web-padding:'))localStorage.removeItem(k);});await webButton(page,'저장 다시 시도').click();assert.equal((await webSnapshot(page)).learning.save.status,'saved');entry.checks.push('actual browser quota: final result retained, export, retry and durable reload');
  }
  await page.reload();await page.waitForFunction(()=>window.webApp?.snapshot().mounted);assert.equal((await webSnapshot(page)).learning.progress.completed.e01,true);
  const wrongKey=Object.keys((await webSnapshot(page)).learning.progress.wrong)[0];assert.match(wrongKey,/^qv:.+@1$/);
  await webButton(page,'오답 복습').click();await page.getByRole('button',{name:/^오답 ·/}).click();await answerWeb(page);assert.equal(Object.keys((await webSnapshot(page)).learning.progress.wrong).length,0);
  await webButton(page,'학습 기록').click();await webButton(page,'기록 백업 · 가져오기').click();await webButton(page,'백업 JSON 만들기').click();const backup=await page.getByRole('textbox',{name:'백업 JSON'}).inputValue();assert.doesNotMatch(backup,/"coins"|"prompt"|"answer"/);
  await page.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(backup);await webButton(page,'가져오기 검토').click();await webButton(page,'현재 계정에 병합 확인').click();
  await webButton(page,'로그아웃').click();await page.waitForFunction(()=>window.webApp.snapshot().auth.status==='guest'&&window.webApp.snapshot().mounted);assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{});
  await webLogin(page,'B@example.test');assert.deepEqual((await webSnapshot(page)).learning.progress.completed,{e03:true});assert.equal((await webSnapshot(page)).learning.run,null);
  await webButton(page,'로그아웃').click();await webLogin(page,'A@example.test');assert.equal((await webSnapshot(page)).learning.progress.completed.e01,true);
  if(name==='mobile-360'){
   const stale=await smoke.context.newPage();await stale.goto(smoke.origin+'/learn/');await stale.waitForFunction(()=>window.webApp?.snapshot().mounted);
   await webButton(page,'이어서 배우기').click();await webButton(stale,'이어서 배우기').click();await answerWeb(page);await answerWeb(stale,{advance:false});
   assert.equal((await webSnapshot(stale)).learning.save.status,'unsaved');const retained=(await webSnapshot(stale)).learning.progress;
   await stale.evaluate(()=>{window.webVerifyDelay=true;dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
   await stale.waitForFunction(()=>window.webVerifyRelease);assert.equal(await stale.locator('#learn-root').isVisible(),false);
   await stale.evaluate(()=>{window.webVerifyDelay=false;window.webVerifyRelease();});await stale.waitForFunction(()=>window.webApp.snapshot().mounted);
   assert.deepEqual((await webSnapshot(stale)).learning.progress,retained);assert.equal((await webSnapshot(stale)).learning.save.status,'unsaved');
   await webButton(stale,'현재 결과 백업하기').click();await webButton(stale,'백업 JSON 만들기').click();assert.deepEqual(JSON.parse(await stale.getByRole('textbox',{name:'백업 JSON'}).inputValue()).progress,retained);
   await stale.close();entry.checks.push('two-tab stale write refused and exportable; simulated BFCache revalidation hides personal UI and retains unsaved same-account memory');
  }
  await webButton(page,'학습 홈').click();await assertWebLayout(page);await page.screenshot({path:`${output}/${name}-learning.png`});
  assert.equal(await page.getByRole('link',{name:'캠퍼스로 이동',exact:true}).getAttribute('href'),'/campus/?lobby=1');assert.equal(await page.getByRole('link',{name:'게임에서 오늘의 퀴즈 열기'}).getAttribute('href'),'/campus/?lobby=1&shortcut=daily-quiz');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>window.graphicsCalls),0);assert.deepEqual(errors,[]);
  entry.checks.push('pre-verification personal UI blocked; same-origin keys restored; A/B/guest isolation; lesson/result/wrong-version review/export/import/reload; cloud OFF; 44px targets/no overflow/static return links');entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}finally{await smoke.close();}
}report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
