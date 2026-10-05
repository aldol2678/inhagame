// Read-only hosted/offline actual-campus comparison. Local null QA is not pixels.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {forestBaselinePlan,forestViews,forestCamera} from './heidegger-forest-qa.mjs';
const out=process.env.WORLD_FOREST_OUTPUT||'test-results/campus-visual-parity/forest';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),base=process.env.WORLD_FOREST_BASE;
assert.match(base||'',/^[a-f0-9]{40}$/,'immutable baseline required');
if(process.env.EXPECTED_FOREST_HEAD)assert.equal(head,process.env.EXPECTED_FOREST_HEAD);
const changed=execFileSync('git',['diff','--name-only',base,head],{encoding:'utf8'}).trim().split('\n').filter(p=>p.startsWith('apps/world/src/'));
const plan=forestBaselinePlan(changed),hash=b=>createHash('sha256').update(b).digest('hex');
const sources=new Map(plan.replace.map(p=>['/'+p.slice('apps/world/'.length),execFileSync('git',['show',`${base}:${p}`])]));
const report={head,base,scope:'Actual offline campus; photo-informed estimates, no survey accuracy or physical-device performance claim',sources:[...sources].map(([path,b])=>({path,sha256:hash(b)})),views:[]};
await mkdir(out,{recursive:true});
async function frame(page,compare=false,original=false){return page.evaluate(async({compare,original,timeout})=>{
 const {forestPixelDelta}=await import('/tests/browser/heidegger-forest-qa.mjs');return new Promise((resolve,reject)=>{
 const app=window.__INHAGAME_P0__.app,t=setTimeout(()=>{app.off('postrender',onFrame);reject(Error('render timeout'));},timeout);
 function onFrame(){try{
  const gl=app.graphicsDevice.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4),binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.finish();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}
  if(!compare)window.__forestOriginalPixels=p;
  const previous=original?window.__forestOriginalPixels:window.__forestPixels,changed=compare?forestPixelDelta(p,previous):0;
  window.__forestPixels=p;resolve({width:w,height:h,changed,glError:gl.getError()});
 }catch(e){reject(e);}finally{clearTimeout(t);}}
 app.once('postrender',onFrame);app.renderNextFrame=true;
});},{compare,original,timeout:TIMEOUT_MS});}
async function boot(page,smoke){
 const fatal=smoke.watch(page);
 await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
 assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer),'WebGL2');
 await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
 await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.app.off('update');d.app.autoRender=false;});
}
try{
 for(const [name,viewport] of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const smoke=await startSmoke({viewport,contextOptions:{deviceScaleFactor:1,isMobile:name!=='desktop',hasTouch:name!=='desktop'}});
  try{
   const pages={baseline:await smoke.context.newPage(),candidate:await smoke.context.newPage()},served=new Set();
   await pages.baseline.route('**/*',route=>{
    const u=new URL(route.request().url()),bytes=u.origin===smoke.origin?sources.get(u.pathname):null;
    if(bytes){served.add(u.pathname);return route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:bytes});}
    return route.fallback();
   });
   for(const page of Object.values(pages))await boot(page,smoke);
   for(const sourceView of forestViews()){
    const view=forestCamera(sourceView,viewport.width/viewport.height);
    let expectedCamera=null,expectedAuthority=null;
    for(const [mode,page] of Object.entries(pages)){
     const setup=await page.evaluate(async({view,mode})=>{
      const pc=await import('playcanvas'),{viewDistancePreset}=await import('/src/view-distance.js'),{OBSTACLES}=await import('/src/campus-layout.js'),{SEAT_ANCHORS}=await import('/src/seat-anchors.js');
      const {CAMPUS_ROADS}=await import('/src/campus-road-layout.js'),{SITE_FEATURES}=await import('/src/basic-campus.js'),{campusNavGraphData}=await import('/src/navigation/campus-navigation.js');
      const d=window.__INHAGAME_P0__,base=d.app.root.findByName('CampusBase'),camera=d.app.root.findByName('Camera');base.parent.setLocalScale(1,1,-1);
      const chunk=d.registry.chunks.find(c=>c.facilities.includes('lmk_heidegger_forest'));
      const p=view.id==='far-silhouette'?{x:chunk.bounds.maxX+90,z:(chunk.bounds.minZ+chunk.bounds.maxZ)/2}:{x:view.target[0],z:view.target[2]};d.streaming.setPolicy(viewDistancePreset(view.id==='far-silhouette'?'SHORT':'MAX'));
      for(let i=0;i<d.registry.chunks.length+20;i++)d.streaming.update(.05,p);
      const chunkState=d.streaming.snapshot()[chunk.id];if(chunkState!==(view.id==='far-silhouette'?'VISTA':'ACTIVE'))throw Error('forest streaming transition mismatch: '+chunkState);
      for(const actor of d.app.root.find(e=>e.name==='Player'||e.name?.startsWith('inkyung_duck_')||e.name?.startsWith('NPC_TEST_HUMAN_')||['Parked_CampusShuttle','Rider_CampusShuttle'].includes(e.name)))actor.enabled=false;
      camera.camera.fov=56;camera.camera.nearClip=.5;camera.camera.farClip=600;
      camera.setPosition(view.from[0],view.from[1],-view.from[2]);camera.lookAt(view.target[0],view.target[1],-view.target[2]);d.app.root.syncHierarchy();
      const owners=base.children.filter(e=>e.name==='lmk_heidegger_forest');if(owners.length!==1)throw Error('forest owner count');
      const forest=owners[0],meshes=forest.findComponents('render').flatMap(c=>c.meshInstances);if(meshes.length!==(mode==='baseline'?3:4))throw Error('baseline/candidate geometry mismatch');
      window.__forestOwner=forest;
      return {chunkState,streamPosition:p,position:camera.getPosition().toArray(),rotation:[camera.getRotation().x,camera.getRotation().y,camera.getRotation().z,camera.getRotation().w],meshes:meshes.length,
       authority:JSON.stringify({OBSTACLES,SEAT_ANCHORS,roads:CAMPUS_ROADS.map(({id,vertices,width,shoulder})=>({id,vertices,width,shoulder})),SITE_FEATURES,graph:campusNavGraphData()})};
     },{view,mode});
     const authority=hash(setup.authority);delete setup.authority;
     if(expectedCamera){assert.deepEqual(setup.position,expectedCamera.position);assert.deepEqual(setup.rotation,expectedCamera.rotation);assert.equal(authority,expectedAuthority,'unchanged navigation, obstacles, roads, boundaries and seats');}
     else{expectedCamera=setup;expectedAuthority=authority;}
     const a=await frame(page),stable=await frame(page,true);assert.equal(a.glError,0);assert.equal(stable.glError,0);assert.equal(stable.changed,0,'stationary forest pixels');
     const label=`${name}-${view.id}-${mode}`;
     await page.locator('#application').screenshot({path:`${out}/${label}.png`,animations:'disabled',timeout:TIMEOUT_MS});
     await page.evaluate(()=>{window.__forestOwner.enabled=false;});const hidden=await frame(page,true);
     assert.equal(hidden.glError,0);assert.ok(hidden.changed>30,`${label}: grove is occluded or blank`);
     await page.evaluate(()=>{window.__forestOwner.enabled=true;});const restored=await frame(page,true,true);assert.equal(restored.glError,0);assert.equal(restored.changed,0,'restored pixels must match the original visible image');
     report.views.push({viewport:name,view:view.id,mode,commit:mode==='baseline'?base:head,setup,authoritySha256:authority,frame:a,stable,restored,visibleTargetPixels:hidden.changed,file:label+'.png',sha256:hash(await readFile(`${out}/${label}.png`))});
    }
   }
   assert.deepEqual([...served].sort(),[...sources.keys()].sort(),'literal baseline bytes must be served');assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
 report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
