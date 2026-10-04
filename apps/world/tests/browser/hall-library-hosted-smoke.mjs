// Hosted-only actual WebGL2 evidence. No browser installation or credentials here.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {startSmoke} from './harness.mjs';

const BASELINE = '316c8ff95f7a12618ec8db61342d153f3cbb29ea';
const CURRENT_MAIN = 'c64d309eb3c8f9632feaf996ae65d45455353fda';
const PREVIOUS = '68d64e7466a2971256485b74e76c89a31e91547a';
const SOURCES = {
  '/__hall_library_baseline__/':{commit:BASELINE},
  '/__hall_library_current_main__/':{commit:CURRENT_MAIN},
  '/__hall_library_previous__/':{commit:PREVIOUS},
  '/__hall_library_baseline_current_materials__/':{commit:BASELINE,materialCommit:CURRENT_MAIN},
  '/__hall_library_previous_current_materials__/':{commit:PREVIOUS,materialCommit:CURRENT_MAIN}
};
function comparisonSource(relative,source) {
  return source.materialCommit&&['src/campus-render-kit.js','src/campus-material-profile.js'].includes(relative)?source.materialCommit:source.commit;
}
const output = process.env.WORLD_HALL_LIBRARY_QA_OUTPUT || 'test-results/hall-library-candidate';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const run = promisify(execFile);
const began = Date.now();
await mkdir(output, {recursive:true});
const reportPath = path.join(output,'report.json');
const report = {
  status:'RUNNING', startedAt:new Date().toISOString(), baselineCommit:BASELINE,currentMainCommit:CURRENT_MAIN,previousCandidateCommit:PREVIOUS,
  scope:'Current-main integration, literal #108/#144 history plus separately labeled current-material geometry controls, actual chunk lifecycle and actual music editor PlaceScenePreview route. No interior or measured floor-count claim.',
  approximation:'Main Hall retains illustrative four-row/nine-pier estimates; Jeongseok reuses the #108 exterior.',
  entranceRepair:{previousCoplanarCrossings:4,currentCrossings:0,clipU:[-1.75,1.75],belowY:2.85},
  limits:{operationMs:12000,pixelFrameMs:6000,overallMs:420000,cleanupMs:8000},
  comparisonSources:SOURCES,resolvedSources:[],baselineFiles:[], requests:{unexpectedRequests:[],api:[],offOrigin:[]}, cases:[], closeups:[], screenshots:[], progress:[]
};
const flush = () => writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const progress = async label => {
  const item={at:new Date().toISOString(),elapsedMs:Date.now()-began,label};
  report.progress.push(item); console.log(`[${item.at}] ${label}`); await flush();
};
async function withDeadline(label, operation, milliseconds=12000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label}: deadline ${milliseconds}ms exceeded`)),milliseconds);
  })]); } finally { clearTimeout(timer); }
}
// Last-resort process watchdog also bounds a stuck GPU/Playwright cleanup.
const watchdog=setTimeout(()=>{
  report.status='FAIL'; report.error='Overall hosted QA deadline exceeded';
  report.elapsedMs=Date.now()-began;
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n'); process.exit(1);
},420000);
let smoke, page, fatal;
const baselineCache=new Map();
function isBaselinePath(relative) {
  // The pinned renderer's transitive main-gate-production dependency reads this
  // one public editor document. Do not permit arbitrary editor or repository data.
  const scoped = /^(src\/[A-Za-z0-9_./-]+\.js|data\/reality\/[A-Za-z0-9_./-]+\.json)$/.test(relative)
    || relative === 'data/editor/main-gate.world.json';
  return scoped && !relative.split('/').some(part=>part==='.'||part==='..');
}
async function sourceAtBaseline(relative,commit=BASELINE) {
  if (!isBaselinePath(relative)) throw new Error('Unscoped baseline path: '+relative);
  const key=commit+':'+relative;
  if (!baselineCache.has(key)) {
    const {stdout}=await run('git',['show',`${commit}:apps/world/${relative}`],{cwd:repo,timeout:5000,maxBuffer:10*1024*1024,encoding:'buffer'});
    baselineCache.set(key,stdout);
    report.baselineFiles.push({commit,path:`apps/world/${relative}`,sha256:createHash('sha256').update(stdout).digest('hex')});
  }
  return baselineCache.get(key);
}
const checkPixels = pixels => {
  assert.equal(pixels.glError,0,'no GL error'); assert.equal(pixels.contextLost,false);
  assert.ok(pixels.foreground>100,'actual building pixels are present');
};
const checkStats = stats => {
  assert.equal(stats.device,'webgl2'); assert.equal(stats.activePresentations,1,'only one visible presentation');
  assert.equal(stats.scaleSign,stats.reflected?-1:1);
  assert.equal(stats.canvas.width,stats.canvas.cssWidth); assert.equal(stats.canvas.height,stats.canvas.cssHeight);
  assert.equal(stats.captionOverflows,false,'the complete two-line caption fits the viewport');
  assert.equal(stats.owners.length,3);
  for (const owner of stats.owners) {
    assert.equal(owner.owners,1,`${owner.tier}: exactly one owner`);
    assert.equal(owner.finite,true,`${owner.tier}: finite vertices and bounds`);
    if (owner.tier==='BASE') assert.ok(owner.meshes>0 && owner.vertices>0);
    // Jeongseok NEAR is legitimately empty; never require every tier to draw.
  }
};
const checkBounds = frame => {
  assert.ok(frame.points>0 && frame.minDepth>0);
  assert.ok(frame.minX>=.06 && frame.maxX<=.94 && frame.minY>=.06 && frame.maxY<=.94,JSON.stringify(frame));
};
const checkFrame = frame => { checkBounds(frame);assert.equal(frame.captionOverlapsCanvas,false); };
function checkEntranceCrop(pixels) {
  const roi=pixels.entryBounds;
  assert.ok(roi && Object.values(roi).every(Number.isFinite)
    && roi.minX>=0 && roi.maxX<=pixels.width && roi.maxX>roi.minX
    && roi.minY>=0 && roi.maxY<=pixels.height && roi.maxY>roi.minY,
  'entry ROI is finite, nonempty and entirely within the framebuffer');
  assert.ok(pixels.entryChanged>10,'central doorway sill pixels actually changed');
  // A cropped control view starts on the apron, not clear sky. Its corner-color
  // mask is a material diagnostic; only the fitted full-view gate proves silhouette.
}
try {
  const {stdout:head}=await run('git',['rev-parse','HEAD'],{cwd:repo,timeout:5000,encoding:'utf8'});
  report.candidateCommit=head.trim(); assert.match(report.candidateCommit,/^[0-9a-f]{40}$/);
  if (process.env.EXPECTED_HALL_HEAD) assert.equal(report.candidateCommit,process.env.EXPECTED_HALL_HEAD,'exact pull request head');
  if (process.env.GITHUB_RUN_ID) report.githubRunId=process.env.GITHUB_RUN_ID;
  const manifest=JSON.parse(await readFile(new URL('../fixtures/hall-library-candidate-source-manifest.json',import.meta.url),'utf8'));
  const {stdout:diff}=await run('git',['diff','--name-only',CURRENT_MAIN,'HEAD','--','apps/world/src','apps/world/data'],{cwd:repo,timeout:5000,encoding:'utf8'});
  const changedPaths=diff.trim().split('\n').filter(Boolean);
  for(const changed of changedPaths)assert.ok([...manifest.allowedRuntimeChanges,...manifest.allowedMetadataChanges].includes(changed),changed+' outside approved integration scope');
  report.preservation={baseline:CURRENT_MAIN,changedPaths,status:'PASS'};
  await progress('Validate pinned baseline and start offline real-engine browser');
  for(const commit of new Set(Object.values(SOURCES).map(source=>source.commit))) await sourceAtBaseline('src/main-hall-blockout.js',commit);
  smoke=await withDeadline('browser startup',()=>startSmoke({viewport:{width:1280,height:720},contextOptions:{deviceScaleFactor:1}}),30000);
  const html=await readFile(new URL('./hall-library-hosted-harness.html',import.meta.url),'utf8');
  const engineUrl=html.match(/"playcanvas":"([^"]+)"/)[1];
  smoke.context.on('request',request=>{
    const url=new URL(request.url());
    if (url.origin===smoke.origin && url.pathname.startsWith('/api/')) report.requests.api.push(url.pathname);
    if (url.origin!==smoke.origin && url.href!==engineUrl) report.requests.offOrigin.push(url.origin+url.pathname);
    if ((url.origin===smoke.origin && url.pathname.startsWith('/api/')) || (url.origin!==smoke.origin && url.href!==engineUrl)) report.requests.unexpectedRequests.push(url.origin+url.pathname);
  });
  for(const [PREFIX,source] of Object.entries(SOURCES)) await smoke.context.route(`**${PREFIX}**`,async route=>{
    try {
      const url=new URL(route.request().url());
      assert.equal(url.origin,smoke.origin);
      const relative=url.pathname.slice(PREFIX.length);
      const commit=comparisonSource(relative,source),body=await sourceAtBaseline(relative,commit);
      report.resolvedSources.push({namespace:PREFIX,path:relative,historicalCommit:source.commit,resolvedCommit:commit,sha256:createHash('sha256').update(body).digest('hex')});
      await route.fulfill({status:200,contentType:relative.endsWith('.json')?'application/json':'text/javascript; charset=utf-8',body});
    } catch(error) {
      const pathname=new URL(route.request().url()).pathname;
      report.requests.unexpectedRequests.push(`baseline route ${pathname}: ${String(error.message)}`);
      await route.abort('failed');
    }
  });
  page=await smoke.context.newPage(); fatal=smoke.watch(page);
  const evaluate = (label, fn, args) => withDeadline(label,()=>Promise.race([page.evaluate(fn,args),fatal]));
  const capture = () => evaluate('actual framebuffer read',()=>window.__HALL_LIBRARY_HOSTED_QA__.pixels());
  const view = options => evaluate('select presentation',options=>window.__HALL_LIBRARY_HOSTED_QA__.view(options),options);
  const shot = async (name,selector=null) => {
    await withDeadline('screenshot '+name,()=>(selector?page.locator(selector):page).screenshot({path:path.join(output,name+'.png'),timeout:10000}));
    report.screenshots.push(name+'.png');
  };

  async function verifyPreviewRoute() {
    await withDeadline('music route navigation',()=>Promise.race([page.goto(`${smoke.origin}/editor/music/`,{waitUntil:'domcontentloaded',timeout:30000}),fatal]),32000);
    await withDeadline('music route controls',()=>Promise.race([page.waitForFunction(()=>document.getElementById('music-place-preview-toggle')?.disabled===false,null,{timeout:30000}),fatal]),32000);
    // Capture the route-created instance without adding any production debug API.
    await evaluate('capture real preview instance',async()=>{
      const {PlaceScenePreview}=await import('/src/preview/place-scene-preview.js');
      const openPlace=PlaceScenePreview.prototype.openPlace;
      PlaceScenePreview.prototype.openPlace=function(place){window.__QA_REAL_PREVIEW__=this;return openPlace.call(this,place);};
    });
    const open = async()=>{
      await withDeadline('open preview control',()=>page.locator('#music-place-preview-toggle').click());
      await withDeadline('preview ready',()=>Promise.race([page.waitForFunction(()=>['ready','degraded'].includes(document.getElementById('music-place-preview-state')?.textContent),null,{timeout:22000}),fatal]),24000);
      assert.equal(await page.locator('#music-place-preview-state').textContent(),'ready');
    };
    const previewPixels=()=>evaluate('actual preview framebuffer',()=>new Promise((resolve,reject)=>{
      const app=window.__QA_REAL_PREVIEW__.app,timer=setTimeout(()=>reject(Error('Preview frame timeout')),6000);
      app.once('postrender',()=>{
        clearTimeout(timer);const gl=app.graphicsDevice.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,data=new Uint8Array(w*h*4),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);}
        const previous=window.__QA_PREVIEW_PIXELS__;let foreground=0,changed=0,hash=2166136261;
        for(let i=0;i<data.length;i+=4){
          if(Math.abs(data[i]-data[0])+Math.abs(data[i+1]-data[1])+Math.abs(data[i+2]-data[2])>15)foreground++;
          if(previous?.length===data.length&&Math.abs(data[i]-previous[i])+Math.abs(data[i+1]-previous[i+1])+Math.abs(data[i+2]-previous[i+2])>15)changed++;
          for(let k=0;k<3;k++)hash=Math.imul((hash^data[i+k])>>>0,16777619);
        }
        window.__QA_PREVIEW_PIXELS__=data;resolve({width:w,height:h,foreground,changed,hash:hash>>>0,glError:gl.getError(),contextLost:gl.isContextLost()});
      });app.renderNextFrame=true;
    }));
    await open();
    report.preview={route:'/editor/music/',defaultTarget:await page.locator('#music-place-preview-status').textContent(),targets:[]};
    assert.match(report.preview.defaultTarget,/PLACE_BIRYONG_TOWER/);
    for(const id of ['bldg_01','bldg_jungseok']){
      const receipt=await evaluate('real preview target '+id,async id=>{
        const {BUILDINGS}=await import('/src/basic-campus.js');
        const b=BUILDINGS.find(b=>b.id===id),position={x:b.vertices.reduce((s,p)=>s+p.x,0)/b.vertices.length,z:b.vertices.reduce((s,p)=>s+p.z,0)/b.vertices.length};
        const preview=window.__QA_REAL_PREVIEW__,old=preview.placeRoot;
        const status=preview.openPlace({id,label:id,position,previewRadius:0});
        const all=root=>[root,...root.children.flatMap(all)];
        const selected=['BASE','NEAR','DETAIL'].map(tier=>all(preview.placeRoot).filter(e=>e.name===`${id}_presentation_${tier}`));
        const owners=selected.map(list=>list.map(e=>({name:e.name,reflection:e.worldScaleSign})));
        window.__QA_PREVIEW_OWNERS__=selected.flat();window.__QA_PREVIEW_PIXELS__=null;
        const {photoLandmarkView,waitForDiagnosticFrame}=await import('/tests/browser/hall-library-hosted-views.js'),pc=await import('playcanvas');
        const points=selected.flat().flatMap(root=>root.findComponents('render').flatMap(c=>c.meshInstances)).flatMap(m=>{
          const min=m.aabb.getMin(),max=m.aabb.getMax();
          return [min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>[x,y,-z])));
        });
        const defaultCamera=preview.camera.getPosition().toArray();
        preview.camera.camera.fov=48;
        const fit=photoLandmarkView(id,preview.canvas.width/preview.canvas.height,{points});
        preview.camera.setPosition(fit.position[0],fit.position[1],-fit.position[2]);preview.camera.lookAt(fit.target[0],fit.target[1],-fit.target[2]);
        await waitForDiagnosticFrame(preview.app);
        const projected=points.map(([x,y,z])=>preview.camera.camera.worldToScreen(new pc.Vec3(x,y,-z))),width=preview.canvas.width,height=preview.canvas.height;
        const framing={points:points.length,minDepth:Math.min(...projected.map(p=>p.z)),minX:Math.min(...projected.map(p=>p.x/width)),maxX:Math.max(...projected.map(p=>p.x/width)),minY:Math.min(...projected.map(p=>p.y/height)),maxY:Math.max(...projected.map(p=>p.y/height))};
        return {status,owners,oldDetached:old.parent===null,device:preview.app.graphicsDevice.deviceType,framing,defaultCamera,cameraScope:'Public openPlace target; diagnostic camera fitted to actual target mesh bounds'};
      },id);
      assert.equal(receipt.device,'webgl2');assert.equal(receipt.status.placeId,id);assert.equal(receipt.oldDetached,true);
      for(const owners of receipt.owners){assert.equal(owners.length,1);assert.equal(owners[0].reflection,-1);}
      checkBounds(receipt.framing);
      receipt.visible=await previewPixels();checkPixels(receipt.visible);
      await evaluate('hide real preview landmark',()=>window.__QA_PREVIEW_OWNERS__.forEach(e=>{e.enabled=false;}));
      receipt.hidden=await previewPixels();assert.ok(receipt.hidden.changed>10,id+' real-preview targeted visibility delta');
      await evaluate('restore real preview landmark',()=>window.__QA_PREVIEW_OWNERS__.forEach(e=>{e.enabled=true;}));
      receipt.restored=await previewPixels();checkPixels(receipt.restored);assert.equal(receipt.restored.hash,receipt.visible.hash,'static preview target pixels exactly restore');
      report.preview.targets.push(receipt);
      await shot('desktop-real-preview-'+id,'#music-place-preview-shell');
    }
    await withDeadline('mobile real preview viewport',()=>page.setViewportSize({width:390,height:844}));
    report.preview.mobile=await evaluate('mobile actual preview sizing',async()=>{
      const preview=window.__QA_REAL_PREVIEW__;preview.resize();
      const canvas=preview.canvas,{photoLandmarkView}=await import('/tests/browser/hall-library-hosted-views.js');
      const points=window.__QA_PREVIEW_OWNERS__.flatMap(root=>root.findComponents('render').flatMap(c=>c.meshInstances)).flatMap(m=>{const min=m.aabb.getMin(),max=m.aabb.getMax();return [min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>[x,y,-z])));});
      const fit=photoLandmarkView(preview.status().placeId,canvas.width/canvas.height,{points});preview.camera.setPosition(fit.position[0],fit.position[1],-fit.position[2]);preview.camera.lookAt(fit.target[0],fit.target[1],-fit.target[2]);
      return {placeId:preview.status().placeId,width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,device:preview.app.graphicsDevice.deviceType};
    });
    assert.equal(report.preview.mobile.device,'webgl2');assert.ok(report.preview.mobile.width>0&&report.preview.mobile.height>0);
    assert.equal(report.preview.mobile.width,report.preview.mobile.cssWidth);assert.equal(report.preview.mobile.height,report.preview.mobile.cssHeight);
    report.preview.mobile.pixels=await previewPixels();checkPixels(report.preview.mobile.pixels);
    await shot('portrait-real-preview-library','#music-place-preview-shell');
    await withDeadline('close preview control',()=>page.locator('#music-place-preview-toggle').click());
    await withDeadline('preview closed',()=>page.waitForFunction(()=>document.getElementById('music-place-preview-state')?.textContent==='idle'));
    assert.equal(await evaluate('preview disposed',()=>window.__QA_REAL_PREVIEW__.closed&&window.__QA_REAL_PREVIEW__.app===null),true);
    await open();
    report.preview.reopened=await evaluate('fresh reopened instance',()=>({closed:window.__QA_REAL_PREVIEW__.closed,state:window.__QA_REAL_PREVIEW__.status().state,placeId:window.__QA_REAL_PREVIEW__.status().placeId}));
    assert.equal(report.preview.reopened.closed,false);assert.equal(report.preview.reopened.state,'ready');assert.equal(report.preview.reopened.placeId,'PLACE_BIRYONG_TOWER');
    await withDeadline('final preview close',()=>page.locator('#music-place-preview-toggle').click());
    await flush();
  }

  await withDeadline('fixture navigation',()=>Promise.race([page.goto(`${smoke.origin}/tests/browser/hall-library-hosted-harness.html`,{waitUntil:'domcontentloaded',timeout:20000}),fatal]),22000);
  await withDeadline('fixture readiness',()=>Promise.race([page.waitForFunction(()=>window.__HALL_LIBRARY_HOSTED_QA__?.ready||window.__HALL_LIBRARY_HOSTED_QA__?.error,null,{timeout:20000}),fatal]),22000);
  assert.equal(await evaluate('fixture error',()=>window.__HALL_LIBRARY_HOSTED_QA__.error),undefined);
  for (const [name,viewport] of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]) {
    await withDeadline('viewport resize',()=>page.setViewportSize(viewport));
    for (const id of ['bldg_01','bldg_jungseok']) for (const reflected of [true,false]) {
      const cell={name,viewport,id,reflected,status:'RUNNING'}; report.cases.push(cell);
      await progress(`${name} ${id} ${reflected?'reflected':'control'}: current main / literal #108 / literal #144 / current-material #108 / current-material #144 / candidate`);
      for (const presentation of ['currentmain','baseline108','previous144','baseline108materials','previous144materials','candidate']) {
        const stats=await view({id,presentation,reflected,detail:'all',mode:'full'}); checkStats(stats);
        const pixels=await capture(); checkPixels(pixels); cell[presentation]={stats,pixels};
        assert.equal(pixels.width,viewport.width,'drawing buffer follows each viewport');
        assert.equal(pixels.width,stats.canvas.cssWidth); assert.equal(pixels.height,stats.canvas.cssHeight);
        assert.equal(pixels.width<pixels.height,name==='portrait','actual framebuffer orientation');
        assert.ok(pixels.height>viewport.height*.65 && pixels.height<viewport.height,'caption remains outside canvas');
        if(presentation==='previous144'&&id==='bldg_jungseok')assert.equal(pixels.hash,cell.baseline108.pixels.hash,'literal historical Jeongseok parity remains exact');
        if (presentation==='candidate') {
          if (id==='bldg_jungseok') {
            assert.equal(pixels.exactChanged,0,'Jeongseok previous candidate parity under current-main materials');
            assert.equal(pixels.hash,cell.baseline108materials.pixels.hash,'Jeongseok exact #108 geometry pixels under current-main materials');
          } else {
            assert.equal(pixels.maskChanged,0,'entry repair preserves the pre-fix Main Hall silhouette');
            assert.notEqual(pixels.hash,cell.currentmain.pixels.hash,'activated Main Hall changes current-main pixels');
          }
        }
        if (reflected && ((name==='desktop' && ['currentmain','candidate'].includes(presentation)) || (name!=='desktop' && presentation==='candidate'))) await shot(`${name}-${id}-${presentation}-reflected`);
      }
      cell.framing=await evaluate('full silhouette framing',()=>window.__HALL_LIBRARY_HOSTED_QA__.framing()); checkFrame(cell.framing);
      cell.stable=await capture(); checkPixels(cell.stable);
      assert.equal(cell.stable.exactChanged,0,'stationary exact pixels'); assert.equal(cell.stable.hash,cell.candidate.pixels.hash);
      if (name==='desktop' && reflected) {
        cell.lifecycle=await evaluate('detach, remount, destroy, rebuild',()=>window.__HALL_LIBRARY_HOSTED_QA__.lifecycle()); checkStats(cell.lifecycle.stats);
        for (const r of cell.lifecycle.receipt) { for (const key of ['repeated','detached','remounted','rebuilt']) assert.equal(r[key],true,`${r.tier} ${key}`); assert.equal(r.meshesBefore,r.meshesAfter); }
        cell.rebuilt=await capture(); checkPixels(cell.rebuilt); assert.equal(cell.rebuilt.exactChanged,0,'lifecycle rebuild preserves pixels');
        const baseStats=await view({detail:'base'}); checkStats(baseStats); cell.baseOnly=await capture(); checkPixels(cell.baseOnly);
        assert.ok(cell.baseOnly.changed>10,'detail visibility actually changes pixels');
        await view({detail:'all'}); cell.reattached=await capture(); checkPixels(cell.reattached); assert.equal(cell.reattached.hash,cell.candidate.pixels.hash,'tier re-enable restores pixels');
      }
      cell.status='PASS'; await flush();
      assert.deepEqual(smoke.problems,[]); assert.deepEqual(report.requests.unexpectedRequests,[]);
    }
  }
  // Adjacent pre-fix/fixed captures prove actual changed entrance pixels and stable frames.
  await withDeadline('closeup viewport',()=>page.setViewportSize({width:1280,height:720}));
  for (const reflected of [true,false]) for (const presentation of ['previous144','previous144materials','candidate']) {
    await progress(`Main Hall entrance oblique closeup: ${presentation} ${reflected?'reflected':'control'}`);
    checkStats(await view({id:'bldg_01',presentation,reflected,detail:'all',mode:'entry'}));
    const pixels=await capture(), stable=await capture(); checkPixels(pixels); checkPixels(stable);
    assert.equal(stable.exactChanged,0); assert.equal(stable.hash,pixels.hash);
    if(presentation==='candidate') {
      checkEntranceCrop(pixels);
    }
    report.closeups.push({id:'bldg_01',presentation,reflected,mode:'entry',scope:presentation==='previous144'?'Literal historical #144 entrance crop':'Entrance crop under the current-main material producer, not full-building framing',maskInterpretation:'Corner-color diagnostic only; full-building silhouette is checked in fitted views',pixels,stable});
    await shot(`desktop-bldg_01-${presentation}-entrance-${reflected?'reflected':'control'}`); await flush();
  }
  await progress('Actual CampusChunkRenderer: ACTIVE / FAR / ACTIVE ownership and pixels');
  report.campus=await evaluate('actual campus lifecycle',()=>window.__HALL_LIBRARY_HOSTED_QA__.campusLifecycle());
  for(const cell of report.campus.receipt)for(const key of ['hidden','reused','restored','reflection'])assert.equal(cell[key],true,`${cell.id} campus ${key}`);
  report.campus.targets=[];
  for(const id of ['bldg_01','bldg_jungseok']) {
    const frame=await evaluate('actual target framing '+id,id=>window.__HALL_LIBRARY_HOSTED_QA__.campusView(id),id);checkFrame(frame);
    const visible=await capture();checkPixels(visible);
    await evaluate('hide actual target '+id,id=>window.__HALL_LIBRARY_HOSTED_QA__.campusVisibility(id,false),id);
    const hidden=await capture();assert.ok(hidden.changed>10,id+' actual-campus targeted visibility delta');
    await evaluate('restore actual target '+id,id=>window.__HALL_LIBRARY_HOSTED_QA__.campusVisibility(id,true),id);
    const restored=await capture();checkPixels(restored);
    // Water elsewhere in the actual campus animates, so global exact hashes are intentionally not asserted.
    assert.ok(restored.changed>10,id+' actual-campus target returns');
    report.campus.targets.push({id,frame,visible,hidden,restored});
    await shot('desktop-actual-campus-'+id);
  }
  await withDeadline('mobile actual campus viewport',()=>page.setViewportSize({width:390,height:844}));
  report.campus.mobile=await evaluate('mobile actual campus camera',()=>window.__HALL_LIBRARY_HOSTED_QA__.campusView('bldg_01'));
  assert.equal(report.campus.mobile.width,390);assert.equal(report.campus.mobile.reflection,-1);checkFrame(report.campus.mobile);
  report.campus.mobile.pixels=await capture();checkPixels(report.campus.mobile.pixels);
  await shot('portrait-actual-campus-integrated');
  await withDeadline('restore desktop for actual music route',()=>page.setViewportSize({width:1280,height:720}));
  report.campus.destroy=await evaluate('campus cleanup',()=>window.__HALL_LIBRARY_HOSTED_QA__.disposeCampus());
  assert.equal(report.campus.destroy.fadesAfterDestroy,0);
  await progress('Actual /editor/music/ route: open, landmark public targets, close and reopen');
  await verifyPreviewRoute();
  assert.deepEqual(smoke.problems,[]); assert.deepEqual(report.requests.unexpectedRequests,[]);
  assert.equal(report.cases.length,12); assert.equal(report.screenshots.length,20);
  report.status='PASS'; await progress('12 comparison cells, real campus lifecycle, real preview route, and 20 screenshots complete');
} catch(error) {
  report.status='FAIL'; report.error=String(error.stack||error); process.exitCode=1;
  console.error(report.error);
} finally {
  report.problems=smoke?.problems || []; report.finishedAt=new Date().toISOString(); report.elapsedMs=Date.now()-began;
  await flush();
  try { if(smoke) await withDeadline('browser cleanup',()=>smoke.close(),8000); }
  catch(error) { report.status='FAIL'; report.cleanupError=String(error); process.exitCode=1; }
  await flush(); clearTimeout(watchdog);
  // startSmoke can fail after spawning its server but before returning handles.
  // A failed run must still exit after persisting evidence, even with orphan pipes.
  if (report.status!=='PASS') setTimeout(()=>process.exit(1),1000);
}
