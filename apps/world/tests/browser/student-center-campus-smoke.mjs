// Hosted real-browser evidence for the integrated student center, never a preview scene.
// harness.mjs serves pinned PlayCanvas, stubs /api/* + Supabase and blocks off-origin traffic.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startSmoke, TIMEOUT_MS} from './harness.mjs';

export const STUDENT_LOOP = Object.freeze([
  [-14,14],[-14,1],[-24,1],[-24,-17],[-17.3,-17],[-17.3,-3],
  [0,-3],[0,29],[-14,29],[-14,14]
].map(Object.freeze));
export const STUDENT_VIEWPORTS = Object.freeze([
  ['desktop',{width:1280,height:720},false],
  ['portrait',{width:390,height:844},true],
  ['landscape',{width:844,height:390},true]
]);

// Exported fixture functions are also usable by a null-device contract check.
// Movement is ONLY production PlayerController.update, driven by trusted KeyW.
export async function configureStudentCampusFixture() {
  const d=window.__INHAGAME_P0__;
  const [{studentConnectedFrame},{createStudentConnectedWalk},{PlayerController,CAMPUS_MOVEMENT_SPACE},
    {WALK_SHAPE},{OBSTACLES},{viewDistancePreset}]=await Promise.all([
    import('/src/student-center-frame.js'),import('/src/student-center-connected.js'),
    import('/src/player-controller.js'),import('/src/player-dimensions.js'),
    import('/src/campus-layout.js'),import('/src/view-distance.js')
  ]);
  if(!(d.controller instanceof PlayerController)||d.controller.space!==CAMPUS_MOVEMENT_SPACE||
    d.controller.update!==PlayerController.prototype.update)throw Error('Actual default campus controller is required');
  if(!d.controller.inputEnabled||d.controller.mounted||d.controller.assist||d.controller.groundMovementLocks.size)
    throw Error('Campus player is not in ordinary manual walking state');
  const frame=studentConnectedFrame(),center=frame.toWorld([0,0,0]);
  // Freeze unrelated gameplay only after the real /campus/ loading and environment settle.
  // The original app and render lifecycle remain running; no replacement controller/scene.
  d.app.off('update');
  d.app.autoRender=false;
  d.streaming.setPolicy(viewDistancePreset('MAX'));
  for(let i=0;i<d.registry.chunks.length+10;i++)d.streaming.update(.05,{x:center[0],y:0,z:center[2]});
  const all=[];
  const visit=e=>{all.push(e);for(const child of e.children)visit(child);};visit(d.app.root);
  const owners=['BASE','NEAR','DETAIL'].map(tier=>{
    const matches=all.filter(e=>e.name===`bldg_07_connected_${tier}`);
    if(matches.length!==1)throw Error(`${tier}: expected one campus owner, got ${matches.length}`);
    return matches[0];
  });
  const legacy=all.filter(e=>/^bldg_07(?:$|_(?:body|roof)_|_(?:NEAR|DETAIL)$)/.test(e.name)).map(e=>e.name);
  if(legacy.length||OBSTACLES.some(o=>o.id==='bldg_07_0'))throw Error('Legacy student body/collider remains');
  const camera=d.app.root.findByName('Camera');
  if(!camera?.camera||d.orbit.camera!==camera||!d.character)throw Error('Actual campus orbit camera or character missing');
  const meshCounts=owners.map(e=>e.findComponents('render').reduce((n,r)=>n+r.meshInstances.length,0));
  if(!meshCounts[0]||!meshCounts[1])throw Error('Student BASE/NEAR geometry is missing');
  d.app.root.syncHierarchy();
  if(owners.some(e=>!e.enabled||e.worldScaleSign!==-1))throw Error('Student owner visibility/reflected campus frame is wrong');
  const input=[];
  for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
    if(event.code==='KeyW')input.push({type,code:event.code,trusted:event.isTrusted});
  });
  window.__studentCampusQA={d,frame,walk:createStudentConnectedWalk({space:'world'}),shape:WALK_SHAPE,
    campusSpace:CAMPUS_MOVEMENT_SPACE,controllerUpdate:PlayerController.prototype.update,owners,camera,input,
    projection:{fov:camera.camera.fov,horizontalFov:camera.camera.horizontalFov,nearClip:camera.camera.nearClip,farClip:camera.camera.farClip},
    resets:0,ticks:0,previousPixels:null};
  return {controller:d.controller.constructor.name,movementSpace:d.controller.space.id,
    defaultController:true,legacyOwners:legacy,legacyMonolith:false,
    studentColliders:OBSTACLES.filter(o=>o.id.startsWith('student:')).length,
    owners:owners.map((e,i)=>({name:e.name,meshes:meshCounts[i],scaleSign:e.worldScaleSign})),
    campusBasePresent:!!d.app.root.findByName('CampusBase'),streaming:d.streaming.getMetrics(),
    renderMode:'actual campus; unrelated update callbacks frozen; renderer stays active'};
}

