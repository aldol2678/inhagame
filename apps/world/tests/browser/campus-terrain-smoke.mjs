// Real Chromium/WebGL2 frames from the local app only. The shared harness serves
// pinned PlayCanvas, disables Supabase, stubs /api/* and blocks every off-origin request.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output=process.env.WORLD_TERRAIN_QA_OUTPUT||'test-results/campus-terrain';
await mkdir(output,{recursive:true});
const report={result:'RUNNING',cases:[],scope:'offline local app; diagnostic blue background for terrain coverage only; production sky is not validated; no Production/backend access'};
const watchdog=setTimeout(()=>{
  report.result='FAIL';report.error='Terrain diagnostic exceeded the 240000ms overall deadline';
  writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));process.exit(1);
},240000);

// QA-only background contract: this fixture moves the camera after freezing app
// updates and cannot assume the production sky color. The terrain mask requires
// blue pixels; isolate a controlled background instead of weakening that mask.
function configureTerrainDiagnosticBackground(){
  const app=window.__INHAGAME_P0__.app;
  const skyVisuals=app.root.findByName('EnvironmentSkyVisuals'),camera=app.root.findByName('Camera');
  if(!skyVisuals||!camera?.camera)throw Error('Terrain diagnostic background fixture missing sky or camera');
  const skyVisualsWasEnabled=skyVisuals.enabled;
  skyVisuals.enabled=false;
  camera.camera.clearColor.set(.52,.71,.84,1);
  return {mode:'isolated-blue-background',productionSkyValidated:false,skyVisualsWasEnabled,skyVisualsEnabled:skyVisuals.enabled,clearColor:[.52,.71,.84,1]};
}

async function frame(page,label,{compare=false,sample=null}={}){
  const pixels=await page.evaluate(({compare,sample})=>new Promise(resolve=>{
    const d=window.__INHAGAME_P0__,app=d.app;
    app.autoRender=false;
    app.once('postrender',()=>{
      const gl=app.graphicsDevice.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
      gl.finish();
      const data=new Uint8Array(w*h*4),previousRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      // PlayCanvas may leave its multisampled backbuffer bound after resolve.
      // Read the resolved canvas only; preserve DRAW binding and engine state.
      try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);}
      finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previousRead);}
      const previous=window.__terrainPreviousPixels;let changedSky=0,changed=0,blue=0;
      for(let i=0;i<data.length;i+=4){
        if(data[i+2]>data[i]+12&&data[i+2]>=data[i+1]-8)blue++;
        if(compare&&previous){
          if(Math.abs(data[i]-previous[i])+Math.abs(data[i+1]-previous[i+1])+Math.abs(data[i+2]-previous[i+2])>15)changed++;
          if(previous[i+2]>previous[i]+12&&previous[i+2]>=previous[i+1]-8&&data[i]>data[i+2]+6&&data[i+1]>data[i+2]+6)changedSky++;
        }
      }
      const sampled=[];let samplePixel=null;
      if(sample){
        const camera=d.app.root.findByName('Camera');
        const screen=camera.camera.worldToScreen({x:sample.x,y:sample.y,z:-sample.z});
        const rect=app.graphicsDevice.canvas.getBoundingClientRect();
        const x=Math.round(screen.x*w/rect.width),y=h-1-Math.round(screen.y*h/rect.height);
        samplePixel={x,y};
        if(x>=1&&x<w-1&&y>=1&&y<h-1)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const index=((y+dy)*w+x+dx)*4;sampled.push(...data.slice(index,index+3));
        }
      }
      window.__terrainPreviousPixels=data;
      resolve({width:w,height:h,blue,changed,changedSky,sampled,samplePixel,readbackFramebuffer:'resolved-default',previousReadFramebuffer:previousRead?'custom':'default',antialias:gl.getContextAttributes().antialias,glError:gl.getError()});
    });app.renderNextFrame=true;
  }),{compare,sample});
  assert.equal(pixels.glError,0,`${label}: WebGL readback failed`);
  if(sample)assert.equal(pixels.sampled.length,27,`${label}: projected 3x3 water sample is outside the framebuffer`);
  await page.locator('#application').screenshot({path:`${output}/${label}.png`,timeout:TIMEOUT_MS,animations:'disabled'});
  return pixels;
}

