// UI-ICON-RUNTIME-01: real local Campus browser, isolated network and no live writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.UI_ICON_HEAD_SHA,'exact-head checkout required');
const output='test-results/ui-icon-runtime';await mkdir(output,{recursive:true});
const variants=[['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]];
const report={head,status:'RUNNING',cases:[],limits:['Mobile viewport emulation is not physical Android/iOS QA.','No production, authenticated member, or live server writes.']};
const save=()=>writeFile(output+'/report.json',JSON.stringify(report,null,2));
for(const [name,viewport,mobile] of variants){
 const entry={name,viewport,status:'RUNNING',checks:[],screenshots:[]};report.cases.push(entry);await save();
 let smoke;
 try{
   smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'reduce'}});
   const page=await smoke.context.newPage(),fatal=smoke.watch(page);
   await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished===true,null,{timeout:120000}),fatal]);
   const assets=await page.evaluate(async()=>{
     const names=['album','attendance','camera','chat','collection','friends','help','inventory','lock','map','mobility','notification','profile','quest','quiz','settings','shop','student-id','wardrobe'];
     return Promise.all(names.map(async name=>{
       const response=await fetch('/assets/ui-icons/p0-v1/svg/'+name+'.svg');
       return {name,status:response.status,svg:(await response.text()).includes('<svg')};
     }));
   });
   assert.equal(assets.length,19);
   assert.ok(assets.every(a=>a.status===200&&a.svg),JSON.stringify(assets));
   entry.checks.push('all 19 SVG sources served by real local World');
   await page.waitForFunction(()=>!!document.querySelector('#chat-toggle > .world-ui-icon[data-state="ready"]'));
   assert.equal(await page.locator('#chat-toggle .world-ui-icon-image').evaluate(img=>img.naturalWidth>0),true);
   await page.locator('#hud-menu-toggle').click();
   await page.waitForFunction(()=>!!document.querySelector('#open-inventory > .world-ui-icon[data-state="ready"]'));
   assert.match(await page.locator('#open-inventory').innerText(),/인벤토리/);
   assert.equal(await page.locator('#open-inventory').getAttribute('id'),'open-inventory');
   await page.screenshot({path:output+'/'+name+'-hud.png',animations:'disabled'});
   entry.screenshots.push(name+'-hud.png');
   entry.checks.push('HUD original button identities and readable text preserved');
   await page.locator('#hud-menu-toggle').click();
   if(mobile)await page.locator('#phone-toggle').tap();else await page.keyboard.press('KeyN');
   await page.waitForFunction(()=>document.querySelectorAll('.smartphone-app-icon > .world-ui-icon[data-state="ready"]').length>=5);
   const phone=await page.evaluate(()=>{
     const apps=[...document.querySelectorAll('.smartphone-app[data-app-id]')];
     const bounds=document.querySelector('.smartphone-frame').getBoundingClientRect();
     return {ids:apps.map(x=>x.dataset.appId),
       loaded:apps.every(x=>x.querySelector('.smartphone-app-icon > .world-ui-icon[data-state="ready"]')?.querySelector('img')?.naturalWidth>0),
       labels:apps.every(x=>!!x.getAttribute('aria-label')),
       focus:document.querySelector('.smartphone').contains(document.activeElement),
       fit:bounds.left>=-1&&bounds.top>=-1&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1};
   });
   assert.ok(phone.ids.includes('student-id')&&phone.ids.includes('album')&&phone.ids.includes('camera'));
   assert.ok(phone.loaded&&phone.labels&&phone.focus&&phone.fit,JSON.stringify(phone));
   entry.checks.push('Phone home/dock SVG load, accessibility, focus and viewport fit');
   await page.screenshot({path:output+'/'+name+'-phone.png',animations:'disabled'});
   entry.screenshots.push(name+'-phone.png');
   const fallback=await page.evaluate(()=>{
     const host=document.querySelector('.smartphone-app[data-app-id="album"] .smartphone-app-icon');
     const root=host.querySelector('.world-ui-icon');
     root.querySelector('img').dispatchEvent(new Event('error'));
     return {state:root.dataset.state,text:root.querySelector('.world-ui-icon-fallback').textContent,
       visible:!root.querySelector('.world-ui-icon-fallback').hidden,label:host.closest('button').getAttribute('aria-label')};
   });
   assert.equal(fallback.state,'fallback');assert.equal(fallback.visible,true);
   assert.ok(fallback.text&&fallback.label.includes('앨범'));
   entry.checks.push('load error restores local emoji, no accessibility label lost');
   await page.evaluate(()=>{document.querySelector('.smartphone-message').textContent='로컬 상태 알림 검증';});
   await page.waitForFunction(()=>!!document.querySelector('.smartphone-message > .world-ui-icon[data-icon="notification"][data-state="ready"]'));
   await page.evaluate(()=>{document.querySelector('.smartphone-message').textContent='';});
   assert.equal(await page.locator('.smartphone-message > .world-ui-icon').count(),0);
   entry.checks.push('existing Phone status notification decoration and clearing');
   await page.locator('.smartphone-app[data-app-id="student-id"]').click();
   assert.equal(await page.locator('.smartphone-student-card').isVisible(),true);
   await page.locator('.smartphone-home-button').click();
   await page.waitForFunction(()=>!!document.querySelector('.smartphone-app[data-app-id="album"] .world-ui-icon[data-state="ready"]'));
   entry.checks.push('student ID and Home re-render preserved');
   assert.deepEqual(smoke.problems,[]);
   entry.status='PASS';await save();
 }catch(error){entry.status='FAIL';entry.error=String(error.stack||error);report.status='FAIL';await save();throw error;}
 finally{if(smoke)await smoke.close();}
}
report.status='PASS';await save();console.log('UI_ICON_RUNTIME_BROWSER_PASS',head);
