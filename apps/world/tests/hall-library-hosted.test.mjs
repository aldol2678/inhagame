import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {jeongseokExteriorRegions,projectedConvexHull,insideProjectedRegion,projectJeongseokExteriorRegions,photoLandmarkView,jeongseokEntryView} from './browser/hall-library-hosted-views.js';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('hosted integration evidence covers real consumers and entrance pixel repair', () => {
  const harness = read('./browser/hall-library-hosted-harness.html');
  for (const text of ['CampusChunkRenderer', 'RenderChunkRegistry', 'gl.readPixels', 'entryChanged', 'maskChanged', 'webglcontextlost']) assert.ok(harness.includes(text), text);
  const runner = read('./browser/hall-library-hosted-smoke.mjs');
  for (const text of ['1c6f43b36962f65f75cddd55b8661bb3aa4a268d', '316c8ff95f7a12618ec8db61342d153f3cbb29ea', '68d64e7466a2971256485b74e76c89a31e91547a', '/editor/music/', 'PlaceScenePreview', 'withDeadline', '1280', '720', '390', '844', 'unexpectedRequests', 'entryChanged', 'report.json']) assert.ok(runner.includes(text), text);
  assert.doesNotMatch(harness, /NullGraphicsDevice|data:image/);
  assert.ok(existsSync(new URL('./browser/hall-library-integration-null-smoke.mjs', import.meta.url)));
});