export function resetStudentLoop(local) {
  const q=window.__studentCampusQA,{d}=q,c=d.controller;
  if(c.space!==q.campusSpace||c.update!==q.controllerUpdate||c.keys.size||c.assist||c.mounted)
    throw Error('Loop reset requires released keys and the original default controller');
  const start=q.frame.toWorld([local[0],0,local[1]]);
  const check=q.walk.inspect(start[0],start[2],0);
  if(!check.supported||!check.clear)throw Error('Loop start lacks actual support or clearance');
  // The only fixture position assignment. One initial placement per direction;
  // every subsequent sample and screenshot is reached by production movement.
  d.player.setLocalPosition(start[0],q.shape.footOffset,start[2]);
  c.velocityY=0;c.grounded=true;c.jumpQueued=false;
  q.resets++;
  return {position:[start[0],q.shape.footOffset,start[2]],local:[local[0],0,local[1]],resets:q.resets};
}

export function prepareStudentSegment({from,to}) {
  const q=window.__studentCampusQA,{d}=q,c=d.controller;
  const a=q.frame.toWorld([from[0],0,from[1]]),b=q.frame.toWorld([to[0],0,to[1]]);
  const dx=b[0]-a[0],dz=b[2]-a[2],distance=Math.hypot(dx,dz),steps=Math.ceil(distance/.06);
  if(!distance||!Number.isFinite(c.walkSpeed)||c.walkSpeed<=0)throw Error('Invalid segment or production walk speed');
  const p=d.player.getLocalPosition();
  if(Math.hypot(p.x-a[0],p.z-a[2])>1e-5)throw Error('Segment did not start at the prior walked endpoint');
  // Production KeyW uses vx=-sin(yaw)*speed, vz=cos(yaw)*speed.
  const yaw=Math.atan2(-dx,dz),dt=distance/steps/c.walkSpeed;
  if(dt>.05)throw Error('Fixture exceeds production delta-time clamp');
  q.segment={from,to,a,b,dx,dz,distance,steps,yaw,dt,done:0,maxError:0,minFeet:Infinity,maxFeet:-Infinity,maxStep:0};
  return {from,to,distance,steps,yaw,dt};
}

