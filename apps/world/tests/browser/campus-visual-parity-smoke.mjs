// Offline actual-campus WebGL QA. No login, Production API or remote state writes.
// Run only in a browser-enabled executor: WORLD_SMOKE_DISABLE_WEBGPU=1
// WORLD_SMOKE_BROWSER=chrome node apps/world/tests/browser/campus-visual-parity-smoke.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output=process.env.WORLD_VISUAL_PARITY_OUTPUT||'test-results/campus-visual-parity';
await mkdir(output,{recursive:true});
const actualHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_VISUAL_PARITY_HEAD)assert.equal(actualHead,process.env.EXPECTED_VISUAL_PARITY_HEAD);
const report={head:actualHead,scope:'offline current campus, on/off rendering plus deterministic actual-controller walking; no measured architectural fidelity, speed or physical-device claim',cases:[]};
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
   for(const [area,prefix] of [['alley','back_alley_base_'],['garden','library_garden_base_'],['stadium','stadium_stands_']])for(const sign of [-1,1]){
    const setup=await page.evaluate(async({prefix,sign})=>{
     const pc=await import('playcanvas');
     const app=window.__INHAGAME_P0__.app,base=app.root.findByName('CampusBase'),camera=app.root.findByName('Camera'),targets=base.children.filter(e=>e.name.startsWith(prefix));
     if(!targets.length)throw Error(`${prefix}: target not active in actual campus`);
     base.parent.setLocalScale(1,1,sign);base.parent.syncHierarchy();
     const bounds=new pc.BoundingBox();let first=true;
     for(const e of targets)for(const mi of e.render.meshInstances){if(first){bounds.copy(mi.aabb);first=false;}else bounds.add(mi.aabb);}
     const center=bounds.center.clone(),radius=bounds.halfExtents.length(),aspect=app.graphicsDevice.width/app.graphicsDevice.height;
     const vertical=camera.camera.fov*Math.PI/180/2,horizontal=Math.atan(Math.tan(vertical)*aspect),distance=radius/Math.sin(Math.min(vertical,horizontal))*1.15;
     const dir=new pc.Vec3(.7,.65,1).normalize();camera.setPosition(center.clone().add(dir.mulScalar(distance)));camera.lookAt(center);
     camera.camera.farClip=Math.max(1000,distance+radius*3);camera.camera.nearClip=.1;
     window.__parityTargets=targets;targets.forEach(e=>{e.enabled=false;});
     return {entities:targets.length,reflection:sign,center:center.toArray(),radius,cameraDistance:distance};
    },{prefix,sign});
    const label=`${name}-${area}-${sign<0?'production':'unreflected-control'}`;
    const before=await capture(page,`${label}-before`);await page.evaluate(()=>window.__parityTargets.forEach(e=>{e.enabled=true;}));
    const after=await capture(page,`${label}-after`,true),stable=await capture(page,`${label}-stable`,true);
    assert.ok(after.changed>after.width*after.height*.0001,`${label}: restored target has no visible pixels`);assert.equal(stable.changed,0,`${label}: stationary target is unstable`);
    report.cases.push({name,area,...setup,before,after,stable});
   }
   const lifecycle=await page.evaluate(async()=>{
    const pc=await import('playcanvas'),{CampusChunkRenderer}=await import('/src/campus-chunk-renderer.js'),{RenderChunkRegistry}=await import('/src/render-chunk-registry.js'),{LIBRARY_GREENS}=await import('/src/library-garden-layout.js');
    const app=window.__INHAGAME_P0__.app,receipts=[];
    for(let cycle=0;cycle<3;cycle++){
     const parent=new pc.Entity('VisualParityLifecycle');parent.setLocalScale(1,1,cycle%2?-1:1);app.root.addChild(parent);
     const registry=new RenderChunkRegistry(),renderer=new CampusChunkRenderer(app,parent,registry),targets=renderer.base.children.filter(e=>/^(back_alley_base_|library_garden_base_|stadium_stands_)/.test(e.name));
     if(targets.length!==10)throw Error('Missing persistent parity meshes');
     const chunk=registry.chunks.find(c=>c.streetscape.includes(LIBRARY_GREENS[0].id)),handle=renderer.create(chunk);
     renderer.setState(handle,'ACTIVE');renderer.update(1);const detail=handle.detail;
     renderer.setState(handle,'FAR');renderer.update(1);if(detail.enabled||targets.some(e=>!e.enabled))throw Error('LOD made solid geometry invisible');
     renderer.setState(handle,'ACTIVE');renderer.update(1);if(handle.detail!==detail||!detail.enabled)throw Error('LOD rebuilt or lost its layer');
     const meshes=targets.flatMap(e=>e.render.meshInstances.map(mi=>mi.mesh));renderer.destroy(handle);if(renderer.fades.size)throw Error('Leaked fade owners');parent.destroy();
     if(meshes.some(mesh=>mesh.vertexBuffer!==null))throw Error('Leaked custom target vertex buffers');receipts.push({cycle,baseMeshes:targets.length,cleanup:true});
    }return receipts;
   });
   report.lifecycle??=[];report.lifecycle.push({name,cycles:lifecycle});
   assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){report.error=String(error?.stack||error);await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');throw error;}
