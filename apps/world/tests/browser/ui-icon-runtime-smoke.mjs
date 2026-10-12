// UI-ICON-RUNTIME-01: real local Campus browser, isolated network and no live writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.UI_ICON_HEAD_SHA,'exact-head checkout required');
const output='test-results/ui-icon-runtime';await mkdir(output,{recursive:true});
const variants=[['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]];
const report={head,status:'RUNNING',cases:[],limits:['Mobile viewport emulation is not physical Android/iOS QA.','No production, authenticated member, or live server writes.']};
const save=()=>writeFile(output+'/report.json',JSON.stringify(report,null,2));
// The regression fixture restores exactly the two pre-fix interaction defaults.
// Controllers, layout, source assets and backend isolation stay identical in all modes.
const iconSource=await readFile(new URL('../../src/ui/ui-icon-runtime.js',import.meta.url),'utf8');
const iconCss=await readFile(new URL('../../ui-icon-runtime.css',import.meta.url),'utf8');
assert.ok(iconSource.includes('img.draggable=false;'));
assert.ok(iconCss.includes('.world-ui-icon, .world-ui-icon * { pointer-events:none; }'));
const priorSource=iconSource.replace('img.draggable=false;','');
const priorCss=iconCss.replace('.world-ui-icon, .world-ui-icon * { pointer-events:none; }','');
const state=page=>page.evaluate(()=>window.__INHAGAME_P0__.smartphone.status());
async function freshPage(smoke,mode){
 const page=await smoke.context.newPage();page.setDefaultTimeout(60000);
 await page.addInitScript(()=>{if(!sessionStorage.getItem('ui-icon-drag-fixture')){localStorage.clear();sessionStorage.setItem('ui-icon-drag-fixture','1');}});
 if(mode==='off')await page.route('**/src/ui/ui-icon-runtime.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* icon-off control: existing emoji presentation */'}));
 if(mode==='prior'){
   await page.route('**/src/ui/ui-icon-runtime.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:priorSource}));
   await page.route('**/ui-icon-runtime.css',route=>route.fulfill({status:200,contentType:'text/css',body:priorCss}));
 }
 return page;
}
async function openCampus(smoke,page){
 const fatal=smoke.watch(page);
 await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished===true,null,{timeout:120000}),fatal]);
}
async function dragAlbum(smoke,page,mobile,slot=2){
 const source=page.locator('.smartphone-app[data-app-id="album"] .smartphone-app-icon');
 await source.scrollIntoViewIfNeeded();
 const a=await source.boundingBox(),b=await page.locator(`.smartphone-app[data-area="dock"][data-slot="${slot}"]`).boundingBox();
 assert.ok(a&&b,'both icon and destination must be visible');
 const point={x:a.x+a.width/2,y:a.y+a.height/2,id:1,radiusX:2,radiusY:2,force:1};
 await page.evaluate(()=>{
   window.__iconDragEvents=[];
   if(window.__iconDragRecording)return;window.__iconDragRecording=true;
   for(const type of ['pointerdown','pointercancel','pointerup','dragstart','dragend'])document.addEventListener(type,event=>window.__iconDragEvents.push({type,target:event.target.tagName,className:event.target.className}),true);
 });
 if(mobile){
   const cdp=await smoke.context.newCDPSession(page);
   try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await new Promise(r=>setTimeout(r,650));
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:b.x+b.width/2,y:b.y+b.height/2}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }finally{await cdp.detach();}
 }else{await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});await page.mouse.up();}
 return {dock:(await state(page)).preferences.dock,events:await page.evaluate(()=>window.__iconDragEvents)};
}
async function verifyDrag(smoke,page,mobile,entry,mode){
 await page.getByRole('button',{name:'홈 화면 편집',exact:true}).click();
 if(mode!=='off')await page.waitForFunction(()=>!!document.querySelector('.smartphone-app[data-app-id="album"] .world-ui-icon[data-state="ready"]'));
 const before=(await state(page)).preferences;
 const result=await dragAlbum(smoke,page,mobile);entry.dragComparisons??=[];entry.dragComparisons.push({mode,...result});await save();
 if(mode==='prior'){
   assert.equal(result.dock[2],null,'prior native-image behavior must reproduce the failed Dock drop');
   assert.ok(result.events.some(e=>e.type==='dragstart'&&e.target==='IMG'),'regression requires a real native image dragstart');
   assert.ok(result.events.some(e=>e.type==='pointercancel'),'native drag must cancel the Phone pointer gesture');
   assert.deepEqual((await state(page)).preferences,before,'cancelled native drag must not mutate preferences');
   entry.checks.push('prior image defaults reproduce native IMG dragstart → pointercancel → unchanged Dock');return;
 }
 assert.equal(result.dock[2],'album',mode+' actual pointer drag reaches Dock 2');
 assert.equal(result.events.some(e=>e.type==='dragstart'||e.type==='pointercancel'),false,mode+' decorative content must not steal pointer gesture');
 if(mode==='fixed'){
   for(const slot of [3,2]){
     await page.waitForFunction(()=>!!document.querySelector('.smartphone-app[data-app-id="album"] .world-ui-icon[data-state="ready"]'));
     const repeated=await dragAlbum(smoke,page,mobile,slot);assert.equal(repeated.dock[slot],'album');
     assert.equal(repeated.dock.filter(id=>id==='album').length,1,'repeated drop must not duplicate Album');
     assert.equal(repeated.events.some(e=>e.type==='dragstart'||e.type==='pointercancel'),false);
   }
 }
 await page.getByRole('button',{name:'편집 완료',exact:true}).click();
 const persisted=(await state(page)).preferences;
 await page.reload({waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished===true,null,{timeout:120000});
 await page.locator('#phone-toggle').click();assert.deepEqual((await state(page)).preferences,persisted,mode+' Dock preferences survive reload');
 await page.screenshot({path:output+'/'+entry.name+'-'+mode+'-drag-reload.png',animations:'disabled'});
 entry.screenshots.push(entry.name+'-'+mode+'-drag-reload.png');
 entry.checks.push(mode+' real '+(mobile?'touch':'mouse')+' icon-center drag, unique Dock placement and reload persistence');
}

for(const [name,viewport,mobile] of variants){
 const entry={name,viewport,status:'RUNNING',checks:[],screenshots:[]};report.cases.push(entry);await save();
 let smoke;
 try{
   smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'reduce'}});
   for(const mode of (mobile?['off']:['off','prior'])){
     const control=await freshPage(smoke,mode);await openCampus(smoke,control);
     await control.locator('#phone-toggle').click();
     if(mode==='off')assert.equal(await control.locator('.world-ui-icon').count(),0);
     await verifyDrag(smoke,control,mobile,entry,mode);await control.close();
   }
   const page=await freshPage(smoke,'fixed');await openCampus(smoke,page);
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
   await verifyDrag(smoke,page,mobile,entry,'fixed');
   assert.deepEqual(smoke.problems,[]);
   entry.status='PASS';await save();
 }catch(error){entry.status='FAIL';entry.error=String(error.stack||error);report.status='FAIL';await save();throw error;}
 finally{if(smoke)await smoke.close();}
}
report.status='PASS';await save();console.log('UI_ICON_RUNTIME_BROWSER_PASS',head);
