import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const output=process.env.ANNYONGI_OUTPUT||'test-results/annyongi';await mkdir(output,{recursive:true});
const results=[];
const frames=[];
async function screenshot(page,path) {
 const at=await page.evaluate(()=>window.__INHAGAME_P0__.app.frame);
 await page.waitForFunction(at=>window.__INHAGAME_P0__.app.frame>=at+3,at);
 // Pause at a completed frame. SwiftShader must not compete with a continuously
 // rendering campus while Chromium copies the framebuffer (remote run 37601290414).
 await page.evaluate(()=>new Promise(resolve=>{const app=window.__INHAGAME_P0__.app;app.once('frameend',()=>{cancelAnimationFrame(app.frameRequestId);app.frameRequestId=null;resolve();});}));
 const evidence=await page.evaluate(async()=>{
  const d=window.__INHAGAME_P0__,carrier=d.player.findByName('Annyongi_GLB_Visual');
  const pc=await import('playcanvas');const points=[];
  const faceNames=new Set(['Head','Forelock curled contour','Nose lobe contour -1','Nose lobe contour 1','Open smile outer contour','Smile upper lip -1','Smile upper lip 1']);
  const facePoints=new Map();let facing=null;

  for(const component of carrier.findComponents('render'))for(const mi of component.meshInstances){
   const v=[];mi.mesh.getPositions(v);
   if(mi.morphInstance)mi.morphInstance.morph.targets.forEach((target,index)=>{const w=mi.morphInstance.getWeight(index);if(w)for(let i=0;i<v.length;i++)v[i]+=target.deltaPositions[i]*w;});
   const transform=mi.node.getWorldTransform();
   for(let i=0;i<v.length;i+=3){const world=transform.transformPoint(new pc.Vec3(v[i],v[i+1],v[i+2]));const p=d.orbit.camera.camera.worldToScreen(world);points.push(p);
    if(faceNames.has(mi.node.name)){if(!facePoints.has(mi.node.name))facePoints.set(mi.node.name,[]);facePoints.get(mi.node.name).push(p);}}
   if(mi.node.name==='Head'){const normal=transform.transformVector(new pc.Vec3(0,0,1)).normalize();const toCamera=d.orbit.camera.getPosition().clone().sub(mi.node.getPosition()).normalize();facing=normal.dot(toCamera);}

  }
  const rect=ps=>({left:Math.min(...ps.map(p=>p.x)),right:Math.max(...ps.map(p=>p.x)),top:Math.min(...ps.map(p=>p.y)),bottom:Math.max(...ps.map(p=>p.y))});
  // Transient coordinates only: consumed with the existing PNG, never an ID mask
  // or a new capture. Projection cannot resolve scene occlusion or subpixel lines.
  window.__ANNYONGI_CAMPUS_FACE_ROIS__={rects:Object.fromEntries([...facePoints].map(([name,ps])=>[name,rect(ps)])),facing,enabled:carrier.enabled,width:innerWidth,height:innerHeight,
   graphics:d.getStatus().graphics,camera:{distance:d.orbit.distance,near:d.orbit.camera.camera.nearClip,far:d.orbit.camera.camera.farClip},renderWidth:d.app.graphicsDevice.width,renderHeight:d.app.graphicsDevice.height};
  return {state:d.character.flightVisualState??null, wings:['DragonWing_L','DragonWing_R'].map(n=>carrier.findByName(n).getLocalEulerAngles().toString()),
   bounds:{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))},width:innerWidth,height:innerHeight};
 });
 const frameRecord={file:path.split('/').at(-1),...evidence};frames.push(frameRecord);
 if(evidence.state && /-(ascending|hover|flight|descending)\.png$/.test(path)) {
  const state=path.match(/-(ascending|hover|flight|descending)\.png$/)[1];
  assert.equal(evidence.state.mode,{ascending:'ascend',hover:'hover',flight:'forward',descending:'descend'}[state]);
 }
 if(/-(ascending|hover|flight|descending|ride-three-quarter)\.png$/.test(path)) {
  assert.ok(evidence.bounds.left>=0&&evidence.bounds.right<=evidence.width&&evidence.bounds.top>=0&&evidence.bounds.bottom<=evidence.height,'whole mascot stays framed: '+JSON.stringify(evidence));
 }
 try {
  const png=await page.screenshot({path,timeout:60000});
  frameRecord.faceReadability=await page.evaluate(async encoded=>{
   const info=window.__ANNYONGI_CAMPUS_FACE_ROIS__;delete window.__ANNYONGI_CAMPUS_FACE_ROIS__;
   const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([raw],{type:'image/png'}));
   const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,w=canvas.width,h=canvas.height,sx=w/info.width,sy=h/info.height;
   const luminance=i=>.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
   const sample=(rect,visit)=>{if(!rect||!Object.values(rect).every(Number.isFinite))return 0;let n=0;for(let y=Math.max(0,Math.ceil(rect.top*sy));y<Math.min(h,Math.floor(rect.bottom*sy));y++)for(let x=Math.max(0,Math.ceil(rect.left*sx));x<Math.min(w,Math.floor(rect.right*sx));x++){visit((y*w+x)*4);n++;}return n;};
   const skin=[];sample(info.rects.Head,i=>{if(pixels[i+2]>pixels[i]+8&&pixels[i+2]>=pixels[i+1])skin.push(luminance(i));});skin.sort((a,b)=>a-b);const reference=skin.length>=5?skin[Math.floor(skin.length/2)]:null;
   const nodes={};for(const [name,rect] of Object.entries(info.rects)){if(name==='Head')continue;let dark=0;const count=sample(rect,i=>{if(reference!==null&&luminance(i)<reference*.65)dark++;});const cssWidth=rect.right-rect.left,cssHeight=rect.bottom-rect.top;
    const state=!info.enabled?'HIDDEN':info.facing<=0?'BACK_FACING':Math.min(cssWidth,cssHeight)<1||count<3?'RESOLUTION_LIMITED':reference===null||reference<20?'UNMEASURABLE_REFERENCE':'ROI_OBSERVATION_ONLY';
    nodes[name]={state,cssWidth,cssHeight,renderWidth:cssWidth*info.renderWidth/info.width,renderHeight:cssHeight*info.renderHeight/info.height,roiPixels:count,darkPixels:state==='ROI_OBSERVATION_ONLY'?dark:null,darkFraction:state==='ROI_OBSERVATION_ONLY'?dark/count:null};
   }
   const head=info.rects.Head;canvas.width=canvas.height=0;
   return {status:'OBSERVATION_ONLY',camera:info.camera,graphics:info.graphics,renderPixelRatio:{x:info.renderWidth/info.width,y:info.renderHeight/info.height},facing:info.facing,headCssSize:head?{width:head.right-head.left,height:head.bottom-head.top}:null,headBlueReferencePixels:skin.length,headBlueReferenceLuminance:reference,nodes,
    limits:['Reuses the existing campus PNG; no extra capture or camera change.','Projected ROIs are not isolated line masks: eyes, shadows, adjacent features and scene occlusion may contribute.','The blue reference comes from the projected Head rectangle and may include background pixels; it is not ground-truth skin segmentation.','Projected bounding-box size does not measure stroke thickness; subpixel and AA continuity remain unverified.','Dark ROI pixels do not establish facial line continuity or human visual approval.']};
  },png.toString('base64'));
 }
 finally { await page.evaluate(()=>{const app=window.__INHAGAME_P0__.app;app._time=performance.now();app.requestAnimationFrame();}); }
}
for(const time of (process.env.ANNYONGI_TIMES || 'day,night').split(',')) for(const [deviceName,viewport,touch] of [['desktop',{width:1280,height:800},false],['mobile',{width:390,height:844},true]]){
 const name=deviceName+'-'+time;
 const smoke=await startSmoke({viewport,contextOptions:touch?{isMobile:true,hasTouch:true,deviceScaleFactor:1}:{}});
 try {
 const page=await smoke.context.newPage();const fatal=smoke.watch(page);
 await page.goto(smoke.origin+'/campus/?envTime='+time+'&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS}),fatal]);
 await page.waitForFunction(()=>window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual'));
 const setup=await page.evaluate(()=>{
  const d=window.__INHAGAME_P0__,c=d.controller;
  // Exercise existing mount action in a clear synthetic test location, never grant an account item.
  d.player.setLocalPosition(15,c.groundY,10);c.grounded=true;c.velocityY=0;c.toggleMount();d.app.fire('update',.016);
  d.orbit.yaw=.6;d.orbit.pitch=.20; // Keep the shipping camera's default zoom.
  return {mounted:c.mounted,mountId:c.mountId,renderer:d.getStatus().renderer,model:d.player.findByName('Annyongi_GLB_Visual').enabled};
 });
 assert.equal(setup.mounted,true);assert.equal(setup.mountId,'annyongi');assert.equal(setup.model,true);
 await page.waitForFunction(()=>window.__INHAGAME_P0__.app.frame>10);
 await screenshot(page,`${output}/${name}-campus-mounted.png`);
 const before=await page.evaluate(()=>window.__INHAGAME_P0__.player.getLocalPosition().y);
 if(touch){
  const box=await page.locator('#jump').boundingBox();assert.ok(box);const cdp=await smoke.context.newCDPSession(page);page.touchSession=cdp;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
 }else await page.keyboard.down('Space');
 await page.waitForFunction(y=>window.__INHAGAME_P0__.player.getLocalPosition().y>y+.6,before,{timeout:15000});
 await page.waitForFunction(()=>window.__INHAGAME_P0__.character.flightVisualState.pitch < -28);
 await screenshot(page,`${output}/${name}-ascending.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('Space');
 await page.waitForFunction(()=>Math.abs(window.__INHAGAME_P0__.character.flightVisualState.pitch)<1);
 await screenshot(page,`${output}/${name}-hover.png`);
 const start=await page.evaluate(()=>{const p=window.__INHAGAME_P0__.player.getLocalPosition();return [p.x,p.z];});
 if(touch){const box=await page.locator('#joystick').boundingBox();await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height*.2,id:2}]});}else await page.keyboard.down('w');
 await page.waitForFunction(([x,z])=>{const p=window.__INHAGAME_P0__.player.getLocalPosition();return Math.hypot(p.x-x,p.z-z)>.7},start,{timeout:15000});
 await page.waitForFunction(()=>window.__INHAGAME_P0__.character.flightVisualState.tail[1]>.97);
 await screenshot(page,`${output}/${name}-flight.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('w');
 const framing=await page.evaluate(()=>{const d=window.__INHAGAME_P0__,p=d.player.findByName('Annyongi_GLB_Visual').getPosition();const v=d.orbit.camera.camera.worldToScreen(p);return {x:v.x,y:v.y,w:innerWidth,h:innerHeight,visible:d.player.findByName('Annyongi_GLB_Visual').enabled};});
 assert.ok(framing.visible&&framing.x>0&&framing.x<framing.w&&framing.y>0&&framing.y<framing.h,JSON.stringify(framing));
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.yaw+=2.2;});
 await screenshot(page,`${output}/${name}-ride-three-quarter.png`);
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.yaw-=2.2;});
 const clipping=await page.evaluate(async()=>{
  const pc=await import('playcanvas');
  const d=window.__INHAGAME_P0__,carrier=d.player.findByName('Annyongi_GLB_Visual'),rider=d.player.findByName('Induck_GLB_Visual');
  // Check actual rider vertices in head/model space, not rotated world AABBs
  // (those overlap falsely when the separated boxes turn diagonally together).
  const inverse=carrier.findByName('FlightHeadPivot').getWorldTransform().clone().invert();let minimum=Infinity;
  for(const component of rider.findComponents('render')) for(const instance of component.meshInstances){
   const vertices=[];instance.mesh.getPositions(vertices);
   const transform=new pc.Mat4().mul2(inverse,instance.node.getWorldTransform());
   for(let i=0;i<vertices.length;i+=3){const p=transform.transformPoint(new pc.Vec3(...vertices.slice(i,i+3)));
    minimum=Math.min(minimum,(p.x/.69)**2+((p.y-.37)/.63)**2+((p.z-.07)/.52)**2);
   }
  }
  const headClip=minimum<1;
  const before=carrier.getLocalPosition().y;d.character.update(.13,{mounted:true,moving:false,grounded:false});const after=carrier.getLocalPosition().y;
  return {headClip,minimum,hover:before!==after,anchor:!!carrier.findByName('RiderAnchor')};
 });assert.equal(clipping.headClip,false);assert.equal(clipping.hover,true);
 // Actual input descent, then release before exercising automatic landing.
 const high=await page.evaluate(()=>{const d=window.__INHAGAME_P0__;const p=d.player.getLocalPosition();d.player.setLocalPosition(p.x,d.controller.groundY+18,p.z);return d.player.getLocalPosition().y;});
 if(touch){const b=await page.locator('#descend').boundingBox();await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:3}]});}else await page.keyboard.down('c');
 await page.waitForFunction(y=>window.__INHAGAME_P0__.player.getLocalPosition().y<y-.6,high);
 await page.waitForFunction(()=>window.__INHAGAME_P0__.character.flightVisualState.tail[2]>.95);
 await screenshot(page,`${output}/${name}-descending.png`);
 if(touch)await page.touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('c');
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.orbit.distance=d.orbit.zoomLimits.min;});
 await screenshot(page,`${output}/${name}-close.png`);
 await page.evaluate(()=>{window.__INHAGAME_P0__.orbit.togglePerspective();});
 await page.waitForFunction(()=>!window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual').enabled);
 await screenshot(page,`${output}/${name}-first-person.png`);
 await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.orbit.togglePerspective();d.orbit.distance=d.orbit.zoomLimits.initial;d.controller.toggleMount();});
 await page.waitForFunction(()=>{const s=window.__INHAGAME_P0__.character.flightVisualState;return s.mode==='landing'&&s.deployment<.6;},null,{timeout:30000});
 await screenshot(page,`${output}/${name}-landing.png`);
 await page.waitForFunction(()=>!window.__INHAGAME_P0__.controller.mounted,null,{timeout:30000});
 await screenshot(page,`${output}/${name}-landed.png`);
 assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.player.findByName('Annyongi_GLB_Visual').enabled),false);
 assert.deepEqual(smoke.problems,[]);results.push({name,setup,clipping,passed:true});
 }catch(error){results.push({name,passed:false,error:String(error.stack??error),problems:smoke.problems});throw error;}
 finally{await writeFile(output+'/campus-results.json',JSON.stringify({results,frames},null,2));await smoke.close();}
}
console.log('Annyongi campus desktop/mobile day/night PASS');
