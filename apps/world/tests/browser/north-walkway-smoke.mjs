// Same pinned engine, camera and offline source roots for main/candidate.
// CAM definitions transcribed from MOA camera-views.csv; coordinates are inferred.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
import {WALKWAY_SPANS,WALKWAY_ENTRANCE as E,WALKWAY_SOUTH_ANCHOR} from '../../src/north-walkway-layout.js';
import {NORTH_APPROACHES,FIVE_SOUTH_ENTRY_APPROACH} from '../../src/north-campus-layout.js';
import {SIDE_GATE_PATHS} from '../../src/north-side-gate-layout.js';
const output=process.env.WALKWAY_OUTPUT||'test-results/north-walkway';
const root=process.env.WALKWAY_WORLD_ROOT;
const samples=Number(process.env.WALKWAY_SAMPLES||60);
assert.ok(Number.isInteger(samples)&&samples>=60,'at least 60 measured completed frames per view');
const head=execFileSync('git',['-C',root||process.cwd(),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_WALKWAY_HEAD)assert.equal(head,process.env.EXPECTED_WALKWAY_HEAD);
await mkdir(output,{recursive:true});
const [north,south]=WALKWAY_SPANS;
const fiveEntry=NORTH_APPROACHES.find(e=>e.id==='five_south_entry');
const xyz=(p,y)=>[p.x,y,-p.z]; // Production reflection, no alternate handedness.
const view=(id,from,to,photo,grade)=>({id,from,to,photo,grade});
const cameras=[
  view('CAM-A',xyz({x:0,z:25},18),xyz({x:13,z:88},15),'P-01','HISTORICAL_REFERENCE_ONLY'),
  view('CAM-B',xyz(south.frame.at(south.frame.length+2,5),2.4),xyz(north.frame.at(5,5),4),'P-02','HISTORICAL_REFERENCE_ONLY'),
  view('CAM-C',xyz(north.frame.at(5,6),2.4),xyz(south.frame.at(south.frame.length,5),3),'P-06','OBSERVED+INFERRED'),
  view('CAM-D',xyz(E.frame.at(E.u,8.5),3.6),xyz(E.frame.at(E.u,0),3.6),'P-07','OBSERVED+INFERRED'),
  view('CAM-E',xyz(E.frame.at(E.frame.length+12,10),9),xyz(E.frame.at(E.u-4,0),11),'P-03','HISTORICAL_REFERENCE_ONLY'),
  view('CAM-F',xyz(SIDE_GATE_PATHS[1].frame.at(0),3),xyz(SIDE_GATE_PATHS[3].frame.at(0),4),'P-04','TEXT_ONLY_NO_PHOTO_MATCH'),
  view('CAM-G',xyz(WALKWAY_SOUTH_ANCHOR,4),[-18,12,-81],'P-05','TEXT_ONLY_NO_PHOTO_MATCH'),
  view('FIVE-SOUTH-ENTRY',xyz(fiveEntry.frame.at(fiveEntry.u,34),12),xyz(fiveEntry.frame.at(fiveEntry.u,0),11),'USER-CORRECTION','USER_CONFIRMED_RELATIVE_ALIGNMENT_SURVEY_TBD')
];
const report={head,sourceRoot:root||'candidate',renderer:null,scope:'Offline Chromium software GPU, viewport emulation; not physical mobile performance',measurement:'requestAnimationFrame intervals around explicit app.render + synchronous 1px framebuffer readback; frozen engine tick; completed-frame wall time and raw samples retained; draw/triangle counts include all passes',cameras,views:[]};
try{
 for(const [name,viewport]of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const smoke=await startSmoke({worldRoot:root,viewport,contextOptions:{deviceScaleFactor:1,isMobile:name!=='desktop',hasTouch:name!=='desktop'}});
  try{
   const page=await smoke.context.newPage(),fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS}),fatal]);
   await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
   report.renderer=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer);assert.equal(report.renderer,'WebGL2');
   await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
   await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.app.off('update');d.app.autoRender=false;d.app.renderNextFrame=false;cancelAnimationFrame(d.app.frameRequestId);d.app.frameRequestId=null;});
   const traversal=await page.evaluate(({north,south,entry})=>{
    const d=window.__INHAGAME_P0__,results=[];
    for(const [from,to]of [[north,south],[south,north],[north,entry],[south,entry]]){
     d.player.setLocalPosition(from.x,1.15,from.z);d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;
     d.navigation.setDestination({...to,id:'walkway-qa',title:'Walkway QA',approach:to,arrivalRadius:.4},{position:from,spaceId:'campus'});
     if(!d.playerAutoMove.start(d.navigation.getSnapshot()))throw Error('Auto Move refused');
     let frames=0;
     for(;frames<2400&&d.navigation.getSnapshot().status!=='ARRIVED';frames++){
      const p=d.player.getLocalPosition();d.navigation.update({position:p,spaceId:'campus'});
      d.playerAutoMove.update(d.navigation.getSnapshot(),p);d.controller.update(1/60,1.2);
     }
     const p=d.player.getLocalPosition();results.push({status:d.navigation.getSnapshot().status,frames,distance:Math.hypot(p.x-to.x,p.z-to.z)});
    }
    return results;
   },{north:SIDE_GATE_PATHS[0].frame.at(1.4),south:WALKWAY_SOUTH_ANCHOR,entry:FIVE_SOUTH_ENTRY_APPROACH});
   assert.ok(traversal.every(t=>t.status==='ARRIVED'&&t.distance<.5));
   (report.traversals??=[]).push({viewport:name,traversal});
   for(const camera of cameras){
    const receipt=await page.evaluate(async({camera,samples})=>{
     const d=window.__INHAGAME_P0__,app=d.app,{viewDistancePreset}=await import('/src/view-distance.js');
     d.streaming.setPolicy(viewDistancePreset('NORMAL'));
     const p={x:camera.from[0],y:0,z:-camera.from[2]};
     for(let i=0;i<d.registry.chunks.length+12;i++)d.streaming.update(.05,p);
     const c=app.root.findByName('Camera');c.camera.fov=58;c.camera.nearClip=.6;c.camera.farClip=800;
     // Narrow portrait framing pulls back only for front elevations.
     const portrait=app.graphicsDevice.clientRect.width/app.graphicsDevice.clientRect.height<.8;
     const k=1;if(portrait&&['CAM-A','CAM-D'].includes(camera.id))c.camera.fov=104;
     c.setPosition(...camera.from.map((v,i)=>camera.to[i]+(v-camera.to[i])*k));c.lookAt(...camera.to);
     const device=app.graphicsDevice,draw=device.draw;
     let drawCalls=0,triangles=0;
     device.draw=function(primitive,indexBuffer,instances,...args){
      drawCalls++;const count=primitive.count;
      triangles+=(primitive.type===4?count/3:primitive.type===5||primitive.type===6?Math.max(0,count-2):0)*Math.max(1,instances??1);
      return draw.call(this,primitive,indexBuffer,instances,...args);
     };
     let previous=null;const completionPixel=new Uint8Array(4);
     const frame=()=>new Promise(resolve=>requestAnimationFrame(timestamp=>{
      drawCalls=0;triangles=0;const t=performance.now();app.render();
      // Chromium can enqueue gl.finish() without waiting for the GPU process.
      // A synchronous framebuffer read forces this frame to finish before the
      // next sample, avoiding artificial fast frames followed by queue stalls.
      const gl=device.gl,binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,completionPixel);}
      finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}
      const interval=previous===null?0:timestamp-previous;previous=timestamp;resolve({interval,wall:performance.now()-t});
     }));
     const times=[],wallTimes=[];
     try{for(let i=0;i<12;i++)await frame();for(let i=0;i<samples;i++){const t=await frame();times.push(t.interval);wallTimes.push(t.wall);}}
     finally{device.draw=draw;}
     const rawIntervals=[...times],rawCompletedFrameMs=[...wallTimes];
     times.sort((a,b)=>a-b);
     const gl=app.graphicsDevice.gl,pixels=new Uint8Array(64*64*4),binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
     gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(Math.floor(gl.drawingBufferWidth/2)-32,Math.floor(gl.drawingBufferHeight/2)-32,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);
     const colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
     return {camera:c.getPosition().toArray(),p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],
      completedFrameP50Ms:wallTimes.sort((a,b)=>a-b)[Math.floor(wallTimes.length*.5)],completedFrameP95Ms:wallTimes[Math.floor(wallTimes.length*.95)],rawIntervals,rawCompletedFrameMs,fps:1000/(times.reduce((s,t)=>s+t,0)/times.length),samples:times.length,drawCalls,triangles,
      vramBytes:app.stats.vram.totalUsed,heapBytes:performance.memory?.usedJSHeapSize??null,glError:gl.getError(),centerColors:colors.size,
      framebuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],clock:!!app.root.findByName('bldg_05_clock_core'),tower:!!app.root.findByName('bldg_60th_tower')};
    },{camera,samples});
    assert.equal(receipt.glError,0);assert.ok(receipt.clock&&receipt.tower);assert.ok(receipt.centerColors>1,'nonblank rendered view');
    await page.locator('#application').screenshot({path:`${output}/${name}-${camera.id}.png`,animations:'disabled',timeout:TIMEOUT_MS});
    report.views.push({viewport:name,id:camera.id,photoMatch:camera.grade,...receipt});
    console.log(`${name} ${camera.id}: ${receipt.p50Ms.toFixed(1)}/${receipt.p95Ms.toFixed(1)}ms, ${receipt.drawCalls} draws`);
   }
   // Supplemental only: after all eight timed views, never used to override
   // the original raw heap/performance admission. Fresh browser per viewport.
   let cdp;
   try{
    cdp=await smoke.context.newCDPSession(page);
    const beforeGC=await cdp.send('Runtime.getHeapUsage');
    const retained=[];
    for(let i=0;i<3;i++){await cdp.send('HeapProfiler.collectGarbage');retained.push(await cdp.send('Runtime.getHeapUsage'));}
    const dom=await cdp.send('Memory.getDOMCounters');
    (report.heapDiagnostics??=[]).push({viewport:name,status:'OBSERVED_NOT_LEAK_PROOF',beforeGC,retained,dom});
    console.log('heap diagnostic',name,JSON.stringify({beforeGC,retained,dom}));
   }catch(error){(report.heapDiagnostics??=[]).push({viewport:name,status:'UNKNOWN',error:String(error.message||error)});}
   finally{if(cdp)await cdp.detach();}
   assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
}catch(error){report.error=String(error.stack||error);throw error;}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');}
