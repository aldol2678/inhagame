// Real browser storage failure and recovery. Only newly authored synthetic questions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke} from './harness.mjs';
const output='test-results/phone-learning-remediation';await mkdir(output,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Chromium viewport/touch emulation; physical Android/iOS UNKNOWN.']};
if(process.env.PHONE_HEAD_SHA)assert.equal(report.head,process.env.PHONE_HEAD_SHA);
const button=(p,n)=>p.getByRole('button',{name:n,exact:true});
const snap=p=>p.evaluate(()=>window.fixture.snapshot());
const open=p=>p.evaluate(()=>{window.fixture.phone.open();window.fixture.phone.launch('learning');});
async function answer(p,{advance=true}={}){
 const r=(await snap(p)).learning.run,q=r.questions[r.index];
 if(q.type==='order')for(const part of q.parts)await p.locator('.learning-answers').getByRole('button',{name:part,exact:true}).first().click();
 else if(q.type==='match')for(const [l,v] of q.pairs){await p.locator('.learning-match').getByRole('button',{name:l,exact:true}).click();await p.locator('.learning-match').getByRole('button',{name:v,exact:true}).click();}
 else await button(p,`${String.fromCharCode(65+q.a)}. ${q.options[q.a]}`).click();
 await button(p,'정답 확인하기').click();if(advance)await button(p,r.index+1===r.questions.length?'결과 확인하기':'다음 문제').click();
}
try{for(const [name,viewport,mobile] of [['desktop',{width:1280,height:900},false],['android-360',{width:360,height:640},true]]){
 const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile}}),entry={name,status:'RUNNING',checks:[]};report.cases.push(entry);
 try{
  const p=await smoke.context.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));p.setDefaultTimeout(15000);
  await p.goto(smoke.origin+'/tests/browser/phone-learning-harness.html');await p.waitForFunction(()=>window.fixture);await open(p);await button(p,'이어서 배우기').click();
  for(let i=0;i<5;i++)await answer(p);
  // Fill this isolated origin's actual localStorage, then leave too little for a new mastery.
  const quota=await p.evaluate(()=>{let name='';for(const size of [262144,1024,32])for(let i=0;i<10000;i++)try{localStorage.setItem(`quota-padding:${size}:${i}`,'x'.repeat(size));}catch(e){name=e.name;break;}return name;});assert.equal(quota,'QuotaExceededError');
  await answer(p);let s=await snap(p);assert.equal(s.learning.save.status,'unsaved');assert.equal(s.learning.run.correct,6);assert.equal(s.learning.progress.completed.e01,true);
  assert.equal(await p.getByRole('heading',{name:'풀이 종료 · 기록 미저장'}).count(),1);assert.equal(await p.getByText('이 기기에 저장 확인 완료',{exact:true}).count(),0);
  await p.screenshot({path:`${output}/${name}-unsaved.png`});
  await button(p,'현재 결과 백업하기').click();await button(p,'백업 JSON 만들기').click();const backup=await p.getByRole('textbox',{name:'백업 JSON'}).inputValue();assert.equal(JSON.parse(backup).progress.completed.e01,true);
  await p.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('quota-padding:'))localStorage.removeItem(k);});
  await button(p,'저장 다시 시도').click();assert.equal((await snap(p)).learning.save.status,'saved');await p.reload();await p.waitForFunction(()=>window.fixture);assert.equal((await snap(p)).learning.progress.completed.e01,true);
  entry.checks.push('actual browser quota failure on final answer/result: visible unsaved state, export, retry, reload retain six answers');
  await open(p);await button(p,'학습 기록').click();await button(p,'기록 백업 · 가져오기').click();
  await p.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(JSON.stringify({completed:{e01:true,e02:true,e03:true,e04:true,e05:true},masteries:{},wrong:{}}));await button(p,'가져오기 검토').click();await button(p,'현재 계정에 병합 확인').click();
  await button(p,'전체 레슨').click();await p.getByRole('button',{name:'보스 시험 · 5문항 중 4문항 정답으로 합격',exact:true}).first().click();
  for(let i=0;i<4;i++)await answer(p);await answer(p,{advance:false});
  await p.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('inha-world-learning'))throw new DOMException('denied','SecurityError');return window.originalStorageSet.call(this,k,v);};});
  await button(p,'결과 확인하기').click();assert.equal((await snap(p)).learning.save.status,'unsaved');assert.equal((await snap(p)).learning.progress.bosses[0].count,1);
  await button(p,'홈 화면으로').click();await button(p,'스마트폰 닫기').click();assert.equal((await snap(p)).world,true);await open(p);assert.equal((await snap(p)).learning.save.status,'unsaved');
  await p.evaluate(()=>Storage.prototype.setItem=window.originalStorageSet);await button(p,'저장 다시 시도').click();assert.equal((await snap(p)).learning.progress.bosses[0].count,1);
  entry.checks.push('boss final write denied: result retained across Phone Home/Close/reopen; retry counts boss once and restores World input');
  await button(p,'학습 기록').click();await button(p,'기록 백업 · 가져오기').click();await button(p,'충돌 복구 사본 내보내기').click();const recovery=await p.getByRole('textbox',{name:'백업 JSON'}).inputValue();
  await button(p,'백업 파일 보관 확인 · 사본 정리').click();
  await p.getByRole('textbox',{name:'가져올 기록 JSON'}).fill(recovery);await button(p,'가져오기 검토').click();await p.getByRole('button',{name:/^복구 사본 1 ·/}).click();await button(p,'현재 계정에 병합 확인').click();assert.equal((await snap(p)).learning.progress.bosses[0].count,1);
  entry.checks.push('recovery bundle exported before cleanup, selected original imported after cleanup');
  const other=await smoke.context.newPage();await other.goto(smoke.origin+'/tests/browser/phone-learning-harness.html');await other.waitForFunction(()=>window.fixture);await open(other);
  await button(p,'학습 홈').click();await button(p,'이어서 배우기').click();await button(other,'이어서 배우기').click();await answer(p);await answer(other);
  assert.equal((await snap(other)).learning.save.reason,'LOCAL_CONFLICT');assert.equal((await snap(other)).learning.run.correct,1);
  await button(other,'현재 결과 백업하기').click();await button(other,'백업 JSON 만들기').click();assert.ok(await other.getByRole('textbox',{name:'백업 JSON'}).inputValue());
  await button(other,'스마트폰 닫기').click();assert.equal((await snap(other)).world,true);await other.close();
  entry.checks.push('two real tabs: stale write refused, checked answer retained and export available');
  assert.deepEqual(errors,[]);entry.status='PASS';
 }catch(e){entry.status='FAIL';entry.error=String(e.stack);throw e;}finally{await smoke.close();}
}report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack);process.exitCode=1;}finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
