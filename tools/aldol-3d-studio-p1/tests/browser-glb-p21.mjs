import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {geometryFixture,sha} from './glb-fixture.mjs';
import {readStudioAssetZip} from '../src/asset-archive.mjs';
const require=createRequire(new URL('../../../apps/world/tests/browser/package.json',import.meta.url));
const {chromium}=require('playwright');
const folder=resolve('tools/aldol-3d-studio-p1'),output=resolve('test-results/aldol-studio-p2-1');await mkdir(output,{recursive:true});
const report={environment:'Chromium / PlayCanvas 2.22.4 / WebGL2 SwiftShader; real editor classes; loopback only',physicalAndroid:'BLOCKED: no device/provider access',physicalIOS:'BLOCKED: no device/provider access',checks:[]};
const pass=(name,data={})=>{report.checks.push({name,state:'PASS',...data});console.log('PASS',name,JSON.stringify(data));};
const runners=[];
async function server(flags=[]){
 const runner=spawn(process.execPath,['bin/dev-server.mjs','--allow-write','--port','0','--editor-dir',resolve('apps/world/src/editor'),...flags],{cwd:folder,stdio:['ignore','pipe','pipe']});runners.push(runner);
 return new Promise((ok,no)=>{let log='';const timer=setTimeout(()=>no(Error(log)),10000);runner.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);ok(m[0]);}});runner.stderr.on('data',s=>log+=s);runner.on('exit',code=>{clearTimeout(timer);no(Error(code+':'+log));});});
}
const near=(a,b)=>b.forEach((n,i)=>assert.ok(Math.abs(a[i]-n)<1e-5,`${a} != ${b}`));
let browser;
try{
 const host=await server();browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1360,height:840}});const errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(host+'/'))remote.push(r.url());});
 page.on('console',m=>{if(m.type()==='error')console.log('BROWSER_ERROR',m.text());});
 await page.goto(host,{waitUntil:'networkidle'});
 const f=geometryFixture();report.sha256=f.digest;await writeFile(output+'/pyramids.glb',f.bytes);
 await page.locator('#factory-file').setInputFiles({name:f.file,mimeType:'model/gltf-binary',buffer:f.bytes});
 await page.locator('#factory-manifest').setInputFiles({name:'factory.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.manifest))});
 await page.locator('#factory-import').click();await page.locator('.factory-asset button').click();
 await page.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='ready',null,{timeout:30000});
 const evidence=()=>page.evaluate(()=>window.__ALDOL_MODEL_EVIDENCE__());
 let ev=await evidence();assert.equal(ev.assets[0].sha256,f.digest);assert.equal(ev.version,'2.22.4');assert.equal(ev.entities[0].meshes.length,2);assert.ok(ev.entities[0].meshes.every(m=>m.vertices===18&&m.indices===18));assert.equal(ev.assets[0].materials[0].texture,true);assert.deepEqual(ev.assets[0].textures,[{width:2,height:2}]);const child=ev.entities[0].glbNodes.find(n=>n.name==='Coral child');near(child.position,[4,0,-1]);near(child.scale,[.6,.6,.6]);near(child.rotation,[0,.3826834324,0,.9238795325]);assert.equal(ev.entities[0].glbNodes.find(n=>n.name==='Coral pyramid').parent,'Coral child');
 pass('file picker -> SHA verified bytes -> actual PlayCanvas indexed meshes, material and embedded texture',ev);
 const json=async path=>(await page.request.get(host+path)).json();
 async function command(operation,payload,targetId){const s=await json('/api/scene');const r=await page.request.post(host+'/api/command',{data:{commandId:crypto.randomUUID(),expectedRevision:s.revisionToken,operation,payload,...(targetId?{targetId}:{})}});const data=await r.json();assert.equal(data.status,'applied',JSON.stringify(data));await page.evaluate(()=>dispatchEvent(new Event('studio:external-change')));await page.waitForFunction(token=>document.querySelector('#revision').textContent===token.split(':').slice(0,2).join(' ').toUpperCase(),data.revisionToken);await page.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='ready');return data;}
 const id=(await json('/api/scene')).nodes[0].id;
 await page.screenshot({path:output+'/desktop.png'});
 const capture=()=>page.locator('#model-canvas').screenshot();
 const after=await capture();
 // Move the actual model offscreen through the document command, not a test-only engine hook.
 await command('node.transform',{transform:{position:[100,0,0],rotation:[0,0,0,1],scale:[1,1,1]}},id);const before=await capture();
 const changed=await page.evaluate(async([a,b])=>{
  async function pixels(s){const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}
  const x=await pixels(a),y=await pixels(b);let changed=0,colored=0;for(let i=0;i<x.length;i+=4){if(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2])changed++;if(y[i]>y[i+1]*1.4&&y[i]>y[i+2]*1.4)colored++;}return {changedPixels:changed,redMaterialPixels:colored};
 },[before.toString('base64'),after.toString('base64')]);
 assert.ok(changed.changedPixels>3000,JSON.stringify(changed));assert.ok(changed.redMaterialPixels>100,JSON.stringify(changed));
 await writeFile(output+'/geometry-before.png',before);await writeFile(output+'/geometry-after.png',after);pass('actual geometry and colored material produce pixels in the Studio viewport',changed);
 await page.locator('#undo').click();await page.waitForFunction(()=>window.__ALDOL_MODEL_EVIDENCE__()?.entities[0]?.position[0]===0);
 const t={position:[-1,.5,1],rotation:[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)],scale:[.8,1.2,.7]};await command('node.transform',{transform:t},id);ev=await evidence();near(ev.entities[0].position,t.position);near(ev.entities[0].rotation,t.rotation);near(ev.entities[0].scale,t.scale);
 await page.locator('#undo').click();await page.waitForFunction(()=>window.__ALDOL_MODEL_EVIDENCE__()?.entities[0]?.scale[1]===1);
 await page.locator('#redo').click();await page.waitForFunction(()=>Math.abs(window.__ALDOL_MODEL_EVIDENCE__()?.entities[0]?.scale[1]-1.2)<1e-5);
 const parent={id:'p21.parent',name:'P21 Parent',kind:'prop',transform:{position:[1,0,-1],rotation:[0,0,0,1],scale:[1,1,1]},components:{},enabled:true};await command('node.create',parent);await command('node.reparent',{parentId:parent.id},id);
 ev=await evidence();const model=ev.entities.find(e=>e.id===id);assert.equal(model.parent,parent.id);near(model.worldPosition,[0,.5,0]);
 const hidden={...parent,id:'p21.hidden',name:'P21 Disabled',enabled:false};await command('node.create',hidden);await command('node.create',{...parent,id:'p21.hidden-child',name:'Hidden model',parentId:hidden.id,components:{'core.renderable':{assetId:'factory.'+f.digest.slice(0,24)}}});
 ev=await evidence();assert.equal(ev.entities.find(e=>e.id==='p21.hidden-child').enabled,false);pass('transform, out-of-order parent, disabled inheritance, Undo/Redo preserve real mesh entities',ev);
 const packageResponse=await page.request.get(host+'/api/assets/package');assert.equal(packageResponse.status(),200);const zip=await packageResponse.body(),files=readStudioAssetZip(zip),world=await json('/api/export');assert.equal(sha(files.get(world.assets[0].uri)),f.digest);assert.deepEqual(JSON.parse(files.get('world.json')),world);assert.equal(world.assets[0].metadata.rightsQa,'UNKNOWN');assert.equal(world.assets[0].metadata.engineImportQa,'UNKNOWN');
 const packagePath=output+'/studio-assets.zip';await writeFile(packagePath,zip);await writeFile(output+'/world.json',JSON.stringify(world,null,2));
 const freshHost=await server(['--package',packagePath]);const context=await browser.newContext({viewport:{width:1360,height:840}}),fresh=await context.newPage();await fresh.goto(freshHost,{waitUntil:'networkidle'});await fresh.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='ready');const restored=await fresh.evaluate(()=>window.__ALDOL_MODEL_EVIDENCE__());const canonical=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));ev.entities.sort((a,b)=>a.id.localeCompare(b.id));restored.entities.sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(canonical(restored),canonical(ev));assert.deepEqual(await (await fresh.request.get(freshHost+'/api/export')).json(),world);await fresh.screenshot({path:output+'/fresh-session.png'});pass('ZIP reopens in new server + new browser context with identical world, hash, meshes, materials and transforms');await context.close();
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:740,height:360},{width:844,height:390}]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1}),mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(host,{waitUntil:'networkidle'});await mobile.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='ready');assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await mobile.locator(`.node-row[data-id="${id}"] .node`).tap();await mobile.waitForFunction(()=>!document.querySelector('#gizmo-overlay').hidden);
  const cdp=await context.newCDPSession(mobile),box=await mobile.locator('#canvas').boundingBox(),p=(x,y,id=1)=>({x:Math.round(x),y:Math.round(y),id});
  const before=await (await mobile.request.get(host+'/api/scene')).json();const cameraBefore=await mobile.locator('[data-gizmo-axis="x"]').getAttribute('style');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(box.x+box.width*.4,box.y+box.height*.65),p(box.x+box.width*.6,box.y+box.height*.65,2)]});
  for(const delta of [0,5,15])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(box.x+box.width*.4-delta,box.y+box.height*.65),p(box.x+box.width*.6+delta,box.y+box.height*.65,2)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(100);assert.deepEqual(await (await mobile.request.get(host+'/api/scene')).json(),before);assert.notEqual(await mobile.locator('[data-gizmo-axis="x"]').getAttribute('style'),cameraBefore);
  for(const mode of ['move','rotate','scale']){
   await mobile.locator(`[data-tool="${mode}"]`).tap();const handle=await mobile.locator('[data-gizmo-axis="x"]').boundingBox();assert.ok(handle);
   const initial=await (await mobile.request.get(host+'/api/scene')).json(),old=await mobile.locator('#revision').textContent();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p(handle.x+handle.width/2,handle.y+handle.height/2)]});
   for(let i=1;i<=4;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p(handle.x+handle.width/2+18*i/4,handle.y+handle.height/2-10*i/4)]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForFunction(old=>document.querySelector('#revision').textContent!==old,old);
   const updated=await (await mobile.request.get(host+'/api/scene')).json(),key={move:'position',rotate:'rotation',scale:'scale'}[mode];assert.notDeepEqual(updated.nodes.find(n=>n.id===id).transform[key],initial.nodes.find(n=>n.id===id).transform[key]);
   await mobile.locator('#undo').tap();await mobile.waitForFunction(before=>document.querySelector('#revision').textContent!==before,updated.revisionToken.split(':').slice(0,2).join(' ').toUpperCase());assert.deepEqual((await (await mobile.request.get(host+'/api/scene')).json()).nodes,initial.nodes);
  }
  await mobile.screenshot({path:output+`/mobile-${viewport.width}x${viewport.height}.png`});pass(`GLB mobile ${viewport.width}x${viewport.height}: layout, selection, pinch, move/rotate/scale gizmos + Undo, no accidental edit`);await context.close();
 }
 // Browser boundary independently rechecks server-provided bytes.
 for(const kind of ['tampered','missing']){
  const context=await browser.newContext(),negative=await context.newPage();negative.on('pageerror',e=>errors.push(e.message));
  await negative.route('**/api/assets/factory.*',route=>{const bytes=Buffer.from(f.bytes);bytes[bytes.length-1]^=1;return route.fulfill(kind==='missing'?{status:404,body:'missing'}:{status:200,contentType:'model/gltf-binary',body:bytes});});
  await negative.goto(host,{waitUntil:'networkidle'});await negative.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='limited');assert.match(await negative.locator('#model-status').textContent(),kind==='tampered'?/E_MODEL_SHA_MISMATCH/:/E_MODEL_BYTES_UNAVAILABLE/);assert.equal((await negative.evaluate(()=>window.__ALDOL_MODEL_EVIDENCE__())).assets.length,0);await context.close();
 }
 const broken=geometryFixture((d,b)=>b.fill(0,d.bufferViews[4].byteOffset+33));
 const badHost=await server(),badContext=await browser.newContext(),bad=await badContext.newPage();bad.on('pageerror',e=>errors.push(e.message));await bad.goto(badHost,{waitUntil:'networkidle'});
 await bad.locator('#factory-file').setInputFiles({name:broken.file,mimeType:'model/gltf-binary',buffer:broken.bytes});await bad.locator('#factory-manifest').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken.manifest))});await bad.locator('#factory-import').click();await bad.locator('.factory-asset button').click();await bad.waitForFunction(()=>document.querySelector('#model-status')?.dataset.state==='limited');assert.match(await bad.locator('#model-status').textContent(),/E_MODEL_DECODE/);assert.equal((await bad.evaluate(()=>window.__ALDOL_MODEL_EVIDENCE__())).assets.length,0);await badContext.close();
 pass('tampered bytes, missing bytes and broken embedded PNG decode fail visibly without model success');
 // Losing this WebGL device must not turn a proxy/fallback into a claimed GLB pass.
 await page.evaluate(()=>document.querySelector('#model-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());await page.waitForFunction(()=>document.querySelector('#model-status').dataset.state==='context-lost');assert.match(await page.locator('#model-status').textContent(),/E_GPU_CONTEXT_LOST/);pass('GPU context loss produces an explicit model diagnostic');
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);pass('no external HTTP asset requests or uncaught browser errors; rights and engine QA remain UNKNOWN');
}finally{if(browser)await browser.close();for(const r of runners)r.kill('SIGTERM');await writeFile(output+'/report.json',JSON.stringify(report,null,2));}