export function tickStudentSegment(until) {
  const q=window.__studentCampusQA,{d,segment:s}=q,c=d.controller;
  if(!s||until>s.steps||until<s.done)throw Error('Invalid segment tick range');
  if(c.space!==q.campusSpace||c.update!==q.controllerUpdate||c.assist||c.mounted||!c.inputEnabled||
    c.keys.size!==1||!c.keys.has('KeyW')||c.touchSprint||c.touchVector.x||c.touchVector.y)
    throw Error('Trusted W must be the sole input to the unchanged campus controller');
  if(q.input.at(-1)?.type!=='keydown'||!q.input.at(-1)?.trusted)throw Error('Missing trusted keydown');
  for(;s.done<until;s.done++){
    const previous=d.player.getLocalPosition().clone();
    c.update(s.dt,s.yaw);q.ticks++;
    const p=d.player.getLocalPosition(),feet=p.y-q.shape.footOffset;
    const error=Math.hypot(p.x-(s.a[0]+s.dx*(s.done+1)/s.steps),p.z-(s.a[2]+s.dz*(s.done+1)/s.steps));
    const check=q.walk.inspect(p.x,p.z,feet);
    if(![p.x,p.y,p.z].every(Number.isFinite)||error>1e-5||!c.grounded||!check.supported||!check.clear)
      throw Error(JSON.stringify({reason:'Default controller loop lost route/support/clearance',from:s.from,to:s.to,tick:s.done+1,position:[p.x,p.y,p.z],feet,error,grounded:c.grounded,check}));
    const step=Math.abs(p.y-previous.y);
    if(step>.151)throw Error(`Unphysical vertical snap: ${step} world units`);
    s.maxStep=Math.max(s.maxStep,step);s.maxError=Math.max(s.maxError,error);
    s.minFeet=Math.min(s.minFeet,feet);s.maxFeet=Math.max(s.maxFeet,feet);
  }
  const p=d.player.getLocalPosition();
  return {done:s.done,steps:s.steps,position:[p.x,p.y,p.z],local:q.frame.toLocal([p.x,p.y-q.shape.footOffset,p.z]),
    maxError:s.maxError,minFeet:s.minFeet,maxFeet:s.maxFeet,maxStep:s.maxStep,
    grounded:c.grounded,supported:true,bodyClear:true,dt:s.dt,yaw:s.yaw,totalTicks:q.ticks};
}

export function setStudentWalkthroughCamera() {
  const q=window.__studentCampusQA,{d,camera}=q,c=d.controller;
  Object.assign(camera.camera,q.projection);
  d.orbit.firstPerson=false;d.orbit.distance=2.2;d.orbit.pitch=.18;d.orbit.yaw=q.segment.yaw;
  d.character.setFirstPerson(false);
  d.orbit.apply(d.player.getLocalPosition(),d.character.eyeHeight);
  const p=camera.getPosition();
  if(![p.x,p.y,p.z].every(Number.isFinite))throw Error('Nonfinite production orbit camera');
  return {mode:'production third-person OrbitCameraController.apply',position:[p.x,p.y,p.z],
    yaw:d.orbit.yaw,pitch:d.orbit.pitch,distance:d.orbit.distance,eyeHeight:d.character.eyeHeight,
    playerPosition:d.player.getLocalPosition().toArray(),movementSpace:c.space.id,
    firstPerson:d.orbit.firstPerson,indoorOverride:d.orbit.indoor!==null};
}

// Fit the complete actual mesh bounds, including all exterior source details.
// This camera is diagnostic; normal orbit views are captured separately during walking.
export function fitStudentExterior({points,back,aspect,fov=48,margin=.84}) {
  if(!points.length||!(aspect>0)||back.some(v=>!Number.isFinite(v)))throw Error('Invalid exterior bounds');
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),normalize=v=>v.map(x=>x/Math.hypot(...v));
  const target=[0,1,2].map(i=>(Math.min(...points.map(p=>p[i]))+Math.max(...points.map(p=>p[i])))/2);
  back=normalize(back);
  const right=normalize([back[2],0,-back[0]]);
  const up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
  const tan=Math.tan(fov*Math.PI/360);let distance=1;
  for(const point of points){
    const delta=point.map((x,i)=>x-target[i]),depth=dot(delta,back);
    distance=Math.max(distance,depth+Math.abs(dot(delta,right))/(tan*aspect*margin),depth+Math.abs(dot(delta,up))/(tan*margin));
  }
  return {position:target.map((v,i)=>v+back[i]*distance),target,distance,fov,margin,aspect};
}

export function studentExteriorInputs() {
  const q=window.__studentCampusQA; q.d.app.root.syncHierarchy();
  const points=q.owners.flatMap(e=>e.findComponents('render').flatMap(r=>r.meshInstances.flatMap(mi=>{
    const min=mi.aabb.getMin(),max=mi.aabb.getMax();
    return [min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>[x,y,z])));
  })));
  const a=q.frame.toWorld([0,0,0]),b=q.frame.toWorld([60,36,74]);
  q.exteriorPoints=points;
  const canvas=q.d.app.graphicsDevice.canvas;
  return {points,back:[b[0]-a[0],b[1]-a[1],-(b[2]-a[2])],aspect:canvas.clientWidth/canvas.clientHeight};
}

