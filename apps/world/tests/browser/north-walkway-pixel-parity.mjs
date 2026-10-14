// Additional visual admission gate only. Does not change the performance sampler.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const [input,output]=process.argv.slice(2);assert.ok(input&&output);
const measured=JSON.parse(await readFile(input,'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(measured.head,head,'parity and performance use the same exact head');
const report={head,status:'PENDING',scope:'Restored per-color production versus independently rebuilt legacy paving, A/A and reversed B/A controls; no performance claim',views:[]};
await mkdir(dirname(output),{recursive:true});
try{
 for(const [viewport,dimensions] of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const smoke=await startSmoke({viewport:dimensions,contextOptions:{deviceScaleFactor:1,isMobile:viewport!=='desktop',hasTouch:viewport!=='desktop'}});
  try{
   const page=await smoke.context.newPage();await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS});
   await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
   await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
   await page.evaluate(()=>{const a=window.__INHAGAME_P0__.app;a.off('update');a.autoRender=false;a.renderNextFrame=false;cancelAnimationFrame(a.frameRequestId);a.frameRequestId=null;});
   for(const camera of measured.cameras){
    const result=await page.evaluate(async camera=>{
     const pc=await import('playcanvas'),{FacilityMeshBatch}=await import('/src/facility-mesh-batch.js'),{fillNorthRoads}=await import('/src/north-campus-geometry.js'),{viewDistancePreset}=await import('/src/view-distance.js');
     const d=window.__INHAGAME_P0__,app=d.app,device=app.graphicsDevice;
     d.streaming.setPolicy(viewDistancePreset('NORMAL'));const position={x:camera.from[0],y:0,z:-camera.from[2]};for(let i=0;i<d.registry.chunks.length+12;i++)d.streaming.update(.05,position);
     const c=app.root.findByName('Camera');c.camera.fov=device.clientRect.width/device.clientRect.height<.8&&['CAM-A','CAM-D'].includes(camera.id)?104:58;c.camera.nearClip=.6;c.camera.farClip=800;c.setPosition(...camera.from);c.lookAt(...camera.to);
     const optimized=app.root.findComponents('render').filter(r=>/^north_campus_roads_[0-9a-f]{6}$/i.test(r.entity.name));
     if(optimized.length!==5)throw Error('Exactly five restored per-color north paving owners required');
     const parent=optimized[0].entity.parent;if(!optimized.every(r=>r.entity.parent===parent))throw Error('Paving owner mismatch');
     const reference=new pc.Entity('WalkwayParityReference');parent.addChild(reference);reference.enabled=false;
     fillNorthRoads(new FacilityMeshBatch()).finish(reference,'north_walkway_reference',{castShadows:false});
     if(reference.findComponents('render').length!==5)throw Error('Original five per-color reference meshes required');
     const capture=()=>{app.render();const gl=device.gl,pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4),binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}if(gl.getError()!==0)throw Error('Parity GL error');return pixels;};
     try{
      for(let i=0;i<3;i++)capture();const before=capture(),control=capture();
      optimized.forEach(r=>{r.enabled=false;});reference.enabled=true;for(let i=0;i<3;i++)capture();const legacy=capture();
      reference.enabled=false;optimized.forEach(r=>{r.enabled=true;});const restored=capture();
      optimized.forEach(r=>{r.enabled=false;});reference.enabled=true;const reverse=capture();
      reference.enabled=false;optimized.forEach(r=>{r.enabled=true;});
      let changedPixels=0,maxChannelDelta=0,unstablePixels=0,controlPixels=0,reversePixels=0;const coordinates=[];
      for(let i=0;i<before.length;i+=4){let changed=false,unstable=false,controlChanged=false,reverseChanged=false;for(let j=0;j<4;j++){const delta=Math.abs(before[i+j]-legacy[i+j]);maxChannelDelta=Math.max(maxChannelDelta,delta);changed ||= delta!==0;unstable ||= before[i+j]!==restored[i+j];controlChanged ||= before[i+j]!==control[i+j];reverseChanged ||= legacy[i+j]!==reverse[i+j];}changedPixels+=Number(changed);unstablePixels+=Number(unstable);if(changed&&coordinates.length<100)coordinates.push({x:(i/4)%device.gl.drawingBufferWidth,y:Math.floor(i/4/device.gl.drawingBufferWidth),a:Array.from(before.slice(i,i+4)),b:Array.from(legacy.slice(i,i+4))});
       if(controlChanged)controlPixels++;
       if(reverseChanged)reversePixels++;}
      const w=device.gl.drawingBufferWidth,h=device.gl.drawingBufferHeight;
      const png=bytes=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h);for(let y=0;y<h;y++)image.data.set(bytes.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4);ctx.putImageData(image,0,0);return canvas.toDataURL('image/png').split(',')[1];};
      const delta=new Uint8Array(before.length);for(let i=0;i<delta.length;i+=4){for(let j=0;j<3;j++)delta[i+j]=Math.abs(before[i+j]-legacy[i+j]);delta[i+3]=255;}
      return{changedPixels,maxChannelDelta,unstablePixels,controlPixels,reversePixels,coordinates,bytes:before.length,optimizedMeshes:5,referenceMeshes:5,images:{production:png(before),reference:png(legacy),difference:png(delta)}};
     }finally{reference.destroy();optimized.forEach(r=>{r.enabled=true;});}
    },camera);
    const {images,...receipt}=result;for(const [label,data]of Object.entries(images))await writeFile(`${dirname(output)}/parity-${viewport}-${camera.id}-${label}.png`,Buffer.from(data,'base64'));
    report.views.push({viewport,id:camera.id,...receipt});console.log(viewport,camera.id,JSON.stringify(receipt));
   }
   assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
 assert.equal(report.views.length,24);
 assert.ok(report.views.every(v=>v.changedPixels===0&&v.unstablePixels===0&&v.controlPixels===0&&v.reversePixels===0),'exact RGB/alpha parity and stable unchanged scene required');
 report.status='PASS_EXACT_PIXELS';
}catch(error){report.status='HOLD';report.error=String(error.stack||error);throw error;}
finally{await writeFile(output,JSON.stringify(report,null,2)+'\n');}
