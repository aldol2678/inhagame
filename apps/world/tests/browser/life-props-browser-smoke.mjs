// Hosted Chromium/WebGL2 QA only. Use the committed pinned browser package.
// WORLD_SMOKE_DISABLE_WEBGPU=1 EXPECTED_ASSET_RUNTIME_HEAD=<exact SHA> node apps/world/tests/browser/life-props-browser-smoke.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startSmoke } from './harness.mjs';
import { HAND_CONTACT_LIMITS } from './life-props-browser-contact.mjs';
import { ENGINE_URL,LIFE_VIEWPORTS,allowedFixtureRequest } from './life-props-browser-helpers.mjs';
import { LIFE_PROP_MODELS,NPC_ACTIVITY_PROPS,CLUB_TABLE_PROPS } from '../../src/life-props.js';

const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const output=path.resolve(process.env.LIFE_PROPS_BROWSER_OUTPUT||'test-results/asset-runtime/life');
await mkdir(output,{recursive:true});
const reportPath=path.join(output,'report.json'),began=Date.now(),sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const report={contactQaBaseHead:'490c54d981720d4811f22785762d89bd5ac07a38',integrationBaseHead:'2d1ffcf2da90611d7d3ae0c43f06ca3b1817ca20',status:'RUNNING',startedAt:new Date().toISOString(),scope:'Synthetic production-helper WebGL2 fixture with real local HTTP GLBs, not full campus gameplay',
  caveats:['Existing straight shoulder-only arms are unchanged','Primary-hand mesh surface contact, not two-handed grip','PHOTO prop remains below face level','Room table is isolated only for diagnostic screenshots','Hand/forearm clearance uses all prop triangles against transformed geometry-derived sphere/capsule envelopes; contact gap uses actual hand triangles'],
  engineExpected:'2.22.4',expectedHead:process.env.EXPECTED_ASSET_RUNTIME_HEAD||null,sources:[],responses:[],requests:[],blocked:[],cases:[],screenshots:[],progress:[]};
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const progress=async label=>{report.progress.push({label,elapsedMs:Date.now()-began});console.log(label);await save();};
async function deadline(label,fn,ms=15000){let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} exceeded ${ms}ms`)),ms);})]);}finally{clearTimeout(timer);}}
const watchdog=setTimeout(()=>{report.status='FAIL';report.error='Overall browser deadline exceeded (420000ms)';writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');process.exit(1);},420000);
const approx=(actual,expected,message,tolerance=2e-6)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${message}: ${actual} != ${expected}`);
const vector=(actual,expected,message,tolerance)=>{assert.equal(actual.length,expected.length);actual.forEach((n,i)=>approx(n,expected[i],message+' '+i,tolerance));};
const pixels=(p,requireForeground=true)=>{assert.equal(p.glError,0);assert.equal(p.contextLost,false);if(requireForeground)assert.ok(p.foreground>20,'actual rendered foreground');};
const framing=f=>{assert.ok(f.points>0&&f.minDepth>0);assert.ok(f.minX>=.075&&f.maxX<=.925&&f.minY>=.075&&f.maxY<=.925,JSON.stringify(f));assert.equal(f.width,f.cssWidth);assert.equal(f.height,f.cssHeight);assert.equal(f.captionOverlapsCanvas,false);assert.equal(f.labelOverflows,false);};
const contribution=c=>{pixels(c.on);pixels(c.off,false);pixels(c.restored);assert.ok(c.off.roiChanged>3,`${c.id} contributes visible pixels in its own bounds`);assert.equal(c.restored.hash,c.on.hash,'unchanged scene is restored after prop visibility control');};
const spec=JSON.parse(await readFile(new URL('../../assets/life-props-v1/attachment-spec.json',import.meta.url),'utf8'));
function asset(stats,id){const source=spec.assets.find(a=>a.id===id);assert.equal(stats.id,id);assert.ok(stats.meshes>0);assert.equal(stats.triangles,source.triangles);vector(stats.scale,[.5,.5,.5],id+' world scale');for(const [name,p]of Object.entries(source.anchors_gltf_metres)){assert.ok(stats.anchors[name],id+' '+name);vector(stats.anchors[name].local,p,id+' '+name);}assert.equal(stats.collision,0);assert.equal(stats.rigidbody,0);}
function npc(stats,activity,phase){assert.equal(stats.activity,activity);assert.equal(stats.phase,phase);assert.equal(stats.count,1);assert.equal(stats.reflection,-1);assert.ok(stats.fallback.every(x=>!x.enabled));const binding=NPC_ACTIVITY_PROPS[activity];asset(stats.prop,binding.id);assert.equal(stats.prop.parent,'ArmPivot_-1');assert.equal(stats.prop.parentIsPrimaryArm,true);vector(stats.prop.localRotation,binding.rotation,activity+' binding orientation');vector(stats.prop.handReferencePosition,stats.handPosition,activity+' hand reference');const contact=stats.prop.contact;assert.equal(contact.triangleCount,stats.prop.triangles);assert.ok(contact.handTriangleCount>0);assert.ok(contact.minimumEnvelopeClearance>=HAND_CONTACT_LIMITS.minimumEnvelopeClearance,activity+' minimum surface clearance '+JSON.stringify(contact));assert.ok(contact.penetrationDepthWorld<=HAND_CONTACT_LIMITS.maximumPenetrationWorld,activity+' avoids hand penetration '+JSON.stringify(contact));assert.ok(contact.contactGapWorld<=HAND_CONTACT_LIMITS.maximumGapWorld,activity+' remains in hand contact '+JSON.stringify(contact));assert.equal(contact.acceptable,true);assert.equal(stats.prop.forearmClearance.triangleCount,stats.prop.triangles);assert.equal(stats.prop.forearmClearance.acceptable,true,activity+' avoids wrist/forearm penetration '+JSON.stringify(stats.prop.forearmClearance));vector(stats.prop.localScale,[.5/stats.worldScale,.5/stats.worldScale,.5/stats.worldScale],activity+' compensates avatar height');if(activity==='PHOTO')assert.ok(stats.prop.position[1]<stats.facePosition[1]-.05,'existing below-face camera limit is explicit');}
function room(stats){assert.equal(stats.reflection,-1);assert.equal(stats.models.length,4);for(const model of stats.models){asset(model,model.id);vector(model.anchors.rest.world,model.restTarget,model.id+' table rest');approx(model.anchors.rest.world[1],stats.tableTop,model.id+' table surface');assert.ok(model.bounds.min[1]>=stats.tableTop-.003,model.id+' no table penetration');assert.ok(model.bounds.min[0]>=-1.1 && model.bounds.max[0]<=1.1,model.id+' table X fit');assert.ok(model.bounds.min[2]>=-.85 && model.bounds.max[2]<=.05,model.id+' table Z fit');if(model.fallback)assert.equal(model.fallback.enabled,false);}}
let smoke,page,fatal;const responseReads=[];
try {
  report.head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();assert.match(report.head,/^[0-9a-f]{40}$/);
  if(report.expectedHead)assert.equal(report.head,report.expectedHead,'exact hosted asset-runtime HEAD');
  report.githubRunId=process.env.GITHUB_RUN_ID||null;
  report.fixtureFiles=execFileSync('git',['ls-files','--error-unmatch','apps/world/tests/browser/life-props-browser-contact.mjs','apps/world/tests/browser/life-props-browser-fixture.mjs','apps/world/tests/browser/life-props-browser-harness.html','apps/world/tests/browser/life-props-browser-helpers.mjs','apps/world/tests/browser/life-props-browser-smoke.mjs'],{cwd:repo,encoding:'utf8'}).trim().split('\n');
  report.worktree=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repo,encoding:'utf8'}).trim();
  assert.equal(report.worktree,'','tracked sources match the recorded commit');
  const files=['data/reality/campus-landmarks.json','npc-factory/dev-human-avatar.mjs','npc-factory/npc-dimensions.mjs','npc-factory/purposeful-activity-motion.mjs','npc-factory/purposeful-activity-props.mjs','src/life-props.js','src/appearance/equipment-asset-loader.js','src/rooms/club-room-renderer.js','src/rooms/club-room-layout.js','src/rooms/club-room-life-props.js','src/rooms/personal-room-fixture-model.js','assets/life-props-v1/attachment-spec.json','assets/life-props-v1/manifest.json',...Object.values(LIFE_PROP_MODELS).map(url=>url.slice(1))];
  for(const file of files){const bytes=await readFile(new URL('../../'+file,import.meta.url));report.sources.push({path:'apps/world/'+file,bytes:bytes.length,sha256:sha(bytes)});}
  report.engineSha256=sha(await readFile(new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url)));
  process.env.WORLD_SMOKE_DISABLE_WEBGPU='1';
  await progress('Start isolated real WebGL2 life-prop fixture');
  smoke=await deadline('browser startup',()=>startSmoke({viewport:{width:LIFE_VIEWPORTS[0].width,height:LIFE_VIEWPORTS[0].height},contextOptions:{deviceScaleFactor:1}}),30000);
  // Last registered route executes first. Reject methods/API/off-origin traffic
  // before the shared offline harness could turn an accidental API call into a 204.
  await smoke.context.route('**/*',async route=>{
    const request=route.request();
    if(!allowedFixtureRequest(request.url(),request.method(),smoke.origin)){report.blocked.push({url:request.url(),method:request.method()});return route.abort('blockedbyclient');}
    return route.fallback();
  });
  smoke.context.on('request',request=>report.requests.push({url:request.url(),method:request.method(),viewport:report.activeViewport}));
  smoke.context.on('response',response=>{
    const url=new URL(response.url()),viewport=report.activeViewport;
    if(url.href===ENGINE_URL || /\.(?:glb|mjs|js|json)$/.test(url.pathname)) responseReads.push((async()=>{
      const body=await response.body();report.responses.push({url:response.url(),path:url.pathname,status:response.status(),bytes:body.length,sha256:sha(body),viewport});
    })().catch(error=>{report.blocked.push({response:response.url(),error:String(error)});}));
  });
  const evaluate=(label,fn,args)=>deadline(label,()=>Promise.race([page.evaluate(fn,args),fatal]));
  const call=(name,...args)=>evaluate(name,({name,args})=>window.__LIFE_PROPS_BROWSER_QA__[name](...args),{name,args});
  async function shot(name){await deadline('screenshot '+name,()=>page.screenshot({path:path.join(output,name+'.png'),timeout:12000}));report.screenshots.push(name+'.png');}
  for(const viewport of LIFE_VIEWPORTS){
    report.activeViewport=viewport.name;await progress('Verify '+viewport.name+' '+viewport.width+'x'+viewport.height);
    page=await smoke.context.newPage();await page.setViewportSize({width:viewport.width,height:viewport.height});fatal=smoke.watch(page);
    await deadline('fixture navigation',()=>Promise.race([page.goto(smoke.origin+'/tests/browser/life-props-browser-harness.html',{waitUntil:'domcontentloaded'}),fatal]),30000);
    await deadline('real engine ready',()=>Promise.race([page.waitForFunction(()=>window.__LIFE_PROPS_BROWSER_QA__?.ready || window.__LIFE_PROPS_BROWSER_QA__?.error),fatal]),30000);
    assert.equal(await evaluate('fixture startup error',()=>window.__LIFE_PROPS_BROWSER_QA__.error),undefined);
    const initial=await call('stats');assert.equal(initial.engine,'2.22.4');assert.equal(initial.device,'webgl2');assert.ok(initial.gpu.version.includes('WebGL 2'));assert.equal(initial.room.enabled,false);assert.equal(initial.room.models.length,0);assert.ok(initial.room.cache.every(a=>!a.loaded),'construction does not fetch optional room or NPC models');
    const result={viewport,initial,npc:[],heights:[],fallbacks:null,races:null,room:null};report.cases.push(result);
    for(const activity of Object.keys(NPC_ACTIVITY_PROPS)){
      const baseline=await call('setActivity',activity,0);npc(baseline,activity,0);
      const full=await call('view','npc-full');framing(full.framing);const fullPixels=await call('pixels');pixels(fullPixels);await shot(`${viewport.name}-npc-${activity.toLowerCase()}-full`);
      const side=await call('view','npc-contact-side');framing(side.framing);const sideVisible=await call('contribution');contribution(sideVisible);await shot(`${viewport.name}-npc-${activity.toLowerCase()}-contact-side-phase0`);
      const hand=await call('view','npc-hand');framing(hand.framing);const visible=await call('contribution');contribution(visible);await shot(`${viewport.name}-npc-${activity.toLowerCase()}-hand-phase0`);
      const moving=await call('setActivity',activity,2);npc(moving,activity,2);
      // Keep the camera fixed while comparing motion. READING is a static pose.
      const movedPixels=await call('pixels');pixels(movedPixels);
      const distance=Math.hypot(...moving.prop.position.map((n,i)=>n-baseline.prop.position[i]));
      if(activity==='READING'){approx(distance,0,'reading remains intentionally still');assert.equal(movedPixels.hash,visible.restored.hash);}else{assert.ok(distance>.001,activity+' hand actually moved');assert.ok(movedPixels.changed>3,activity+' changed actual GPU pixels');}
      const movingView=await call('view','npc-hand');framing(movingView.framing);const movingVisible=await call('contribution');contribution(movingVisible);await shot(`${viewport.name}-npc-${activity.toLowerCase()}-hand-phase2`);
      const movingSide=await call('view','npc-contact-side');framing(movingSide.framing);const movingSideVisible=await call('contribution');contribution(movingSideVisible);await shot(`${viewport.name}-npc-${activity.toLowerCase()}-contact-side-phase2`);
      result.npc.push({activity,baseline,full,fullPixels,side,sideVisible,hand,visible,moving,movedPixels,distance,movingView,movingVisible,movingSide,movingSideVisible});
    }
    for(const height of [.9,1,1.1]){await call('newNpc',height);for(const activity of Object.keys(NPC_ACTIVITY_PROPS))for(const phase of [0,2]){const measured=await call('setActivity',activity,phase);npc(measured,activity,phase);result.heights.push(measured);}}
    result.fallbacks=await call('fallbacks');for(const receipt of result.fallbacks.receipt){assert.equal(receipt.destroyed,true);assert.equal(receipt.stats.count,0);assert.ok(receipt.stats.fallback.every(x=>x.enabled),receipt.name+' restores original book');}assert.equal(result.fallbacks.unchanged.same,true);assert.equal(result.fallbacks.unchanged.requestsBefore,result.fallbacks.unchanged.requestsAfter);
    const restoredView=await call('setActivity',null);assert.equal(restoredView.count,0);await call('view','npc-full');pixels(await call('pixels'));await shot(viewport.name+'-npc-fallback-restored');
    result.races=await call('npcRaces');assert.deepEqual(result.races.arrivalOrder,['compact_camera','open_book']);assert.equal(result.races.switched.length,2);assert.equal(result.races.switched[0].destroyed,true);assert.equal(result.races.switched[0].parent,null);assert.equal(result.races.switched[1].destroyed,false);assert.equal(result.races.switchedStats.prop.id,'compact_camera');assert.equal(result.races.switchedStats.count,1);assert.ok(result.races.disposed.every(x=>x.destroyed&&x.parent===null));assert.equal(result.races.disposedStats.count,0);assert.ok(result.races.disposedStats.fallback.every(x=>x.enabled));assert.equal(result.races.requestsAfterDispose,0);assert.ok(result.races.destroyed.every(x=>x.destroyed&&x.parent===null));assert.equal(result.races.avatarDetached,true);
    const enter=await call('enterRoom');room(enter);const tableView=await call('view','room-table');framing(tableView.framing);pixels(await call('pixels'));await shot(viewport.name+'-club-table');
    const tableProps=[];
    for(const binding of CLUB_TABLE_PROPS){const fit=await call('view','room-prop',binding.id);framing(fit.framing);const visible=await call('contribution',binding.id);contribution(visible);await shot(`${viewport.name}-club-${binding.id}`);tableProps.push({id:binding.id,fit,visible});}
    const lifecycle=await call('roomLifecycle');assert.equal(lifecycle.hidden,true);assert.equal(lifecycle.reused,true);assert.equal(lifecycle.count,4);assert.equal(lifecycle.destroyed.length,4);assert.equal(lifecycle.oldDetached,true);assert.equal(lifecycle.cachePreserved,true);assert.equal(lifecycle.lazy,true);assert.equal(lifecycle.recreated,true);room(lifecycle.stats);
    await call('view','room-table');pixels(await call('pixels'));await shot(viewport.name+'-club-reentry');
    const disposed=await call('roomRace');assert.equal(disposed.callbacks,4);assert.equal(disposed.countAfterDispose,0);assert.equal(disposed.detached,true);assert.ok(disposed.cache.every(a=>a.loaded),'shared seven GLB containers survive all instance disposal');
    result.room={enter,tableView,tableProps,lifecycle,disposed};
    await call('destroy');await Promise.all(responseReads);await page.close();page=null;
    const requiredDataPath='/data/reality/campus-landmarks.json';
    const dataRequests=report.requests.filter(r=>r.viewport===viewport.name&&new URL(r.url).pathname===requiredDataPath);
    assert.equal(dataRequests.length,1,'actual reality-adapter static-data request');
    const dataResponse=report.responses.find(r=>r.viewport===viewport.name&&r.path===requiredDataPath);
    const dataSource=report.sources.find(s=>s.path==='apps/world'+requiredDataPath);
    assert.ok(dataResponse,'required static-data response evidence');assert.equal(dataResponse.status,200);
    assert.equal(dataResponse.bytes,dataSource.bytes,'required static-data payload length');
    assert.equal(dataResponse.sha256,dataSource.sha256,'required static-data payload matches recorded source');
    result.requiredStaticData={path:requiredDataPath,requests:dataRequests.length,bytes:dataResponse.bytes,sourceSha256:dataSource.sha256,responseSha256:dataResponse.sha256};
    const glbs=report.requests.filter(r=>r.viewport===viewport.name&&r.url.endsWith('.glb'));
    assert.equal(glbs.length,7,'one HTTP request per GLB per app, including cached room reentry');
    for(const [id,url]of Object.entries(LIFE_PROP_MODELS)){
      assert.equal(glbs.filter(r=>new URL(r.url).pathname===url).length,1,id+' real request and cache reuse');
      const response=report.responses.find(r=>r.viewport===viewport.name&&r.path===url);assert.ok(response,id+' response evidence');assert.equal(response.status,200);assert.equal(response.sha256,report.sources.find(s=>s.path==='apps/world'+url).sha256,id+' served bytes match recorded asset');
    }
    await save();
  }
  await Promise.all(responseReads);assert.equal(report.blocked.length,0,JSON.stringify(report.blocked));assert.deepEqual(smoke.problems,[]);
  assert.ok(report.responses.some(r=>r.url===ENGINE_URL&&r.sha256===report.engineSha256),'browser used the pinned engine bytes');
  report.status='PASS';await progress('All three WebGL2 viewports and lifecycle gates passed');
} catch(error){report.status='FAIL';report.error=error.stack||String(error);process.exitCode=1;if(page&&!page.isClosed())try{await deadline('failure screenshot',()=>page.screenshot({path:path.join(output,'failure.png'),timeout:5000}),6000);report.screenshots.push('failure.png');}catch(screenshotError){report.failureScreenshotError=String(screenshotError);}}
finally{
  report.problems=smoke?.problems||[];
  if(smoke)try{await deadline('browser cleanup',()=>smoke.close(),10000);}catch(error){report.cleanupError=String(error);report.status='FAIL';process.exitCode=1;}
  clearTimeout(watchdog);report.elapsedMs=Date.now()-began;delete report.activeViewport;await save();console.log(JSON.stringify({status:report.status,head:report.head,output,elapsedMs:report.elapsedMs,error:report.error},null,2));
  // startSmoke can fail after opening its server but before returning a handle.
  // A flushed terminal failure must not leave that partial startup holding CI open.
  if(report.status!=='PASS')process.exit(1);
}