export function applyStudentExterior(fit) {
  const q=window.__studentCampusQA,c=q.camera;
  c.camera.fov=fit.fov;c.camera.horizontalFov=false;c.camera.nearClip=.05;
  c.camera.farClip=Math.max(q.projection.farClip,fit.distance+200);
  c.setPosition(...fit.position);c.lookAt(...fit.target);
}

export function captureStudentPixels({compare=false,exterior=false}) {
  return new Promise((resolve,reject)=>{
    const q=window.__studentCampusQA,{app}=q.d;
    const timer=setTimeout(()=>{app.off('postrender',finish);reject(Error('Student campus frame deadline'));},12000);
    function finish(){
      clearTimeout(timer);
      try{
        const gl=app.graphicsDevice.gl;if(!gl)throw Error('WebGL2 framebuffer required');
        gl.finish();
        const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,data=new Uint8Array(width*height*4);
        const previousRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);}
        finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previousRead);}
        const colors=new Set();let changed=0,sum=0,sumSquares=0,opaque=0,hash=2166136261;
        for(let i=0;i<data.length;i+=4){
          const light=(data[i]+data[i+1]+data[i+2])/3;sum+=light;sumSquares+=light*light;
          colors.add((data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4));
          if(data[i+3]===255)opaque++;
          hash=Math.imul((hash^data[i])>>>0,16777619);hash=Math.imul((hash^data[i+1])>>>0,16777619);hash=Math.imul((hash^data[i+2])>>>0,16777619);
          if(compare&&q.previousPixels&&Math.abs(data[i]-q.previousPixels[i])+Math.abs(data[i+1]-q.previousPixels[i+1])+Math.abs(data[i+2]-q.previousPixels[i+2])>20)changed++;
        }
        let framing=null;
        if(exterior){
          // Camera view/projection caches have now been refreshed by a rendered frame.
          const rect=app.graphicsDevice.canvas.getBoundingClientRect(),camera=q.camera;
          const projected=q.exteriorPoints.map(p=>camera.camera.worldToScreen({x:p[0],y:p[1],z:p[2]}));
          framing={points:projected.length,minX:Math.min(...projected.map(p=>p.x/rect.width)),maxX:Math.max(...projected.map(p=>p.x/rect.width)),
            minY:Math.min(...projected.map(p=>p.y/rect.height)),maxY:Math.max(...projected.map(p=>p.y/rect.height)),
            minDepth:Math.min(...q.exteriorPoints.map(p=>(p[0]-camera.getPosition().x)*camera.forward.x+(p[1]-camera.getPosition().y)*camera.forward.y+(p[2]-camera.getPosition().z)*camera.forward.z))};
        }
        q.previousPixels=data;
        const count=width*height;
        resolve({width,height,quantizedColors:colors.size,luminanceStddev:Math.sqrt(Math.max(0,sumSquares/count-(sum/count)**2)),
          opaque,changed,hash:(hash>>>0).toString(16),glError:gl.getError(),contextLost:gl.isContextLost(),
          readbackFramebuffer:'resolved-default',framing});
      }catch(error){reject(error);}
    }
    app.once('postrender',finish);app.renderNextFrame=true;
  });
}