try{
  for(const [name,viewport,mobile] of [
    ['portrait',{width:390,height:844},true],
    ['landscape',{width:844,height:390},true],
    ['desktop',{width:1280,height:720},false]
  ]){
    const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
    const entry={name,viewport};report.cases.push(entry);
    try{
      const page=await smoke.context.newPage(),fatal=smoke.watch(page);
      await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
      await Promise.race([page.waitForFunction(()=>{
        const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;
      },null,{timeout:TIMEOUT_MS}),fatal]);
      const status=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus());
      assert.equal(status.renderer,'WebGL2');assert.equal(status.loading.phase,'READY');entry.renderer=status.renderer;
      await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
      // Isolated-background evidence fixture. UI is hidden in these canvas images
      // so the original ground gaps remain visible at all three aspect ratios.
      await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
      entry.terrain=await page.evaluate(async()=>{
        const d=window.__INHAGAME_P0__,{viewDistancePreset}=await import('/src/view-distance.js');
        d.streaming.setPolicy(viewDistancePreset('MAX'));
        for(let i=0;i<=d.registry.chunks.length;i++)d.streaming.update(.05,{x:0,y:25,z:-120});
        d.app.off('update');
        const base=d.app.root.findByName('CampusBase'),camera=d.app.root.findByName('Camera');
        const terrain=base.children.filter(c=>c.name.startsWith('campus_terrain'));
        window.__terrainQA={base,camera,terrain};
        camera.setPosition(0,25,140);camera.lookAt(30,0,-30);
        for(const e of terrain)e.enabled=false;
        return terrain.map(e=>({name:e.name,castShadows:e.render.castShadows,scaleSign:e.worldScaleSign,materials:e.render.meshInstances.map(mi=>({opacity:mi.material.opacity,depthWrite:mi.material.depthWrite,cull:mi.material.cull}))}));
      });
      entry.diagnosticBackground=await page.evaluate(configureTerrainDiagnosticBackground);
      assert.equal(entry.terrain.length,5);assert.ok(entry.terrain.every(e=>e.scaleSign===-1&&e.materials.every(m=>m.opacity===1&&m.depthWrite)));
      entry.before=await frame(page,`${name}-south-flight-before`);
      await page.evaluate(()=>window.__terrainQA.terrain.forEach(e=>{e.enabled=true;}));
      entry.after=await frame(page,`${name}-south-flight-after`,{compare:true});
      assert.ok(entry.after.changedSky>entry.after.width*entry.after.height*.003,`${name}: missing visible sky-to-ground repair (${entry.after.changedSky} pixels)`);
      assert.ok(entry.after.blue<entry.before.blue,`${name}: blue ground coverage did not decrease`);

      entry.water=[];
      for(const id of ['lmk_inkyung_pond','central-pool']){
        const water=await page.evaluate(async id=>{
          const {computePolygonCentroid,getCanonicalLandmark,projectPolygon}=await import('/src/reality-adapter.js');
          const {SITE_FEATURES}=await import('/src/basic-campus.js');
          const feature=id==='central-pool'?SITE_FEATURES.find(f=>f.kind==='reflecting_pool'):null;
          const name=feature?.id||id,ring=feature?.vertices||projectPolygon(getCanonicalLandmark(id).polygon);
          const point={...computePolygonCentroid(ring),y:.025};
          const {base,camera,terrain}=window.__terrainQA;camera.setPosition(point.x,55,-point.z+25);camera.lookAt(point.x,0,-point.z);
          terrain.forEach(e=>{e.enabled=false;});
          const entity=base.findByName(name);if(!entity?.render)throw Error(`water missing: ${name}`);
          return {name,point,material:entity.render.meshInstances[0].material.name};
        },id);
        const before=await frame(page,`${name}-${id}-before`,{sample:water.point});
        await page.evaluate(()=>window.__terrainQA.terrain.forEach(e=>{e.enabled=true;}));
        const after=await frame(page,`${name}-${id}-after`,{sample:water.point,compare:true});
        assert.equal(after.sampled.length,27);assert.deepEqual(after.sampled,before.sampled,`${name} ${id}: water pixels changed`);
        entry.water.push({id,...water,before,after});
      }
      if(name==='desktop'){
        entry.oblique=[];
        // Isolated terrain diagnostic for the two exact far-lip rays that failed
        // before adding below-grade sides. Full-campus evidence is above.
        for(const [id,origin,direction] of [
          ['garden',[9.385236793,8,23.054082889],[-.877375320,-.2,.479804697]],
          ['sports',[-66.257813143,8,45.706445268],[-.885024229,-.2,.465544965]]
        ]){
          await page.evaluate(({origin,direction})=>{
            const {base,camera}=window.__terrainQA;
            const frame=base.parent;for(const e of frame.children)e.enabled=e===base;
            for(const e of base.children)e.enabled=e.name.startsWith('campus_terrain')&&!e.name.endsWith('_sides');
            camera.setPosition(origin[0],origin[1],-origin[2]);camera.lookAt(origin[0]+direction[0]*45,origin[1]+direction[1]*45,-(origin[2]+direction[2]*45));
          },{origin,direction});
          const before=await frame(page,`${id}-oblique-without-sides`);
          await page.evaluate(()=>window.__terrainQA.terrain.forEach(e=>{e.enabled=true;}));
          const after=await frame(page,`${id}-oblique-with-sides`,{compare:true});
          assert.ok(after.changedSky>10,`${id}: side mesh does not close the rendered sky seam`);
          entry.oblique.push({id,origin,direction,before,after});
        }
      }
      assert.deepEqual(smoke.problems,[],`${name}: browser errors`);entry.result='PASS';
    }catch(error){entry.result='FAIL';entry.error=String(error.stack||error);entry.problems=smoke.problems;throw error;}
    finally{await smoke.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
  }
  report.result='PASS';
  console.log('campus terrain actual Chromium renders: PASS');
}catch(error){report.result='FAIL';report.error=String(error.stack||error);throw error;}
finally{clearTimeout(watchdog);await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