test('historical source routes reject arbitrary files and traversal', () => {
  const runner = read('./browser/hall-library-hosted-smoke.mjs');
  const source = runner.match(/function isBaselinePath\(relative\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const allowed = runInNewContext(`(${source})`, {}, {timeout:1000});
  for (const name of ['src/main-hall-blockout.js', 'src/editor/main-gate-production.js', 'data/reality/campus-buildings.json', 'data/reality/evidence/roads/back-gate.json', 'data/editor/main-gate.world.json']) assert.equal(allowed(name),true,name);
  for (const name of ['data/private.json','src/../private.js','src/./main.js','../src/main.js','/src/main.js','data/editor/other.world.json','.git/config','src/secret.txt','https://example.com/src/main.js']) assert.equal(allowed(name),false,name);
});

test('current-main preservation allows the original nine runtime files plus two exact exterior files', () => {
  const manifest = JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
  assert.equal(manifest.currentMain, '1c6f43b36962f65f75cddd55b8661bb3aa4a268d');
  assert.equal(manifest.allowedRuntimeChanges.length,11);
  assert.equal(new Set(manifest.allowedRuntimeChanges).size,11);
  assert.deepEqual(manifest.allowedMetadataChanges,['apps/world/data/reality/hall-library-integration.provenance.json']);
  assert.deepEqual(manifest.allowedRuntimeChanges,[
    'main-hall-blockout.js','photo-hall-library-geometry.js','roadview-details.js',
    'main-hall-candidate-geometry.js','main-hall-candidate-renderer.js',
    'jeongseok-candidate-renderer.js','campus-landmark-candidate-selector.js',
    'campus-chunk-renderer.js','preview/place-scene-preview.js',
    'library-approaches.js','jeongseok-entry-geometry.js'
  ].map(name=>'apps/world/src/'+name));
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  assert.match(runner,/changedPaths/);
  assert.match(runner,/outside approved integration scope/);
  assert.ok(!manifest.allowedRuntimeChanges.some(name=>/facility|student|environment|collision|reality/.test(name)));
});

test('current PR scope may explicitly include surroundings but never unrelated activity changes',()=>{
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const helper=runner.match(/function hallIntegrationScopePaths\(manifest,extension\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper,'explicit bounded scope extension helper is required');
  const allow=runInNewContext(`(${helper})`,{}, {timeout:1000});
  const manifest=JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
  const original=allow(manifest,''),surroundings=allow(manifest,'surroundings');
  assert.equal(original.length,16);assert.equal(surroundings.length,22);
  for(const path of ['main.js','campus-contact-shading.js','campus-contact-shading-layout.js','campus-contact-shading-geometry.js'])assert.ok(original.includes('apps/world/src/'+path),'bounded contact pilot is allowed');
  for(const path of ['apps/world/src/pond-surroundings-geometry.js','apps/world/src/main-hall-walkway-layout.js','apps/world/src/main-hall-walkway-geometry.js','apps/world/src/campus-grounds.js','apps/world/src/minimap/minimap-data.js','apps/world/src/navigation/campus-navigation.js']){
    assert.ok(surroundings.includes(path));assert.ok(!original.includes(path));
  }
  for(const allowed of [original,surroundings])for(const path of ['apps/world/src/activity/activity-contract.js','apps/world/src/ambient-ducks.js','apps/world/src/campus-layout.js'])assert.ok(!allowed.includes(path),path+' remains forbidden');
  assert.throws(()=>allow(manifest,'all-runtime'),/scope/);
  assert.match(runner,/WORLD_HALL_LIBRARY_SCOPE_BASE/);
  assert.match(runner,/\$\{scopeBase\}\.\.\.HEAD/,'scope uses the actual PR merge base');
  const workflow=read('../../../.github/workflows/hall-library-candidate-browser.yml');
  assert.match(workflow,/WORLD_HALL_LIBRARY_SCOPE_BASE: \$\{\{ github.event.pull_request.base.sha \}\}/);
});

test('workflow checks exact head, offline evidence and a bounded read-only job', () => {
  const workflow = read('../../../.github/workflows/hall-library-candidate-browser.yml');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /hall-library-integration-null-smoke.mjs/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|deploy|--force|contents: write/);
});

test('entry crop validates doorway pixels without treating apron color as a full silhouette', () => {
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const crop=runner.slice(runner.indexOf('// Adjacent pre-fix/fixed captures'));
  const body=crop.match(/if\(presentation==='candidate'\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(body,'the real candidate-entry assertion block is exercised');
  const helper=runner.match(/function checkEntranceCrop\(pixels\) \{[\s\S]*?\n\}/)?.[0]??'';
  const validate=runInNewContext(`${helper}\n(pixels)=>{${body}}`,{assert},{timeout:1000});
  const valid={width:1280,height:653,entryChanged:1031,maskChanged:2,maskReferenceRgb:[196,195,179],entryBounds:{minX:530.4,maxX:747.8,minY:357.1,maxY:400.4}};
  assert.doesNotThrow(()=>validate(valid),'a control crop corner is apron, so color-mask differences are not silhouette evidence');
  assert.throws(()=>validate({...valid,entryChanged:0}),/doorway/);
  assert.throws(()=>validate({...valid,entryBounds:{...valid.entryBounds,minX:-1}}),/ROI/);
  assert.throws(()=>validate({...valid,entryBounds:{...valid.entryBounds,maxY:Infinity}}),/ROI/);
  assert.match(runner,/assert\.equal\(pixels\.maskChanged,0,'entry repair preserves the pre-fix Main Hall silhouette'\)/,'full-view silhouette gate stays exact');
  assert.match(crop,/assert\.equal\(stable\.exactChanged,0\)/,'cropped stationary frames remain exact');
});

test('current-material historical controls replace only the two shared material producer files', () => {
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const helper=runner.match(/function comparisonSource\(relative,source\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper,'an explicit scoped source resolver is required');
  const resolve=runInNewContext(`(${helper})`,{}, {timeout:1000});
  for(const commit of ['literal108','literal144']){
    const literal={commit},controlled={commit,materialCommit:'currentMain'};
    for(const path of ['src/campus-render-kit.js','src/campus-material-profile.js']){
      assert.equal(resolve(path,literal),commit);
      assert.equal(resolve(path,controlled),'currentMain');
    }
    for(const path of ['src/main-hall-blockout.js','src/photo-hall-library-geometry.js','src/facility-mesh-batch.js','src/campus-material-profile-copy.js','data/reality/campus-buildings.json']){
      assert.equal(resolve(path,controlled),commit,path);
    }
  }
  assert.match(runner,/cell\.baseline108materials\.pixels\.hash/,'Jeongseok equality must use the controlled #108 material producer');
  assert.match(runner,/pixels\.exactChanged,0/,'Main Hall and stationary exact equality stay strict');
  assert.match(runner,/pixels\.maskChanged,0/,'Main Hall silhouette equality stays strict');
});

test('comparison captions settle to two lines before the framebuffer is resized', () => {
  const harness=read('./browser/hall-library-hosted-harness.html');
  const view=harness.slice(harness.indexOf('  function view('),harness.indexOf('  function stats('));
  assert.ok(view.indexOf("document.getElementById('label').textContent")<view.indexOf('device.resizeCanvas'),'caption layout must precede canvas measurement');
  const views=read('./browser/hall-library-hosted-views.js');
  const helper=views.match(/function landmarkDiagnosticCaption\(state\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const caption=runInNewContext(`(${helper})`,{}, {timeout:1000});
  for(const id of ['bldg_01','bldg_jungseok'])for(const presentation of ['currentmain','baseline108','previous144','baseline108materials','previous144materials','preexterior','candidate']){
    const lines=caption({id,presentation,reflected:true,mode:'full'}).split('\n');
    assert.equal(lines.length,2);assert.ok(lines.every(line=>line.length<=40));
  }
  assert.match(harness,/white-space:pre/,'explicit caption lines cannot change framebuffer height between materials');
});

test('parallel graphics extension is an exact allowlist, never a src or Biryong directory exemption', () => {
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const helper=runner.match(/function hallIntegrationScopePaths\(manifest,extension\) \{[\s\S]*?\n\}/)?.[0];
  const allow=runInNewContext(`(${helper})`,{}, {timeout:1000});
  const manifest=JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
  const original=allow(manifest,''), graphics=allow(manifest,'graphics');
  const extra=[
    'biryong/biryong-atmosphere-policy.js','biryong/biryong-atmosphere.js',
    'biryong/biryong-environment-density-policy.js','biryong/biryong-environment-density.js',
    'biryong/biryong-performance-budget.js','biryong/biryong-performance-monitor.js',
    'biryong/biryong-night-visibility-policy.js',
    'biryong/biryong-realm-renderer.js','biryong/biryong-visual-lighting-policy.js',
    'biryong/biryong-visual-lighting.js','biryong/biryong-visual-material-policy.js',
    'biryong/biryong-visual-materials.js','environment/environment-director.js',
    'environment/environment-presets.js','environment/environment-world-time.js',
    'graphics-presets.js','view-distance-settings.js'
  ].map(p=>'apps/world/src/'+p);
  assert.deepEqual([...graphics].sort(),[...original,...extra].sort());
  assert.equal(new Set(graphics).size,graphics.length);
  for(const name of extra)assert.ok(!original.includes(name),'extension is opt-in: '+name);
  for(const name of ['biryong/unreviewed.js','biryong/biryong-realm-transition.js',
    'campus-render-kit.js','campus-material-profile.js','campus-layout.js',
    'environment/night-building-windows.js','activity/activity-contract.js',
    'campus-grounds.js','../data/private.json'])assert.ok(!graphics.includes('apps/world/src/'+name),name);
  assert.ok(!graphics.includes('apps/world/data/reality/campus-buildings.json'));
  assert.throws(()=>allow(manifest,'graphics-and-everything'),/scope/);
});

test('graphics exception is branch-bound and keeps environmental and visual contracts mandatory', () => {
  const workflow=read('../../../.github/workflows/hall-library-candidate-browser.yml');
  assert.match(workflow,/WORLD_HALL_LIBRARY_SCOPE_EXTENSION:.*head\.ref == 'fix\/campus-surroundings-parity-20261004' && 'surroundings' \|\| github\.event\.pull_request\.head\.ref == 'graphics\/parallel-integration-20261008' && 'graphics' \|\| github\.event\.pull_request\.head\.ref == 'feat\/60th-five-walkway-20261012' && 'walkway' \|\| github\.event\.pull_request\.head\.ref == 'release\/2026-10-13-ci-runtime-diagnostics' && 'release-2026-10-13' \|\| ''/);
  const contracts=workflow.slice(workflow.indexOf('      - name: Verify bounded graphics integration contracts'),workflow.indexOf('      - name: Verify real-engine chunk'));
  assert.match(contracts,/if: github.event.pull_request.head.ref == 'graphics\/parallel-integration-20261008'/);
  for(const name of ['biryong-*.test.mjs','environment-continuous-daylight.test.mjs',
    'graphics-detail-settings.test.mjs','graphics-settings-panel.test.mjs',
    'graphics-parallel-smoke-contract.test.mjs','campus-contact-shading.test.mjs'])assert.ok(contracts.includes(name),name);
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  for(const gate of ["assert.equal(pixels.exactChanged,0", "assert.equal(pixels.maskChanged,0", "assert.equal(pixels.hash,cell.baseline108materials.pixels.hash", "await verifyPreviewRoute()", "cell.lifecycle", "report.campus.targets"])assert.ok(runner.includes(gate),gate);
  assert.doesNotMatch(runner,/extension\s*===?\s*['"]graphics['"][\s\S]{0,30}(?:return|continue|process\.exit)/);
});


test('pre-exterior preservation source is immutable and never a synthetic material comparison',()=>{
  const manifest=JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
  assert.equal(manifest.preExterior,'2b9a09615f7986e3d5e5b93d731fba21f33afbdd');
  assert.equal(manifest.preExteriorTree,'96155632b0301631744bae69b9dd6f02e9d990b5');
  const runner=read('./browser/hall-library-hosted-smoke.mjs'),workflow=read('../../../.github/workflows/hall-library-candidate-browser.yml');
  assert.ok(runner.includes("'/__hall_library_pre_exterior__/':{commit:PRE_EXTERIOR}"));
  assert.ok(runner.includes("assert.equal(exteriorTree.trim(),PRE_EXTERIOR_TREE"));
  assert.ok(runner.includes("if(process.env.GITHUB_RUN_ID)assert.equal(exteriorObject,PRE_EXTERIOR"));
  assert.ok(runner.includes("assert.equal(pixels.hash,cell.preexterior.pixels.hash,'Main Hall full RGB preservation')"));
  assert.ok(workflow.includes('git fetch --no-tags origin '+manifest.preExterior));
  for(const file of ['library-approaches.js','jeongseok-entry-geometry.js'])assert.ok(workflow.includes("'apps/world/src/"+file+"'"));
  assert.match(runner,/report.worktreeDirty/,'local scratch validation must not be mislabeled as exact-head CI');
});

test('Jeongseok masks use independent bounded world volumes and active-state projection',()=>{
  const regions=jeongseokExteriorRegions();
  assert.deepEqual(regions.allowed.map(r=>r.name),['lower-glazing','entry-doors','entry-canopy','library_front-stairs','library_rear-stairs']);
  assert.deepEqual(regions.protected.map(r=>r.name),['upper-building','west-facade']);
  assert.equal(Math.min(...regions.allowed[0].points.map(p=>p[1])),1);
  assert.equal(Math.max(...regions.allowed[0].points.map(p=>p[1])),3.32);
  assert.equal(Math.max(...regions.allowed[1].points.map(p=>p[1])),4.5);
  assert.equal(Math.max(...regions.allowed[3].points.map(p=>p[1])),2.105);
  assert.equal(Math.max(...regions.allowed[4].points.map(p=>p[1])),.755);
  const project=scale=>([x,y,z])=>({x:scale*(x+z*.3),y:scale*(y-z*.2),z:100});
  const normal=projectJeongseokExteriorRegions(project(1),false),reflected=projectJeongseokExteriorRegions(project(1),true),resized=projectJeongseokExteriorRegions(project(2),false);
  assert.equal(normal.padding,2);assert.notDeepEqual(normal.allowed[0].polygon,reflected.allowed[0].polygon);
  assert.deepEqual(resized.allowed[0].polygon,normal.allowed[0].polygon.map(p=>({x:p.x*2,y:p.y*2})));
  assert.throws(()=>projectJeongseokExteriorRegions(()=>({x:NaN,y:0,z:1}),false),/projection/);
  assert.throws(()=>projectJeongseokExteriorRegions(()=>({x:0,y:0,z:-1}),false),/projection/);
  const diamond=projectedConvexHull([{x:0,y:5},{x:5,y:0},{x:10,y:5},{x:5,y:10},{x:5,y:5}]);
  assert.equal(diamond.length,4);assert.equal(insideProjectedRegion(5,5,diamond),true);
  assert.equal(insideProjectedRegion(0,0,diamond,2),false,'a projected volume is not its permissive screen AABB');
  assert.equal(insideProjectedRegion(5,-1,diamond,2),true);
  assert.equal(insideProjectedRegion(5,-4,diamond,2),false);
  const harness=read('./browser/hall-library-hosted-harness.html');
  assert.match(harness,/previousViewKey===viewKey/);
  assert.match(harness,/position:camera.getPosition\(\).toArray\(\),rotation:camera.getRotation\(\).toArray\(\)/);
  assert.match(harness,/if\(campus\|\|state.id!=='bldg_jungseok'\)return null/,'actual campus does not reuse a stale isolated-landmark ROI');
  assert.match(harness,/app.once\('postrender',finish\)/);
});

test('bounded exterior gate rejects upper, west, silhouette and mismatched-state regressions',()=>{
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const helper=runner.match(/function checkJeongseokExterior\(pixels,options=\{\}\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);const check=runInNewContext(`(${helper})`,{assert},{timeout:1000});
  const polygon=[{x:1,y:1},{x:10,y:1},{x:5,y:10}];
  const region=name=>({name,polygon,minDepth:10,pixels:100,foreground:50,exactChanged:0});
  const valid={exactChanged:20,exterior:{compared:true,padding:2,roiPixels:100,outsidePixels:900,outsideExactChanged:0,outsideMaskChanged:0,insideExactChanged:20,insideSignificantChanged:15,regions:[region('entry-doors')],protected:[region('upper-building'),region('west-facade')]}};
  assert.doesNotThrow(()=>check(valid,{requireChanges:true,protectedRegion:'upper-building'}));
  for(const patch of [{compared:false},{padding:3},{outsideExactChanged:1},{outsideMaskChanged:1},{insideExactChanged:19},{roiPixels:0},{outsidePixels:0},{insideSignificantChanged:0}]){
    assert.throws(()=>check({...valid,exterior:{...valid.exterior,...patch}},{requireChanges:true}));
  }
  for(const name of ['upper-building','west-facade'])assert.throws(()=>check({...valid,exterior:{...valid.exterior,protected:valid.exterior.protected.map(r=>({...r,exactChanged:r.name===name?1:0}))}}),/preserved/);
  assert.throws(()=>check({...valid,exterior:{...valid.exterior,protected:[{...region('west-facade'),foreground:0}]}},{protectedRegion:'west-facade'}),/visible preserved/);
  assert.match(runner,/checkJeongseokExterior\(pixels,\{requireChanges:true,protectedRegion:'upper-building'\}\)/);
  assert.ok(runner.includes("for(const mode of ['entry-front','entry-left45','entry-right45','entry-walk','canopy','west'])"));
});

test('Jeongseok eye-level entrance camera fits only the reviewed entrance',()=>{
  const full=photoLandmarkView('bldg_jungseok',1280/653),entry=photoLandmarkView('bldg_jungseok',1280/653,{mode:'entry'});
  assert.ok(entry.position[1]<5,'camera stays near eye level');
  assert.ok(Math.hypot(...entry.position.map((n,i)=>n-entry.target[i]))<Math.hypot(...full.position.map((n,i)=>n-full.target[i]))/2);
  assert.ok(entry.points.every(point=>point[1]<=4.5),'upper building never expands an entrance crop');
});


test('Main Hall entire framebuffer gate rejects color-only regressions outside the old silhouette check',()=>{
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const start=runner.indexOf("        if (presentation==='candidate') {");
  const end=runner.indexOf('        if (reflected &&',start);
  assert.ok(start>0&&end>start);
  const gate=runInNewContext(`(pixels,cell)=>{const presentation='candidate',id='bldg_01';${runner.slice(start,end)}}`,{assert},{timeout:1000});
  const pixels={exactChanged:0,maskChanged:0,hash:12},cell={preexterior:{pixels:{hash:12}},currentmain:{pixels:{hash:8}}};
  assert.doesNotThrow(()=>gate(pixels,cell));
  assert.throws(()=>gate({...pixels,exactChanged:1},cell),/Main Hall remains exactly/);
  assert.throws(()=>gate({...pixels,hash:13},cell),/full RGB/);
  assert.throws(()=>gate({...pixels,maskChanged:1},cell),/silhouette/);
});


test('outside-pixel diagnostics cap samples, never totals, extrema, deltas or coordinate bounds',()=>{
  const harness=read('./browser/hall-library-hosted-harness.html');
  const empty=harness.match(/function emptyOutsidePixelDiagnostic\(\)\{[\s\S]*?\n\}/)?.[0];
  const record=harness.match(/function recordOutsidePixelDiagnostic\(diagnostic,index,width,height,before,after,protectedRegions\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(empty&&record);
  const helpers=runInNewContext(`${empty}\n${record}\n({empty:emptyOutsidePixelDiagnostic,record:recordOutsidePixelDiagnostic})`,{},{timeout:1000});
  const none=helpers.empty(),before=new Uint8Array(257*4),after=new Uint8Array(257*4);
  helpers.record(none,0,257,1,before,after,[]);assert.equal(none.total,0);assert.equal(none.bounds,null);assert.equal(none.samples.length,0);
  const d=helpers.empty();
  for(let i=0;i<257;i++){after.set(i===256?[255,255,255,255]:[1,1,1,255],i*4);helpers.record(d,i*4,257,1,before,after,['upper-building']);}
  assert.equal(d.total,257);assert.equal(d.samples.length,256);assert.equal(d.truncated,true);assert.equal(d.maxL1Delta,765);assert.equal(d.maxChannelDelta,255);assert.equal(d.significant,1);
  assert.equal(JSON.stringify(d.bounds),JSON.stringify({minX:0,minY:0,maxX:256,maxY:0}));assert.equal(d.samples.at(-1).x,255);
  const one=helpers.empty(),a=new Uint8Array(16),b=new Uint8Array(16);b.set([12,34,56],8);helpers.record(one,8,2,2,a,b,['west-facade']);
  assert.equal(one.samples[0].x,0);assert.equal(one.samples[0].y,0,'WebGL bottom-up buffer is converted to top-left pixel indices');
  assert.equal(JSON.stringify(one.samples[0].candidateRgb),'[12,34,56]');assert.equal(one.truncated,false);
});

test('diagnostic images preserve captured RGB, vertical orientation and exact unsaturated differences',()=>{
  const harness=read('./browser/hall-library-hosted-harness.html');
  const source=harness.match(/function diagnosticRgba\(before,after,width,height,mode,allowed\)\{[\s\S]*?\n\}/)?.[0];assert.ok(source);
  const convert=runInNewContext(`(${source})`,{},{timeout:1000});
  const before=new Uint8Array([10,20,30,255,40,50,60,255,70,80,90,255,100,110,120,255]);
  const after=new Uint8Array([11,22,33,255,44,55,66,255,77,88,99,255,110,121,132,255]);
  assert.equal(JSON.stringify([...convert(before,after,2,2,'previous')]),JSON.stringify([70,80,90,255,100,110,120,255,10,20,30,255,40,50,60,255]));
  assert.equal(JSON.stringify([...convert(before,after,2,2,'candidate')]),JSON.stringify([77,88,99,255,110,121,132,255,11,22,33,255,44,55,66,255]));
  assert.equal(JSON.stringify([...convert(before,after,2,2,'rgb-diff')]),JSON.stringify([7,8,9,255,10,11,12,255,1,2,3,255,4,5,6,255]));
  assert.equal(JSON.stringify([...convert(before,after,2,2,'outside-mask',new Uint8Array([0,1,1,0]))]),JSON.stringify([0,0,0,255,255,255,255,255,255,255,255,255,0,0,0,255]));
  assert.throws(()=>convert(before,after,2,3,'rgb-diff'),/size mismatch/);assert.throws(()=>convert(before,after,2,2,'approximation'),/Unsupported/);
});

test('silhouette background is configured RGBA8 cross-checked against actual empty full-view corners',()=>{
  const harness=read('./browser/hall-library-hosted-harness.html');
  const source=harness.match(/function framebufferMaskReference\(clearColor,data,width,height,calibration=null\)\{[\s\S]*?\n\}/)?.[0];assert.ok(source);
  const reference=runInNewContext(`(${source})`,{},{timeout:1000}),clear={r:.79,g:.84,b:.89};
  const background=new Uint8Array(Array.from({length:4},()=>[201,214,227,255]).flat());
  const calibrated=reference(clear,background,2,2);
  assert.deepEqual(Array.from(calibrated.rgb),[201,214,227],'RGBA8 rounding matches the raw GPU artifact background');
  assert.equal(calibrated.corners.length,4);
  const closeup=new Uint8Array(background);closeup.set([211,209,198,255],0);
  assert.equal(reference(clear,closeup,2,2,calibrated),calibrated,'closeup geometry cannot redefine the established background');
  assert.throws(()=>reference(clear,closeup,2,2),/does not match/,'an occupied calibration corner must fail');
  const transformed=new Uint8Array(Array.from({length:4},()=>[230,236,242,255]).flat());
  assert.throws(()=>reference(clear,transformed,2,2),/does not match/,'a transfer-function or tone-mapping mismatch must fail');
  assert.throws(()=>reference({...clear,r:.8},background,2,2,calibrated),/changed after calibration/);
  assert.throws(()=>reference({...clear,r:.7901},background,2,2,calibrated),/changed after calibration/,'even same-byte configured-color drift is rejected');
  assert.throws(()=>reference({...clear,r:NaN},background,2,2),/Invalid configured/);
  assert.match(harness,/state.mode!=='full'\|\|campus/,'initial calibration is restricted to the fitted full-view camera');
  assert.match(harness,/maskReferenceCalibration:maskReference/,'actual background cross-check is retained in every pixel receipt');
});

test('one shared silhouette background rejects real changes without corner-color false positives',()=>{
  const harness=read('./browser/hall-library-hosted-harness.html');
  const source=harness.match(/function isMaskForeground\(data,index,reference\)\{[\s\S]*?\n\}/)?.[0];assert.ok(source);
  const foreground=runInNewContext(`(${source})`,{},{timeout:1000}),reference=[201,214,227];
  const before=new Uint8Array([201,214,227,255,211,208,196,255,201,214,227,255]),after=new Uint8Array(before);
  after.set([211,209,198,255],0); // approved staircase occupies the corner only
  const changes=()=>[0,4,8].map(index=>foreground(before,index,reference)!==foreground(after,index,reference));
  assert.deepEqual(changes(),[true,false,false],'unchanged outside RGB keeps the same silhouette classification');
  after.set([211,209,198,255],8);
  assert.deepEqual(changes(),[true,false,true],'a real outside background-to-geometry change is still detected');
  assert.equal(foreground(new Uint8Array([206,219,232]),0,reference),false,'existing L1 threshold 15 is unchanged');
  assert.equal(foreground(new Uint8Array([207,219,232]),0,reference),true);
  assert.match(harness,/const fg = isMaskForeground\(data,i,maskReference.rgb\)/);
  assert.match(harness,/const oldFg = isMaskForeground\(previous,i,maskReference.rgb\)/);
  assert.doesNotMatch(harness,/data\[i\]-data\[0\]|previous\[i\]-previous\[0\]/,'all hosted silhouette and protected-foreground paths use the common reference');
});

test('failed assertions retain captured source pair, camera and depth metadata without relaxing gates',()=>{
  const harness=read('./browser/hall-library-hosted-harness.html'),runner=read('./browser/hall-library-hosted-smoke.mjs');
  const evidence=harness.slice(harness.indexOf('  async function diagnosticEvidence()'),harness.indexOf('  function pixels()'));
  assert.match(evidence,/lastCandidatePair/);assert.match(evidence,/previousState:pair.previousState/);assert.match(evidence,/sameRenderState:pair.sameRenderState/);
  assert.match(evidence,/convertToBlob\(\{type:'image\/png'\}\)/);assert.doesNotMatch(evidence,/view\(|pixels\(|renderNextFrame|readPixels\(/,'diagnostics encode retained bytes without changing camera or recapturing');
  for(const key of ['nearClip:','farClip:','projectionMatrix:','viewMatrix:','depthBits:','samples:'])assert.ok(harness.includes(key),key);
  assert.match(harness,/previousCaptureState\?\.presentation==='preexterior'&&lastCapture.sameRenderState/);
  assert.match(runner,/catch\(error\) \{[\s\S]*report.status='FAIL'[\s\S]*failure framebuffer diagnostics[\s\S]*report.diagnosticScreenshots.push\(filename\)/);
  assert.match(runner,/assert.equal\(report.screenshots.length,44\)/,'all exact 44 requested view screenshots remain mandatory');
  assert.match(runner,/assert.equal\(exterior.outsideExactChanged,0/);assert.match(runner,/assert.equal\(exterior.padding,2/);
  assert.match(runner,/catch\(diagnosticError\)\{report.diagnosticError=/,'diagnostic failures cannot replace the original failure');
});


test('entrance views preserve exact azimuth and fixed or canonical-ground-relative eye height',()=>{
 const expectedBearings={'entry-front':0,'entry-left45':-45,'entry-right45':45,'entry-walk':0};
 for(const aspect of [1280/635,390/720,844/300])for(const [mode,bearing]of Object.entries(expectedBearings)){
  const view=jeongseokEntryView(aspect,mode),camera=view.entryCamera;
  assert.equal(camera.bearingDegrees,bearing);assert.ok(Math.abs(Math.atan2(camera.local.u,camera.local.v-.85)*180/Math.PI-bearing)<1e-8);
  assert.ok(Math.abs(view.position[1]-camera.groundHeight-camera.eyeHeight)<1e-9,'fit distance cannot raise the eye');
  assert.equal(camera.eyeHeight,.805);assert.ok(camera.minPreservationDepth>.25,'every original ROI remains in front without changing its projection policy');
  if(mode!=='entry-walk')assert.equal(view.position[1],2.455);else assert.ok(camera.groundHeight>=0&&camera.groundHeight<=1.65);
  assert.ok(view.points.every(point=>point[1]>=1.65&&point[1]<=4.5),'only doorway, columns, landing contact and canopy frame the closeup');
  assert.ok(camera.framing.minX>=.079&&camera.framing.maxX<=.921&&camera.framing.minY>=.079&&camera.framing.maxY<=.921);
  assert.ok(camera.horizontalDistance<24,'closeup never fits the full building');
 }
 assert.throws(()=>jeongseokEntryView(0,'entry-front'),/Unsupported/);assert.throws(()=>jeongseokEntryView(2,'unreviewed'),/Unsupported/);
});

test('walking view retains approved and protected pixel samples in all three aspects and both reflections',()=>{
 // CPU perspective projection is engine-free, so this regression also runs in
 // the clean World unit suite. Use the actual hosted framebuffer dimensions.
 const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0),unit=a=>a.map(n=>n/Math.hypot(...a));
 for(const [width,height]of [[1280,635],[390,717],[844,305]])for(const reflected of [false,true]){
  const view=jeongseokEntryView(width/height,'entry-walk'),reflect=([x,y,z])=>[x,y,reflected?-z:z];
  const position=reflect(view.position),target=reflect(view.target),back=unit(position.map((n,i)=>n-target[i]));
  const right=unit([back[2],0,-back[0]]),up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]],tan=Math.tan(48*Math.PI/360);
  const project=point=>{const delta=point.map((n,i)=>n-position[i]),depth=-dot(delta,back);return {x:(1+dot(delta,right)/(depth*tan*width/height))*width/2,y:(1-dot(delta,up)/(depth*tan))*height/2,z:depth};};
  const regions=projectJeongseokExteriorRegions(project,reflected);let roiPixels=0,outsidePixels=0,upperPixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   if(regions.allowed.some(region=>insideProjectedRegion(x+.5,y+.5,region.polygon,regions.padding)))roiPixels++;
   else{outsidePixels++;if(insideProjectedRegion(x+.5,y+.5,regions.protected.find(region=>region.name==='upper-building').polygon))upperPixels++;}
  }
  const label=`${width}x${height}, reflected=${reflected}`;
  assert.ok(roiPixels>0,label+' samples the approved entry/stair surfaces');
  assert.ok(outsidePixels>width*height*.05,label+' retains a meaningful preserved area outside the original ROI');
  assert.ok(upperPixels>width*height*.02,label+' retains independently protected upper-building samples');
  const doors=jeongseokExteriorRegions().allowed.find(region=>region.name==='entry-doors').points.map(point=>project(reflect(point)));
  assert.ok(Math.max(...doors.map(p=>p.x))-Math.min(...doors.map(p=>p.x))>=300,label+' retains at least 300 pixels of doorway width');
  assert.equal(roiPixels+outsidePixels,width*height);
 }
});

test('real rendered entrance camera rejects raised eyes and wrong-side reflection',()=>{
 const runner=read('./browser/hall-library-hosted-smoke.mjs');
 const source=runner.match(/function checkJeongseokCloseupCamera\(pixels,expected\)\{[\s\S]*?\n\}/)?.[0];assert.ok(source);
 const check=runInNewContext(`(${source})`,{assert},{timeout:1000});
 for(const reflected of [false,true])for(const mode of ['entry-front','entry-left45','entry-right45','entry-walk']){
  const expected=jeongseokEntryView(1280/635,mode),position=expected.position.map((n,i)=>i===2&&reflected?-n:n),pixels={camera:{position,reflected}};
  assert.doesNotThrow(()=>check(pixels,expected));
  assert.throws(()=>check({camera:{...pixels.camera,position:position.map((n,i)=>i===1?n+.01:n)}},expected),/eye height/);
  assert.throws(()=>check({camera:{...pixels.camera,position:position.map((n,i)=>i===2?-n:n)}},expected),/exact entrance view/);
 }
 assert.match(runner,/await shot\(`desktop-bldg_jungseok-\$\{presentation\}-\$\{mode\}-\$\{reflected\?'reflected':'control'\}`\)/,'both reflections retain actual image evidence');
 assert.match(runner,/assert.equal\(report.screenshots.length,44\)/);
});

test('walkway scope extension is exact, branch-bound, and preserves historical hall gates',()=>{
 const runner=read('./browser/hall-library-hosted-smoke.mjs');
 const helper=runner.match(/function hallIntegrationScopePaths\(manifest,extension\) \{[\s\S]*?\n\}/)?.[0];
 const allow=runInNewContext(`(${helper})`,{}, {timeout:1000});
 const manifest=JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
 const original=allow(manifest,''),walkway=allow(manifest,'walkway');
 assert.equal(walkway.length,original.length+13);
 for(const path of ['north-walkway-layout.js','north-walkway-geometry.js','north-walkway-surface.js','campus-material-profile.js','north-landmark-massing.js','north-campus-layout.js'])assert.ok(walkway.includes('apps/world/src/'+path));
 for(const path of ['campus-layout.js','campus-facilities.js','north-side-gate-layout.js','environment/night-street-lights.js','biryong/biryong-realm-transition.js'])assert.ok(!walkway.includes('apps/world/src/'+path));
 assert.ok(walkway.includes('apps/world/data/reality/north-walkway.provenance.json'));
 const workflow=read('../../../.github/workflows/hall-library-candidate-browser.yml');
 assert.ok(workflow.includes("head.ref == 'feat/60th-five-walkway-20261012' && 'walkway'"));
 for(const step of ['north-walkway.test.mjs','material-profile-smoke.mjs','hall-library-hosted-smoke.mjs','hall-library-integration-null-smoke.mjs'])assert.ok(workflow.includes(step));
});


test('one release scope accepts exactly the reviewed diagnostics, walkway and photo repair paths',()=>{
 const runner=read('./browser/hall-library-hosted-smoke.mjs');
 const helper=runner.match(/function hallIntegrationScopePaths\(manifest,extension\) \{[\s\S]*?\n\}/)?.[0];
 const allow=runInNewContext(`(${helper})`,{}, {timeout:1000});
 const manifest=JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
 const release=[...allow(manifest,'release-2026-10-13')].sort();
 const expected=[
  'campus-material-profile.js','minimap/minimap-data.js','navigation/campus-navigation.js',
  'north-campus-geometry.js','north-campus-photo-geometry.js','north-walkway-geometry.js',
  'north-walkway-layout.js','north-walkway-surface.js','render-chunk-registry.js','north-landmark-massing.js','north-campus-layout.js',
  'main.js','diagnostics/build-id.js','diagnostics/diagnostics-panel.js',
  'diagnostics/runtime-diagnostics-runtime.js','diagnostics/runtime-diagnostics.js',
  'photo/photo-capture.js','photo/photo-mode-panel.js',
  'campus-road-blockout.js','north-walkway-batching.js','north-walkway-renderer.js'
 ].map(p=>'apps/world/src/'+p).concat([
  'apps/world/data/reality/north-walkway.provenance.json',
  'apps/world/data/reality/north-landmark-restoration.provenance.json'
 ]).sort();
 assert.deepEqual(release,expected);assert.equal(new Set(release).size,23);
 for(const path of ['diagnostics/unreviewed.js','photo/unreviewed.js','campus-facilities.js','campus-render-kit.js','main-hall-blockout.js'])assert.ok(!release.includes('apps/world/src/'+path));
 assert.throws(()=>allow(manifest,'release'),/scope/);
 assert.throws(()=>allow(manifest,'release-2026-10-14'),/scope/);
 const workflow=read('../../../.github/workflows/hall-library-candidate-browser.yml');
 assert.ok(workflow.includes("head.ref == 'release/2026-10-13-ci-runtime-diagnostics' && 'release-2026-10-13'"));
 for(const contract of ['north-walkway.test.mjs','north-landmark-restoration.test.mjs','campus-material-profile.test.mjs','north-walkway-batching.test.mjs','runtime-diagnostics.test.mjs','photo-capture.test.mjs','photo-mode-panel.test.mjs'])assert.ok(workflow.includes(contract));
 for(const gate of ['material-profile-smoke.mjs','hall-library-hosted-smoke.mjs','hall-library-integration-null-smoke.mjs'])assert.ok(workflow.includes(gate));
 assert.ok(runner.includes("assert.equal(pixels.hash,cell.preexterior.pixels.hash,'Main Hall full RGB preservation')"));
});


test('release branch name cannot bypass exact diff, base, manifest or source ancestry',()=>{
 const runner=read('./browser/hall-library-hosted-smoke.mjs');
 const helper=runner.match(/function validateReviewedReleaseScope\(changedPaths,allowed,scopeBase,releaseManifest\) \{[\s\S]*?\n\}/)?.[0];assert.ok(helper);
 const validate=runInNewContext(`(${helper})`,{assert},{timeout:1000});
 const base='bfa08ad78f92fba51eb1a3978dd97a12182fc82c';
 const heads=['d436d8f5db161875930db53b7c589c1dab91fc7d','1dcd85d9370b82a32ea29a0992c45618e5a82f5e','912a6d354464e6536029b631a587ab5f64c0ac5c','8f00074c8736a100bd229a1bd29a74e8bfd9698d'];
 const manifest=[base,...heads].map(s=>'`'+s+'`').join(' '),allowed=['reviewed-a','reviewed-b'];
 assert.doesNotThrow(()=>validate(['reviewed-b','reviewed-a'],allowed,base,manifest));
 assert.throws(()=>validate([...allowed,'unreviewed'],allowed,base,manifest),/diff exactly/);
 assert.throws(()=>validate(['reviewed-a'],allowed,base,manifest),/diff exactly/);
 assert.throws(()=>validate(allowed,allowed,'0'.repeat(40),manifest),/immutable base/);
 for(const sha of [base,...heads])assert.throws(()=>validate(allowed,allowed,base,manifest.replace(sha,'')),/manifest/);
 assert.ok(runner.includes("['merge-base','--is-ancestor',sha,'HEAD']"));
});