async function main() {
  const repo=fileURLToPath(new URL('../../../../',import.meta.url));
  const output=path.resolve(process.env.WORLD_STUDENT_CAMPUS_QA_OUTPUT||'test-results/student-center-campus');
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',timeout:10000}).trim();
  const head=git(['rev-parse','HEAD']);
  const sourcePaths=['apps/world/src','apps/world/campus','apps/world/dev-server.mjs',
    'apps/world/tests/browser/harness.mjs','apps/world/tests/browser/package.json','apps/world/tests/browser/package-lock.json',
    'apps/world/tests/browser/student-center-campus-smoke.mjs','.github/workflows/student-center-campus-browser.yml'];
  const dirty=git(['status','--porcelain','--untracked-files=all','--',...sourcePaths]);
  const expected=process.env.EXPECTED_STUDENT_HEAD||null;
  const report={result:'RUNNING',startedAt:new Date().toISOString(),head,expectedHead:expected,
    exactCommit:!dirty,sourceStatus:dirty||'clean',tree:git(['rev-parse','HEAD^{tree}']),
    scope:'Actual offline /campus/ app and default PlayerController; trusted W input with deterministic production update ticks, two supported loops at three viewport sizes. Exterior diagnostic plus production orbit walkthroughs. No backend, account, publication or Production access.',
    limits:'Frozen unrelated gameplay updates; exterior camera is a fitted diagnostic. Mobile dimensions use trusted keyboard input and do not claim joystick or touch-control coverage. Conceptual historical interior is not a surveyed floor plan.',
    sources:[],cases:[]};
  await mkdir(output,{recursive:true});
  const reportPath=path.join(output,'report.json');
  const flush=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  const watchdog=setTimeout(()=>{report.result='FAIL';report.error='Student campus browser QA exceeded 540000ms';writeFileSync(reportPath,JSON.stringify(report,null,2));process.exit(1);},540000);
  try{
    if(expected){assert.equal(head,expected,'Check out the exact PR head');assert.equal(dirty,'','Exact-commit CI evidence requires clean source inputs');}
    const files=git(['ls-files','--cached','--others','--exclude-standard','--',...sourcePaths]).split('\n').filter(Boolean);
    for(const file of [...new Set(files)].sort())report.sources.push({path:file,sha256:createHash('sha256').update(await readFile(path.join(repo,file))).digest('hex')});
    await flush();
    for(const [name,viewport,mobile] of STUDENT_VIEWPORTS){
      const entry={name,viewport,result:'RUNNING',screenshots:[],loops:[],requests:{api:[],offOrigin:[]}};report.cases.push(entry);
      let smoke;
      try{
        smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
        const page=await smoke.context.newPage(),fatal=smoke.watch(page);
        page.on('request',request=>{const u=new URL(request.url());if(u.origin!==smoke.origin)entry.requests.offOrigin.push(`${u.origin}${u.pathname}`);else if(u.pathname.startsWith('/api/'))entry.requests.api.push(u.pathname);});
        const evaluate=(fn,arg)=>Promise.race([page.evaluate(fn,arg),fatal]);
        await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
        await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
        const status=await evaluate(()=>window.__INHAGAME_P0__.getStatus());
        assert.equal(status.renderer,'WebGL2');assert.equal(status.loading.phase,'READY');entry.renderer=status.renderer;
        await Promise.race([page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS}),fatal]);
        // Canvas-only evidence keeps HUD overlays from obscuring doorways. No scene entity is hidden here.
        await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
        entry.ownership=await evaluate(configureStudentCampusFixture);
        assert.equal(entry.ownership.campusBasePresent,true);assert.ok(entry.ownership.studentColliders>300);
        const capture=async(label,options={})=>{
          const pixels=await evaluate(captureStudentPixels,options);
          assert.equal(pixels.glError,0,label);assert.equal(pixels.contextLost,false,label);
          assert.ok(pixels.width>0&&pixels.height>0,`${label}: empty drawing buffer`);
          assert.ok(pixels.quantizedColors>8&&pixels.luminanceStddev>2,`${label}: blank/uninformative rendered frame`);
          const filename=`${name}-${label}.png`,absolute=path.join(output,filename);
          await page.locator('#application').screenshot({path:absolute,timeout:TIMEOUT_MS,animations:'disabled'});
          const screenshot={file:filename,sha256:createHash('sha256').update(await readFile(absolute)).digest('hex'),pixels};
          entry.screenshots.push(screenshot);await flush();return screenshot;
        };
        const fit=fitStudentExterior(await evaluate(studentExteriorInputs));entry.exteriorFit=fit;
        await evaluate(applyStudentExterior,fit);
        // Only student owners toggle for the control. Roads, terrain and neighboring buildings remain visible.
        await evaluate(()=>window.__studentCampusQA.owners.forEach(e=>{e.enabled=false;}));
        await capture('exterior-student-hidden-control',{exterior:true});
        await evaluate(()=>window.__studentCampusQA.owners.forEach(e=>{e.enabled=true;}));
        const exterior=await capture('exterior-student-visible',{compare:true,exterior:true});
        const bounds=exterior.pixels.framing;
        assert.ok(bounds.points>0&&bounds.minDepth>0,'complete exterior in front of camera');
        assert.ok(bounds.minX>=.06&&bounds.maxX<=.94&&bounds.minY>=.06&&bounds.maxY<=.94,`complete exterior framing: ${JSON.stringify(bounds)}`);
        assert.ok(exterior.pixels.changed>exterior.pixels.width*exterior.pixels.height*.002,'actual student geometry must visibly change the full campus frame');
        for(const [direction,route] of [['forward',STUDENT_LOOP],['reverse',[...STUDENT_LOOP].reverse()]]){
          const loop={direction,route,segments:[],start:await evaluate(resetStudentLoop,route[0])};entry.loops.push(loop);
          for(let i=1;i<route.length;i++){
            const segment=await evaluate(prepareStudentSegment,{from:route[i-1],to:route[i]});loop.segments.push(segment);
            const isCore=route[i][0]===-24&&route[i-1][0]===-24;
            const isExterior=route[i][0]===0&&route[i-1][0]===0;
            const stops=(isCore||isExterior)?[Math.floor(segment.steps/2),segment.steps]:[segment.steps];
            await page.keyboard.down('w');
            try{
              for(const until of stops){
                segment.result=await evaluate(tickStudentSegment,until);
                const checkpoint=until<segment.steps?(isCore?'core-a-stairs':'exterior-stairs'):
                  (route[i][0]===-14&&route[i][1]===1?'first-floor-entry':
                    route[i][0]===-24&&route[i][1]===-17?'upper-core-landing':
                      route[i][0]===0&&route[i][1]===-3?'second-floor-hall':null);
                if(checkpoint){
                  const camera=await evaluate(setStudentWalkthroughCamera);
                  const image=await capture(`${direction}-${checkpoint}`);image.camera=camera;image.walkedPose=segment.result.local;
                }
              }
            }finally{await page.keyboard.up('w');}
            assert.equal(await evaluate(()=>window.__INHAGAME_P0__.controller.keys.has('KeyW')),false,'trusted keyup reaches the controller');
          }
          loop.end=await evaluate(()=>{const q=window.__studentCampusQA,p=q.d.player.getLocalPosition();return {position:p.toArray(),feet:p.y-q.shape.footOffset,grounded:q.d.controller.grounded,space:q.d.controller.space.id};});
          assert.ok(Math.abs(loop.end.feet)<1e-6);assert.equal(loop.end.grounded,true);assert.equal(loop.end.space,'campus');await flush();
        }
        entry.input=await evaluate(()=>{const q=window.__studentCampusQA;return {events:q.input,ticks:q.ticks,initialPlacements:q.resets,remainingKeys:[...q.d.controller.keys],defaultController:q.d.controller.update===q.controllerUpdate&&q.d.controller.space===q.campusSpace};});
        assert.equal(entry.input.initialPlacements,2);assert.equal(entry.input.defaultController,true);assert.deepEqual(entry.input.remainingKeys,[]);
        assert.equal(entry.input.events.filter(e=>e.type==='keydown').length,18);assert.equal(entry.input.events.filter(e=>e.type==='keyup').length,18);
        assert.ok(entry.input.events.every(e=>e.trusted));assert.ok(entry.input.ticks>1500);
        assert.deepEqual(smoke.problems,[],`${name}: browser errors`);entry.result='PASS';
      }catch(error){entry.result='FAIL';entry.error=String(error.stack||error);entry.problems=smoke?.problems||[];throw error;}
      finally{if(smoke)await smoke.close();await flush();}
    }
    report.result='PASS';console.log(`Student center actual-campus Chromium evidence: PASS (${head})`);
  }catch(error){report.result='FAIL';report.error=String(error.stack||error);throw error;}
  finally{clearTimeout(watchdog);report.finishedAt=new Date().toISOString();await flush();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
