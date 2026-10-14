// Diagnostic only: never alters north-walkway admission.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
const [input,output]=process.argv.slice(2);
assert.ok(input&&output,'usage: after/report.json ablation/report.json');
const measured=JSON.parse(await readFile(input,'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.ok(process.env.EXPECTED_WALKWAY_HEAD,'exact head required');
assert.equal(head,process.env.EXPECTED_WALKWAY_HEAD);
assert.equal(measured.head,head);assert.equal(measured.renderer,'WebGL2');
const cameras=['CAM-B','CAM-C'].map(id=>{
 const found=measured.cameras.filter(c=>c.id===id);assert.equal(found.length,1);return found[0];
});
const report={head,status:'PENDING',scope:'Same-head frozen portrait ablation; diagnostic only, no admission claim',samples:60,warmup:12,limitations:[
 'Removal changes occlusion and visible workload; effects are not additive isolated component costs.',
 'Submission includes driver work; completion wait is not pure GPU time.',
 'Original buffers remain allocated: no heap or allocation conclusion.',
 'Restoration image controls do not rule out all external timing drift.',
 'Only portrait CAM-B/C are sampled; full admission remains a separate unchanged gate.'
],views:[]};
await mkdir(dirname(output),{recursive:true});let smoke;
try{
 smoke=await startSmoke({viewport:{width:390,height:844},contextOptions:{deviceScaleFactor:1,isMobile:true,hasTouch:true}});
 const page=await smoke.context.newPage(),fatal=smoke.watch(page);
 await page.goto(smoke.origin+'/campus/?envTime=day&envWeather=clear',{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
 await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus?.().loading?.finished,null,{timeout:TIMEOUT_MS}),fatal]);
 await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
 await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
 report.traversal=await page.evaluate(async()=>{
  const d=window.__INHAGAME_P0__,app=d.app;
  if(d.getStatus().renderer!=='WebGL2')throw Error('WebGL2 required');
  app.off('update');app.autoRender=false;app.renderNextFrame=false;cancelAnimationFrame(app.frameRequestId);app.frameRequestId=null;
  const {SIDE_GATE_PATHS}=await import('/src/north-side-gate-layout.js');
  const {WALKWAY_SOUTH_ANCHOR:south}=await import('/src/north-walkway-layout.js');
  const {FIVE_SOUTH_ENTRY_APPROACH:entry}=await import('/src/north-campus-layout.js');
  const north=SIDE_GATE_PATHS[0].frame.at(1.4),results=[];
  for(const [from,to]of [[north,south],[south,north],[north,entry],[south,entry]]){
   d.player.setLocalPosition(from.x,1.15,from.z);d.controller.mounted=false;d.controller.velocityY=0;d.controller.grounded=true;
   d.navigation.setDestination({...to,id:'walkway-qa',title:'Walkway QA',approach:to,arrivalRadius:.4},{position:from,spaceId:'campus'});
   if(!d.playerAutoMove.start(d.navigation.getSnapshot()))throw Error('Auto Move refused');
   let frames=0;
   for(;frames<2400&&d.navigation.getSnapshot().status!=='ARRIVED';frames++){
    const p=d.player.getLocalPosition();d.navigation.update({position:p,spaceId:'campus'});d.playerAutoMove.update(d.navigation.getSnapshot(),p);d.controller.update(1/60,1.2);
   }
   const p=d.player.getLocalPosition(),r={status:d.navigation.getSnapshot().status,frames,distance:Math.hypot(p.x-to.x,p.z-to.z)};
   if(r.status!=='ARRIVED'||r.distance>=.5)throw Error('Pre-camera traversal mismatch');results.push(r);
  }return results;
 });
 for(const camera of cameras){
  const result=await page.evaluate(async camera=>{
   const pc=await import('playcanvas');
   const {FacilityMeshBatch}=await import('/src/facility-mesh-batch.js');
   const {fillNorthRoads}=await import('/src/north-campus-geometry.js');
   const {fillWalkwayProps}=await import('/src/north-walkway-geometry.js');
   const {WALKWAY_COLORS:C}=await import('/src/north-walkway-layout.js');
   const {FLAT_GROUND_Y:G}=await import('/src/flat-ground-surface.js');
   const {viewDistancePreset}=await import('/src/view-distance.js');
   const d=window.__INHAGAME_P0__,app=d.app,device=app.graphicsDevice;
   const out={id:camera.id,viewport:'portrait',status:'PENDING',windows:[]};
   const check=(ok,message)=>{if(!ok)throw Error(message);};
   const records=new Map(),originalDraw=device.draw;
   let draws=0,triangles=0,firstFull=null,seamRecord=null,seamIndices=null;
   const pavingRecords=[],propPrefixes=[];
   function record(render){
    if(records.has(render))return records.get(render);
    check(render.meshInstances.length===1,'One mesh instance per owner required');
    const mi=render.meshInstances[0],mesh=mi.mesh,primitive=mesh.primitive[0];
    check(app.root.findComponents('render').flatMap(r=>r.meshInstances).filter(other=>other.mesh===mesh).length===1,'Shared mesh mutation forbidden');
    check(mi.renderStyle===pc.RENDERSTYLE_SOLID,'Solid render style required');
    check(primitive.indexed&&primitive.type===pc.PRIMITIVE_TRIANGLES&&primitive.base===0,'Unexpected primitive layout');
    check(render.enabled&&render.entity.enabled,'Owner must be enabled');
    const positions=[],normals=[],indices=[];mesh.getPositions(positions);mesh.getNormals(normals);mesh.getIndices(indices);
    check(indices.length===primitive.count,'Unexpected index capacity/layout');
    check(typeof mesh.indexBuffer[0]?.writeData==='function','Pinned index-buffer API unavailable');
    const r={render,mi,mesh,primitive,material:mi.material,vertexBuffer:mesh.vertexBuffer,indexBuffer:mesh.indexBuffer[0],positions,normals,indices,enabled:render.enabled,originalPrimitive:{...primitive},dirtyIndices:false};
    records.set(render,r);return r;
   }
   function verifySource(r,g,exact){
    check(g.positions.length%3===0&&g.positions.length===g.normals.length&&[...g.positions,...g.normals].every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v)))&&g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.positions.length/3)&&g.indices.length%3===0,'Malformed source geometry');
    check(r.positions.length%3===0&&r.positions.length===r.normals.length&&[...r.positions,...r.normals].every(Number.isFinite)&&r.indices.every(i=>Number.isInteger(i)&&i>=0&&i<r.positions.length/3)&&r.indices.length%3===0,'Malformed live geometry');
    if(exact){
     check(r.indices.length===g.indices.length,'Paving triangle count mismatch');
     for(let i=0;i<g.indices.length;i++)for(let axis=0;axis<3;axis++){
      check(Object.is(r.positions[r.indices[i]*3+axis],Math.fround(g.positions[g.indices[i]*3+axis])),'Expanded paving position mismatch');
      check(Object.is(r.normals[r.indices[i]*3+axis],Math.fround(g.normals[g.indices[i]*3+axis])),'Expanded paving normal mismatch');
     }
     const bounds=new pc.BoundingBox();bounds.compute(g.positions);
     check(['x','y','z'].every(axis=>Object.is(r.mesh.aabb.center[axis],bounds.center[axis])&&Object.is(r.mesh.aabb.halfExtents[axis],bounds.halfExtents[axis])),'Original paving bounds mismatch');
     r.sourceVertices=g.positions.length/3;return;
    }
    check(r.positions.length>=g.positions.length&&r.normals.length>=g.normals.length&&r.indices.length>=g.indices.length,'Source larger than live owner');
    for(let i=0;i<g.positions.length;i++)check(Object.is(r.positions[i],Math.fround(g.positions[i])),'Position prefix mismatch');
    for(let i=0;i<g.normals.length;i++)check(Object.is(r.normals[i],Math.fround(g.normals[i])),'Normal prefix mismatch');
    for(let i=0;i<g.indices.length;i++)check(r.indices[i]===g.indices[i],'Index prefix mismatch');
   }
   function restore(){
    for(const r of records.values()){
     check(r.mi.mesh===r.mesh&&r.mi.material===r.material&&r.mesh.vertexBuffer===r.vertexBuffer&&r.mesh.indexBuffer[0]===r.indexBuffer,'Owner identity changed');
     if(r.dirtyIndices){r.indexBuffer.writeData(r.indices,r.indices.length);r.dirtyIndices=false;}
     Object.assign(r.primitive,r.originalPrimitive);r.render.enabled=r.enabled;
    }
   }
   function apply(mode){
    restore();
    if(mode==='no_paving')pavingRecords.forEach(r=>{r.render.enabled=false;});
    else if(mode==='no_seams'){seamRecord.dirtyIndices=true;seamRecord.indexBuffer.writeData(seamIndices,seamIndices.length);seamRecord.primitive.count=seamIndices.length;}
    else if(mode==='no_props')for(const {r,count}of propPrefixes){r.primitive.base=count;r.primitive.count=r.originalPrimitive.count-count;if(!r.primitive.count)r.render.enabled=false;}
    else check(mode==='full','Unknown mode');
   }
   function readFramebuffer(){
    const gl=device.gl,pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4),binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}
    finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}
    check(gl.getError()===0,'Framebuffer capture GL error');return pixels;
   }
   const summary=values=>{const s=[...values].sort((a,b)=>a-b);return {min:s[0],p50:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1)};};
   try{
    d.streaming.setPolicy(viewDistancePreset('NORMAL'));
    const position={x:camera.from[0],y:0,z:-camera.from[2]};
    for(let i=0;i<d.registry.chunks.length+12;i++)d.streaming.update(.05,position);
    const c=app.root.findByName('Camera');c.camera.fov=58;c.camera.nearClip=.6;c.camera.farClip=800;c.setPosition(...camera.from);c.lookAt(...camera.to);
    out.camera=c.getPosition().toArray();out.framebuffer=[device.gl.drawingBufferWidth,device.gl.drawingBufferHeight];
    const renders=app.root.findComponents('render'),paving=renders.filter(r=>/^north_campus_roads_[0-9a-f]{6}$/.test(r.entity.name));
    const source=fillNorthRoads(new FacilityMeshBatch());
    check(paving.length===5&&source.groups.size===5,'Exactly five paving owners required');
    const parent=paving[0].entity.parent;check(paving.every(r=>r.entity.parent===parent),'Paving parent mismatch');
    for(const [color,g]of source.groups){
     const owners=paving.filter(r=>r.entity.name==='north_campus_roads_'+color.slice(1));check(owners.length===1,'Ambiguous paving color owner');
     const r=record(owners[0]);verifySource(r,g,true);check(r.render.castShadows===false,'Unexpected paving shadow policy');pavingRecords.push(r);
     if(color===C.joint){seamRecord=r;seamIndices=[];for(let i=0;i<g.indices.length;i+=3){const tri=g.indices.slice(i,i+3);if(!tri.every(index=>g.positions[index*3+1]===G.PAINT))seamIndices.push(...r.indices.slice(i,i+3));}}
    }
    check(seamRecord&&seamIndices.length>0&&seamIndices.length<seamRecord.indices.length,'Seam partition is empty/ambiguous');
    const nearOwners=app.root.find(node=>node.name==='bldg_60th_NEAR');check(nearOwners.length===1&&nearOwners[0].enabled,'Exactly one enabled Anniversary NEAR owner required');
    const near=nearOwners[0],props=fillWalkwayProps(new FacilityMeshBatch());
    for(const [color,g]of props.groups){
     if(!g.indices.length)continue;
     const owners=near.findComponents('render').filter(r=>r.entity.parent===near&&r.entity.name==='bldg_60th_details_'+color.slice(1));
     check(owners.length===1,'Ambiguous Anniversary prop color owner');
     const r=record(owners[0]);verifySource(r,g,false);check(r.render.castShadows===false,'Unexpected Anniversary shadow policy');propPrefixes.push({r,count:g.indices.length});
    }
    check(propPrefixes.length>0,'No verified prop prefixes');
    out.ownership={pavingOwners:pavingRecords.map(r=>({name:r.render.entity.name,meshId:r.mesh.id,materialId:r.material.id,sourceVertices:r.sourceVertices,indexedVertices:r.positions.length/3,triangles:r.indices.length/3})),seamTriangles:(seamRecord.indices.length-seamIndices.length)/3,propPrefixes:propPrefixes.map(({r,count})=>({name:r.render.entity.name,meshId:r.mesh.id,materialId:r.material.id,removedTriangles:count/3,retainedTriangles:(r.indices.length-count)/3}))};
    device.draw=function(primitive,indexBuffer,instances,...args){draws++;const count=primitive.count;triangles+=(primitive.type===4?count/3:primitive.type===5||primitive.type===6?Math.max(0,count-2):0)*Math.max(1,instances??1);return originalDraw.call(this,primitive,indexBuffer,instances,...args);};
    const sequence=['full','no_paving','full','no_seams','full','no_props','full'];
    for(const [windowIndex,mode]of sequence.entries()){
     apply(mode);let previous=null;const completionPixel=new Uint8Array(4);
     const frame=()=>new Promise((resolve,reject)=>requestAnimationFrame(timestamp=>{
      try{
       draws=0;triangles=0;const start=performance.now();app.render();const submitted=performance.now();
       const gl=device.gl,binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
       try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,completionPixel);}
       finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}
       const finished=performance.now(),interval=previous===null?0:timestamp-previous;previous=timestamp;
       resolve({interval,wall:finished-start,submit:submitted-start,completion:finished-submitted,draws,triangles});
      }catch(error){reject(error);}
     }));
     for(let i=0;i<12;i++)await frame();const raw=[];for(let i=0;i<60;i++)raw.push(await frame());
     check(raw.every(r=>Number.isFinite(r.interval)&&Number.isFinite(r.wall)&&r.interval>0&&r.wall>0),'Invalid frame sample');
     const entry={windowIndex,mode,samples:raw.length,wallMs:summary(raw.map(r=>r.wall)),submitMs:summary(raw.map(r=>r.submit)),completionWaitMs:summary(raw.map(r=>r.completion)),rafMs:summary(raw.map(r=>r.interval)),draws:summary(raw.map(r=>r.draws)),triangles:summary(raw.map(r=>r.triangles)),rawIntervals:raw.map(r=>r.interval),rawCompletedFrameMs:raw.map(r=>r.wall),rawSubmitMs:raw.map(r=>r.submit),rawCompletionWaitMs:raw.map(r=>r.completion),rawDrawCalls:raw.map(r=>r.draws),rawTriangles:raw.map(r=>r.triangles)};
     out.windows.push(entry);check(device.gl.getError()===0,'Timed window GL error');
     if(mode==='full'){
      const pixels=readFramebuffer();if(!firstFull)firstFull=pixels;check(firstFull.length===pixels.length,'Framebuffer dimensions changed');let changedPixels=0;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==firstFull[i]||pixels[i+1]!==firstFull[i+1]||pixels[i+2]!==firstFull[i+2]||pixels[i+3]!==firstFull[i+3])changedPixels++;
      entry.restoredFullChangedPixels=changedPixels;check(changedPixels===0,'Full restoration/control framebuffer drift');
     }
    }
    out.status='DIAGNOSTIC_ONLY';
   }catch(error){out.status='DIAGNOSTIC_ERROR';out.error=String(error.stack||error);}
   finally{
    try{restore();for(const r of records.values()){const restored=[];r.mesh.getIndices(restored);check(restored.length===r.indices.length&&restored.every((value,i)=>value===r.indices[i]),'Index restoration failed');}}
    catch(error){out.status='DIAGNOSTIC_ERROR';out.restoreError=String(error.stack||error);}
    finally{device.draw=originalDraw;}
   }
   return out;
  },camera);
  report.views.push(result);
  console.log('ABLATION_OWNERSHIP',camera.id,JSON.stringify(result.ownership));
  for(const window of result.windows)console.log('ABLATION',camera.id,JSON.stringify(window));
  assert.equal(result.status,'DIAGNOSTIC_ONLY',result.error||result.restoreError||'Diagnostic failed');
 }
 assert.deepEqual(smoke.problems,[]);assert.equal(report.views.length,2);assert.ok(report.views.every(v=>v.windows.length===7));report.status='DIAGNOSTIC_ONLY';
}catch(error){report.status='DIAGNOSTIC_ERROR';report.error=String(error.stack||error);throw error;}
finally{try{await writeFile(output,JSON.stringify(report,null,2)+'\n');}finally{if(smoke)await smoke.close();}}
