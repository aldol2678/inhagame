// Actual Chromium pixels, plus the real Campus streaming lifecycle. Offline only:
// harness.mjs supplies pinned PlayCanvas, blocks external traffic and stubs backend APIs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';

const output=process.env.WORLD_NEUTRAL_QA_OUTPUT||'test-results/neutral-campus';
await mkdir(output,{recursive:true});
const report={scope:'Offline local HTTP only; public geometry; no production/backend access',cases:[]};
const viewports=[['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true],['desktop',{width:1280,height:720},false]];
const pixels=(page,options={})=>page.evaluate(options=>window.__NEUTRAL_BUILDING_QA__.pixels(options),options);
const view=(page,id,reflected=true,options={})=>page.evaluate(({id,reflected,options})=>window.__NEUTRAL_BUILDING_QA__.view(id,reflected,options),{id,reflected,options});
const shot=(page,name)=>page.screenshot({path:path.join(output,`${name}.png`),timeout:TIMEOUT_MS,animations:'disabled'});
const valid=p=>{assert.equal(p.glError,0,'resolved framebuffer readback');assert.ok(p.width>0&&p.height>0);};

async function campusRuntime(smoke,name){
  const page=await smoke.context.newPage(),fatal=smoke.watch(page);
  try{
    await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
    await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
    const status=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus());
    assert.equal(status.renderer,'WebGL2');assert.equal(status.loading.phase,'READY');
    await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
    const lifecycle=await page.evaluate(async()=>{
      const d=window.__INHAGAME_P0__,renderer=d.streaming.renderer,base=renderer.base;
      const {FACILITIES}=await import('/src/campus-facilities.js');
      const {viewDistancePreset}=await import('/src/view-distance.js');
      d.app.off('update');
      const envelopes=()=>base.findComponents('render').filter(r=>r.entity.name.includes('_neutral_envelope_'));
      const originalBase=envelopes().flatMap(r=>r.meshInstances.map(m=>m.mesh));
      const retained=['bldg_01','bldg_jungseok'].map(id=>({id,present:!!base.findByName(id)?.render}));
      const fadesBefore=renderer.fades.size;
      const chunk={id:'NeutralBuildingLifecycleQA',facilities:['bldg_05'],buildings:[],streetscape:[],trees:[]};
      const cycles=[];
      for(let i=0;i<3;i++){
        const handle=renderer.create(chunk);renderer.setState(handle,'NEAR');renderer.update(.3);
        const near=handle.near.findComponents('render').filter(r=>r.entity.name.includes('_neutral_facade_'));
        const materials=near.flatMap(r=>r.meshInstances.map(m=>m.material));
        if(near.length!==2||!materials.every(m=>m.depthBias===-1&&m.slopeDepthBias===-1&&m.alphaDither===1))throw Error('actual chunk NEAR material contract failed');
        renderer.setState(handle,'VISTA');renderer.update(.3);
        if(handle.near.enabled||!materials.every(m=>m.alphaDither===0))throw Error('far fade did not remove facade');
        renderer.setState(handle,'ACTIVE');renderer.update(.3);
        if(!handle.near.enabled||handle.detail.findComponents('render').some(r=>r.entity.name.includes('_neutral_')))throw Error('ACTIVE duplicated neutral facade');
        renderer.destroy(handle);
        if(renderer.fades.size!==fadesBefore)throw Error('destroy leaked fade residency');
        if(!originalBase.every((mesh,index)=>envelopes().flatMap(r=>r.meshInstances.map(m=>m.mesh))[index]===mesh))throw Error('streaming rebuilt persistent BASE');
        cycles.push({cycle:i,nearMeshes:2,farFade:0,nearFade:1,destroyed:true});
      }
      d.streaming.setPolicy(viewDistancePreset('MAX'));
      for(let i=0;i<=d.registry.chunks.length;i++)d.streaming.update(.3,{x:0,y:20,z:100});
      const camera=d.app.root.findByName('Camera');camera.setPosition(260,260,300);camera.lookAt(40,0,-30);
      return {renderer:'WebGL2',scaleSign:base.worldScaleSign,baseMeshes:envelopes().length,logicalBuildings:FACILITIES.filter(f=>f.kind==='building').length,retained,cycles,terrainMeshes:base.children.filter(e=>e.name.startsWith('campus_terrain')).length};
    });
    assert.equal(lifecycle.scaleSign,-1);assert.equal(lifecycle.baseMeshes,40);assert.equal(lifecycle.logicalBuildings,21);
    assert.ok(lifecycle.retained.every(b=>b.present));assert.equal(lifecycle.terrainMeshes,5);assert.equal(lifecycle.cycles.length,3);
    await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
    await page.evaluate(()=>new Promise(resolve=>{const app=window.__INHAGAME_P0__.app;app.autoRender=false;app.once('postrender',()=>{app.graphicsDevice.gl.finish();resolve();});app.renderNextFrame=true;}));
    await page.locator('#application').screenshot({path:path.join(output,`${name}-actual-campus.png`),timeout:TIMEOUT_MS});
    return lifecycle;
  }finally{await page.close();}
}

try{
  for(const [name,viewport,mobile] of viewports){
    const entry={name,viewport,buildings:[]};report.cases.push(entry);
    const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
    try{
      const page=await smoke.context.newPage(),fatal=smoke.watch(page);
      await page.goto(`${smoke.origin}/tests/browser/neutral-campus-buildings-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
      await Promise.race([page.waitForFunction(()=>window.__NEUTRAL_BUILDING_QA__?.ready||window.__NEUTRAL_BUILDING_QA__?.error,null,{timeout:TIMEOUT_MS}),fatal]);
      assert.equal(await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.error),undefined);
      entry.stats=await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.stats());
      assert.equal(entry.stats.buildings,20);assert.equal(entry.stats.meshes,40);assert.equal(entry.stats.materials,2);
      assert.equal(entry.stats.detailMeshes,40);assert.equal(entry.stats.detailMaterials,2);assert.equal(entry.stats.detailBias,true);
      assert.equal(entry.stats.castShadows,true);assert.ok(entry.stats.groups.every(g=>g.meshes===2));
      entry.rebuild=await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.rebuildCheck());
      assert.deepEqual(entry.rebuild,{cycles:3,materialReuse:true,streamedFacadeDuplicates:0});
      const ids=await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.ids);
      for(const id of ids){
        const item={id,modes:[]};entry.buildings.push(item);
        for(const reflected of [true,false]){
          await view(page,id,reflected,{details:false});
          await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.hideEnvelopes());
          const hidden=await pixels(page);valid(hidden);
          await view(page,id,reflected,{details:false});const far=await pixels(page,{compare:true});valid(far);
          assert.ok(far.changed>10,`${name}/${id}/${reflected}: no visible BASE envelope pixels (${far.changed})`);
          assert.ok(far.visibleBase>=1,`${name}/${id}: missing far silhouette`);assert.equal(far.visibleNear,0);
          await view(page,id,reflected,{details:true});const near=await pixels(page,{compare:true});valid(near);
          assert.ok(near.changed>10,`${name}/${id}/${reflected}: no visible facade pixels (${near.changed})`);
          assert.ok(near.visibleNear>=1,`${name}/${id}: decal culled`);assert.equal(near.scaleSign,reflected?-1:1);
          const stable=await pixels(page,{compare:true});valid(stable);
          assert.equal(stable.hash,near.hash,`${name}/${id}: stationary frame flicker`);assert.equal(stable.changed,0);
          item.modes.push({reflected,hidden,far,near,stable});
          if(reflected&&(name==='desktop'||['bldg_05','bldg_60th','bldg_dorm1'].includes(id)))await shot(page,`${name}-${id}`);
        }
      }
      entry.oblique=[];
      for(const orbit of [-.08,.08]){
        await view(page,'bldg_05',true,{details:false,orbit});await pixels(page);
        await view(page,'bldg_05',true,{details:true,orbit});const near=await pixels(page,{compare:true});valid(near);
        assert.ok(near.changed>10,'oblique depth-biased windows remain visible');entry.oblique.push({orbit,pixels:near});
      }
      await view(page,'courtyard-top',true);const sample=await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.courtyardSample());
      const courtyard=await pixels(page,{sample});valid(courtyard);assert.equal(courtyard.sampled.length,27);
      await shot(page,`${name}-courtyard-top`);
      await page.evaluate(()=>window.__NEUTRAL_BUILDING_QA__.hideBuildings());
      const empty=await pixels(page,{sample});valid(empty);assert.deepEqual(courtyard.sampled,empty.sampled,'courtyard center remains the unobstructed ground plane');
      entry.courtyard={withBuilding:courtyard,withoutBuilding:empty};
      for(const id of ['overview','courtyard']){await view(page,id,true);valid(await pixels(page));await shot(page,`${name}-${id}`);}
      await page.close();
      entry.runtime=await campusRuntime(smoke,name);
      assert.deepEqual(smoke.problems,[],`${name}: browser errors`);entry.result='PASS';
    }catch(error){entry.result='FAIL';entry.error=String(error.stack||error);entry.problems=smoke.problems;throw error;}
    finally{await smoke.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
  }
  console.log('neutral campus actual Chromium pixels and runtime lifecycle: PASS');
}finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
