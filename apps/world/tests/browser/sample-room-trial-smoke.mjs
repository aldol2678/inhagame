import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {startSmoke} from './harness.mjs';
const output='test-results/sample-room-trial';await mkdir(output,{recursive:true});const results=[];
const report={status:'RUNNING',physicalMobile:'NOT_TESTED',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:{},results};
if(process.env.SAMPLE_ROOM_HEAD_SHA)assert.equal(report.head,process.env.SAMPLE_ROOM_HEAD_SHA,'QA must run against the PR exact head');
for(const file of ['src/commissions/sample-room-trial.js','src/commissions/sample-room-trial-panel.js','src/commissions/sample-room-trial-preview.js','src/commissions/sample-room-trial-preview-frame.js','src/commissions/sample-room-trial-preview-frame.html','src/rooms/personal-room-renderer.js','src/rooms/furniture-renderer.js','src/rooms/furniture-layout.js','src/rooms/personal-room-seats.js','tests/browser/sample-room-trial-smoke.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../../'+file,import.meta.url))).digest('hex');
const save=()=>writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await save();
try {
for(const[name,width,height]of [['desktop',1280,800],['portrait',390,844],['landscape',844,390]]){
 let smoke,page;const errors=[];
 try{
  smoke=await startSmoke({viewport:{width,height}});
  page=await smoke.context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let writes=0;page.on('request',req=>{if(!['GET','HEAD'].includes(req.method()))writes++;});
  await page.goto(`${smoke.origin}/tests/browser/sample-room-trial-harness.html`);await page.click('#open');
  await page.waitForFunction(()=>window.__SAMPLE_TRIAL_QA__?.panel.state().preview?.frames>2);
  const initial=await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.state());assert.equal(initial.objects.length,5);assert.equal(initial.result.complete,false);
  const panel=page.locator('#sample-room-trial');await panel.locator('iframe').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${name}-initial.png`});
  const select=panel.locator('select');
  for(const id of ['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000014']){await select.selectOption(id);await panel.getByRole('button',{name:'회수',exact:true}).click();}
  await select.selectOption('00000000-0000-4000-8000-000000000013');
  const move=panel.getByRole('button',{name:'가구 이동 →',exact:true});for(let i=0;i<13;i++)await move.click();
  await panel.getByRole('button',{name:'책장에 책 정리',exact:true}).click();await panel.getByRole('button',{name:'배치 확인',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.state().result.complete),true);await page.screenshot({path:`${output}/${name}-complete.png`});
  // Repeated editing stays live after completion; keyboard and touch use the same model.
  await select.selectOption('00000000-0000-4000-8000-000000000013');await move.focus();await page.keyboard.press('r');
  assert.equal(await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.state().objects[0].yaw),45);
  await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);assert.equal(await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.state().objects.length),0);
  await page.click('#open');await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.account('fixture-b'));assert.equal(await panel.isVisible(),false);
  await page.click('#open');await page.evaluate(()=>dispatchEvent(new PopStateEvent('popstate')));assert.equal(await panel.isVisible(),false);
  await page.click('#open');await panel.getByRole('button',{name:'처음부터',exact:true}).click();assert.equal(await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.state().objects.length),5);
  await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.enable(false));assert.equal(await panel.isVisible(),false);await page.click('#open');assert.equal(await panel.isVisible(),false);
  await page.evaluate(()=>window.__SAMPLE_TRIAL_QA__.panel.destroy());assert.equal(await panel.count(),0);assert.equal(writes,0);assert.deepEqual(errors,[]);
  results.push({name,initial:initial.preview,writeRequests:writes,errors,status:'PASS'});
 }catch(error){
  results.push({name,status:'FAIL',error:error.stack,errors});
  if(page&&!page.isClosed())await page.screenshot({path:`${output}/${name}-failure.png`}).catch(()=>{});
  throw error;
 }finally{await save();await smoke?.close();}
}
report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;throw error;}finally{await save();}
