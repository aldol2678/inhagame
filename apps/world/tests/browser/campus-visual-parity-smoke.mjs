// Offline actual-campus WebGL QA. No login, Production API or remote state writes.
// Run only in a browser-enabled executor: WORLD_SMOKE_DISABLE_WEBGPU=1
// WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-visual-parity-smoke.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { surroundingsBaselinePlan } from './campus-surroundings-walking.mjs';
const output=process.env.WORLD_VISUAL_PARITY_OUTPUT||'test-results/campus-visual-parity';
await mkdir(output,{recursive:true});
const actualHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_VISUAL_PARITY_HEAD)assert.equal(actualHead,process.env.EXPECTED_VISUAL_PARITY_HEAD);
const baseline=process.env.WORLD_SURROUNDINGS_BASE||null;
if(baseline)assert.match(baseline,/^[a-f0-9]{40}$/);
const baselinePlan=surroundingsBaselinePlan(baseline?execFileSync('git',['diff','--name-only',baseline,actualHead],{encoding:'utf8'}).trim().split('\n').filter(p=>p.startsWith('apps/world/src/')):[],{enabled:Boolean(baseline)});
const baselineSources=new Map((baselinePlan?.replace||[]).map(p=>['/'+p.slice('apps/world/'.length),execFileSync('git',['show',`${baseline}:${p}`])]));
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={head:actualHead,baselineCommit:baseline,baselineRuntimeSources:[...baselineSources].map(([path,bytes])=>({path,sha256:hash(bytes)})),scope:'offline actual campus; literal baseline/candidate same-camera comparison, separate on/off diagnostics and deterministic actual-controller walking; no measured architecture, speed or physical-device claim',cases:[],comparisons:[]};
async function capture(page,name,compare=false){
 const receipt=await page.evaluate(({compare,timeoutMs})=>new Promise((resolve,reject)=>{
  const app=window.__INHAGAME_P0__.app;
  const timeout=setTimeout(()=>{app.off('postrender',onFrame);reject(new Error('Timed out waiting for a rendered frame'));},timeoutMs);
  const onFrame=()=>{
   try{
   const gl=app.graphicsDevice.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
   try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.finish();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);}
   const previous=window.__parityPixels;let changed=0;for(let i=0;compare&&previous&&i<pixels.length;i+=4)if(Math.abs(pixels[i]-previous[i])+Math.abs(pixels[i+1]-previous[i+1])+Math.abs(pixels[i+2]-previous[i+2])>12)changed++;
   window.__parityPixels=pixels;resolve({width:w,height:h,changed,glError:gl.getError()});
   }catch(error){reject(error);}finally{clearTimeout(timeout);}
  };app.once('postrender',onFrame);app.renderNextFrame=true;
 }),{compare,timeoutMs:TIMEOUT_MS});
 assert.equal(receipt.glError,0,`${name}: GL error`);
 await page.locator('#application').screenshot({path:`${output}/${name}.png`,animations:'disabled',timeout:TIMEOUT_MS});return receipt;
}
async function freezePage(page,origin,fatal){
 await page.goto(`${origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
 assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer),'WebGL2');
 await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
 await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.app.off('update');d.app.autoRender=false;});
}
async function literalComparison(candidate,smoke,name){
 const old=await smoke.context.newPage(),fatal=smoke.watch(old),served=new Set();
 await old.route('**/*',route=>{const url=new URL(route.request().url()),bytes=url.origin===smoke.origin?baselineSources.get(url.pathname):null;
   if(bytes){served.add(url.pathname);return route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:bytes});}return route.fallback();});
 try{
  await freezePage(old,smoke.origin,fatal);
  const views=await candidate.evaluate(async()=>{
   const {POND_RING,pondSeatTrees,pondBankTrees}=await import('/src/roadview-layout.js'),{MAIN_HALL_WALKWAYS}=await import('/src/main-hall-walkway-layout.js');
   const center=POND_RING.reduce((a,p)=>({x:a.x+p.x/POND_RING.length,z:a.z+p.z/POND_RING.length}),{x:0,z:0});
   return [{id:'pond-overview',p:center,y:2,radius:28},{id:'pond-seat',p:pondSeatTrees()[1].center,y:.6,radius:2.6},
    {id:'pond-willow',p:pondBankTrees().find(p=>p.heroWillow),y:3.5,radius:6},
    ...MAIN_HALL_WALKWAYS.map(q=>({id:q.id,p:q.frame.at(q.frame.length/2),y:.1,radius:5.5}))];
  });
  for(const view of views){
   let reference=null;
   for(const [mode,page] of [['baseline',old],['candidate',candidate]]){
    const setup=await page.evaluate(async({view,reference})=>{
     const pc=await import('playcanvas'),{viewDistancePreset}=await import('/src/view-distance.js');
     const d=window.__INHAGAME_P0__,base=d.app.root.findByName('CampusBase'),camera=d.app.root.findByName('Camera');
     base.parent.setLocalScale(1,1,-1);d.streaming.setPolicy(viewDistancePreset('MAX'));
     for(let i=0;i<d.registry.chunks.length+20;i++)d.streaming.update(.05,view.p);
     // Static-environment comparison: independently booted ambient actors have
     // random spawn/animation state. Hide the same explicit classes on both sides.
     const actors=d.app.root.find(e=>e.name==='Player'||e.name?.startsWith('inkyung_duck_')||e.name?.startsWith('NPC_TEST_HUMAN_')||['Parked_CampusShuttle','Rider_CampusShuttle'].includes(e.name));
     for(const actor of actors)actor.enabled=false;
     const water=d.app.root.findByName('lmk_inkyung_pond');for(const m of water?.render?.meshInstances||[]){m.material.normalMapOffset.set(0,0);m.material.update();}
     const aspect=d.app.graphicsDevice.width/d.app.graphicsDevice.height,vertical=camera.camera.fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect),distance=view.radius/Math.sin(Math.min(vertical,horizontal))*1.15;
     const target=new pc.Vec3(view.p.x,view.y,-view.p.z),direction=new pc.Vec3(.7,.8,1).normalize();
     if(reference){camera.setPosition(...reference.position);camera.setRotation(new pc.Quat(...reference.rotation));camera.camera.fov=reference.fov;}
     else{camera.setPosition(target.clone().add(direction.mulScalar(distance)));camera.lookAt(target);}
     camera.camera.nearClip=2;camera.camera.farClip=1000;d.app.root.syncHierarchy();
     return {position:camera.getPosition().toArray(),rotation:[camera.getRotation().x,camera.getRotation().y,camera.getRotation().z,camera.getRotation().w],fov:camera.camera.fov,nearClip:2,farClip:1000,
      hiddenAmbientActors:actors.map(e=>e.name).sort(),pondMeshes:base.children.filter(e=>e.name.startsWith('pond_surroundings_base_')).length,walkMeshes:base.children.filter(e=>e.name.startsWith('main_hall_walkways_')).length};
    },{view,reference});
    if(!reference)reference=setup;else{
     for(const key of ['position','rotation'])assert.ok(setup[key].every((v,i)=>Math.abs(v-reference[key][i])<1e-7),`${view.id}: ${key} differs`);
     for(const key of ['fov','nearClip','farClip'])assert.equal(setup[key],reference[key],`${view.id}: ${key} differs`);
    }
    assert.equal(setup.pondMeshes,mode==='baseline'?0:5);assert.equal(setup.walkMeshes,mode==='baseline'?0:1);
    const label=`${name}-${view.id}-${mode}`,frame=await capture(page,label),stable=await capture(page,label+'-stable',true);
    assert.equal(stable.changed,0,`${label}: stationary pixels must be stable`);
    report.comparisons.push({viewport:name,view:view.id,mode,commit:mode==='baseline'?baseline:actualHead,setup,frame,stable,file:label+'.png',sha256:hash(await readFile(`${output}/${label}.png`))});
   }
  }
  assert.deepEqual([...served].sort(),[...baselineSources.keys()].sort(),'every changed existing runtime must come from immutable baseline bytes');
 }finally{await old.close();}
}
try{
 for(const [name,viewport] of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const smoke=await startSmoke({viewport,contextOptions:{deviceScaleFactor:1,isMobile:name!=='desktop',hasTouch:name!=='desktop'}});
  try{
   const page=await smoke.context.newPage(),fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
   assert.equal((await page.evaluate(()=>window.__INHAGAME_P0__.getStatus())).renderer,'WebGL2');
   await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
   await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
   await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.app.off('update');d.app.autoRender=false;});
   const walking=await page.evaluate(async()=>{const {runWalking}=await import('/tests/browser/campus-visual-parity-walking.mjs');return runWalking(window.__INHAGAME_P0__);});
   report.walking??=[];report.walking.push({name,...walking});
   assert.equal(walking.cases.length,55,`${name}: incomplete actual-controller route coverage`);
   assert.equal(walking.passed,true,`${name}: controller route failure: ${JSON.stringify(walking.cases.filter(c=>!c.passed))}`);
   const surroundingsWalking=await page.evaluate(async()=>{const {runSurroundingsWalking}=await import('/tests/browser/campus-surroundings-walking.mjs');return runSurroundingsWalking(window.__INHAGAME_P0__);});
   assert.equal(surroundingsWalking.cases.length,38);assert.equal(surroundingsWalking.passed,true,JSON.stringify(surroundingsWalking.cases.filter(c=>!c.passed)));
   report.surroundingsWalking??=[];report.surroundingsWalking.push({name,...surroundingsWalking});
   for(const [area,prefix] of [['alley','back_alley_base_'],['garden','library_garden_base_'],['stadium','stadium_stands_'],['pond','pond_surroundings_base_'],['main-hall-walkways','main_hall_walkways_']])for(const sign of [-1,1]){
    const setup=await page.evaluate(async({prefix,sign})=>{
     const pc=await import('playcanvas');
     const app=window.__INHAGAME_P0__.app,base=app.root.findByName('CampusBase'),camera=app.root.findByName('Camera'),targets=base.children.filter(e=>e.name.startsWith(prefix));
     if(!targets.length)throw Error(`${prefix}: target not active in actual campus`);
     base.parent.setLocalScale(1,1,sign);base.parent.syncHierarchy();
     const bounds=new pc.BoundingBox();let first=true;
     for(const e of targets)for(const mi of e.render.meshInstances){if(first){bounds.copy(mi.aabb);first=false;}else bounds.add(mi.aabb);}
     const center=bounds.center.clone(),radius=bounds.halfExtents.length(),aspect=app.graphicsDevice.width/app.graphicsDevice.height;
     const vertical=camera.camera.fov*Math.PI/180/2,horizontal=Math.atan(Math.tan(vertical)*aspect),distance=radius/Math.sin(Math.min(vertical,horizontal))*1.15;
     const dir=new pc.Vec3(.7,.65,-sign).normalize();camera.setPosition(center.clone().add(dir.mulScalar(distance)));camera.lookAt(center);
     camera.camera.farClip=Math.max(1000,distance+radius*3);camera.camera.nearClip=2;
     window.__parityTargets=targets;targets.forEach(e=>{e.enabled=false;});
     return {entities:targets.length,reflection:sign,center:center.toArray(),radius,cameraDistance:distance};
    },{prefix,sign});
    const label=`${name}-${area}-${sign<0?'production':'unreflected-control'}`;
    const before=await capture(page,`${label}-before`);await page.evaluate(()=>window.__parityTargets.forEach(e=>{e.enabled=true;}));
    const after=await capture(page,`${label}-after`,true),stable=await capture(page,`${label}-stable`,true);
    assert.ok(after.changed>after.width*after.height*.0001,`${label}: restored target has no visible pixels`);assert.equal(stable.changed,0,`${label}: stationary target is unstable`);
    report.cases.push({name,area,...setup,before,after,stable});
   }
   // Close diagnostic views make individual stair treads and ramp surfaces
   // inspectable; the full-area captures above prove scene placement/coverage.
   for(const detail of ['garden-stairs','garden-stairs-lower','garden-ramp','stadium-aisle','stadium-aisle-lower','stadium-side-entry','alley-shell','pond-seat','pond-willow','hall-west-walkway','hall-east-walkway']){
    const setup=await page.evaluate(async detail=>{
     const pc=await import('playcanvas'),{GARDEN_ENTRANCES,gardenEntryHeight}=await import('/src/library-garden-layout.js'),{STANDS,SPORTS_SIDE_ENTRIES,stadiumGroundHeight}=await import('/src/stadium-stands-layout.js'),{BACK_ALLEY_BLOCKS}=await import('/src/back-alley-layout.js');
     const {pondSeatTrees,pondBankTrees}=await import('/src/roadview-layout.js'),{MAIN_HALL_WALKWAYS}=await import('/src/main-hall-walkway-layout.js');
     const app=window.__INHAGAME_P0__.app,base=app.root.findByName('CampusBase'),camera=app.root.findByName('Camera');base.parent.setLocalScale(1,1,-1);
     let frame,u,v,y,radius,prefix,from;
     if(detail.startsWith('garden')){const q=GARDEN_ENTRANCES.find(q=>detail==='garden-ramp'?q.steps===0:q.steps>0);frame=q.frame;u=q.u;v=q.run/2;y=gardenEntryHeight(q,v);radius=q.steps?2.8:4.3;prefix='library_garden_base_';from=frame.at(u+4,detail.endsWith('-lower')?q.run+6:-6);}
     else if(detail.startsWith('stadium-aisle')){frame=STANDS.frame;u=STANDS.aisles[1];v=STANDS.run/2;const p=frame.at(u,v);y=stadiumGroundHeight(p.x,p.z);radius=3.5;prefix='stadium_stands_';from=frame.at(u+5,detail.endsWith('-lower')?-7:STANDS.run+7);}
     else if(detail==='stadium-side-entry'){const q=SPORTS_SIDE_ENTRIES[0];frame=q.frame;u=q.u;v=-q.run/2;const p=frame.at(u,v);y=stadiumGroundHeight(p.x,p.z);radius=2.5;prefix='stadium_stands_';from=frame.at(u+4,6);}
     else if(detail.startsWith('pond')){const p=detail==='pond-seat'?pondSeatTrees()[1].center:pondBankTrees().find(p=>p.heroWillow);frame={at:(u,v)=>({x:p.x+u,z:p.z+v})};u=0;v=0;y=detail==='pond-seat'?.5:3.5;radius=detail==='pond-seat'?2.3:5;prefix='pond_surroundings_base_';from=frame.at(6,-6);}
     else if(detail.startsWith('hall')){const q=MAIN_HALL_WALKWAYS[detail.includes('west')?0:1];frame=q.frame;u=frame.length/2;v=0;y=0;radius=4.7;prefix='main_hall_walkways_';from=frame.at(u-4,6);}
     else{const q=BACK_ALLEY_BLOCKS[0];frame=q.frame;u=0;v=q.d/2;y=q.h/2;radius=5;prefix='back_alley_base_';from=frame.at(-3,-8);}
     const p=frame.at(u,v),center=new pc.Vec3(p.x,y,-p.z),direction=new pc.Vec3(from.x-p.x,detail.endsWith('-lower')?2:5, -(from.z-p.z)).normalize(),aspect=app.graphicsDevice.width/app.graphicsDevice.height;
     const vertical=camera.camera.fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect),distance=radius/Math.sin(Math.min(vertical,horizontal))*1.1;
     camera.setPosition(center.clone().add(direction.mulScalar(distance)));camera.lookAt(center);
     const targets=base.children.filter(e=>e.name.startsWith(prefix));if(!targets.length)throw Error(`${detail}: missing target`);
     window.__parityTargets=targets;targets.forEach(e=>{e.enabled=false;});return {detail,prefix,center:center.toArray(),distance,radius};
    },detail);
    const label=`${name}-${detail}-close`,before=await capture(page,`${label}-before`);await page.evaluate(()=>window.__parityTargets.forEach(e=>{e.enabled=true;}));const after=await capture(page,`${label}-after`,true);
    assert.ok(after.changed>30,`${label}: restored close-up has no visible contribution`);report.details??=[];report.details.push({name,...setup,before,after});
   }
   const lifecycle=await page.evaluate(async()=>{
    const pc=await import('playcanvas'),{CampusChunkRenderer}=await import('/src/campus-chunk-renderer.js'),{RenderChunkRegistry}=await import('/src/render-chunk-registry.js'),{LIBRARY_GREENS}=await import('/src/library-garden-layout.js');
    const app=window.__INHAGAME_P0__.app,receipts=[];
    for(let cycle=0;cycle<3;cycle++){
     const parent=new pc.Entity('VisualParityLifecycle');parent.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(parent);
     const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,parent,registry),targets=renderer.base.children.filter(e=>/^(back_alley_base_|library_garden_base_|stadium_stands_)/.test(e.name));
     // Validate each owner independently: alley restoration now has ten
     // material batches; unchanged garden/stadium owners keep five and three.
     const expectedOwnerMeshes={'back_alley_base_':10,'library_garden_base_':5,'stadium_stands_':3};
     for(const [prefix,expected]of Object.entries(expectedOwnerMeshes)){
      const owned=targets.filter(e=>e.name.startsWith(prefix));
      if(owned.length!==expected)throw Error(`${prefix}: expected ${expected} persistent meshes, got ${owned.length}`);
      for(const e of owned)for(const mi of e.render.meshInstances){
       const positions=[];mi.mesh.getPositions(positions);
       if(!positions.length||!positions.every(Number.isFinite)||mi.material.opacity!==1||!mi.material.depthWrite)throw Error(`${prefix}: invalid opaque persistent geometry`);
      }
     }
     const chunk=registry.chunks.find(c=>c.streetscape.includes(LIBRARY_GREENS[0].id)),handle=renderer.create(chunk);
     renderer.setState(handle,'ACTIVE');renderer.update(1);const detail=handle.detail;
     renderer.setState(handle,'FAR');renderer.update(1);if(detail.enabled||targets.some(e=>!e.enabled))throw Error('LOD made solid geometry invisible');
     renderer.setState(handle,'ACTIVE');renderer.update(1);if(handle.detail!==detail||!detail.enabled)throw Error('LOD rebuilt or lost its layer');
     const meshes=targets.flatMap(e=>e.render.meshInstances.map(mi=>mi.mesh));renderer.destroy(handle);if(renderer.fades.size)throw Error('Leaked fade owners');parent.destroy();
     if(meshes.some(mesh=>mesh.vertexBuffer!==null))throw Error('Leaked custom target vertex buffers');receipts.push({cycle,baseMeshes:targets.length,cleanup:true});
    }return receipts;
   });
   report.lifecycle??=[];report.lifecycle.push({name,cycles:lifecycle});
   if(baseline)await literalComparison(page,smoke,name);
   assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){report.error=String(error?.stack||error);await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');throw error;}
