import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startSmoke,TIMEOUT_MS } from './harness.mjs';

const smoke=await startSmoke({viewport:{width:800,height:600}});
try {
  const page=await smoke.context.newPage();smoke.watch(page);
  await page.addInitScript(()=>localStorage.setItem('inha-world-graphics-quality-v1','medium'));
  await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
  await page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading?.finished &&
    window.__INHAGAME_ENVIRONMENT__?.status().weatherSettled,null,{timeout:TIMEOUT_MS});
  const result=await page.evaluate(async()=>{
    const d=window.__INHAGAME_P0__,qa=window.__INHAGAME_CONTACT_SHADING__;
    d.app.autoRender=false;
    const pc=await import('playcanvas'),kit=await import('/src/campus-render-kit.js');
    const move=p=>{d.player.setLocalPosition(p.x,1.1,p.z);for(let i=0;i<8;i++)d.streaming.update(.3,p);};
    move({x:0,z:0});
    const cache=kit.campusMaterialCacheStatus().materialCount;
    const before=qa.status();
    const base=d.app.root.findByName('campus_contact_base');
    const baseMesh=base.render.meshInstances[0].mesh,baseMaterial=base.render.meshInstances[0].material;
    const material={blend:baseMaterial.blendType===pc.BLEND_NORMAL,depthWrite:baseMaterial.depthWrite,
      alphaVertex:baseMaterial.opacityMapVertexColor,channel:baseMaterial.opacityMapVertexColorChannel,
      lighting:baseMaterial.useLighting,cast:base.render.castShadows,receive:base.render.receiveShadows,
      collision:!!base.collision};
    const positions=[],colors=[];baseMesh.getPositions(positions);baseMesh.getColors(colors);
    d.graphics.setPreference('low');d.streaming.update(.3,d.player.getLocalPosition());
    const low=qa.status();
    d.graphics.setPreference('high');d.streaming.update(.3,d.player.getLocalPosition());
    const high=qa.status();
    qa.setEnabled(false);const off=qa.status();qa.setEnabled(true);
    const snapshots=[];
    for(let cycle=0;cycle<3;cycle++){
      d.streaming.update(.3,{x:10000,z:10000});
      snapshots.push({unloaded:qa.status().meshes});
      move({x:0,z:0});
      snapshots.at(-1).reloaded=qa.status().meshes;
    }
    const stable=baseMesh===base.render.meshInstances[0].mesh && baseMaterial===base.render.meshInstances[0].material;
    const sharedMaterialStable=cache===kit.campusMaterialCacheStatus().materialCount;
    window.__P7C_BASE_REFS__={mesh:baseMesh,material:baseMaterial};
    return {before,low,high,off,snapshots,stable,sharedMaterialStable,material,
      finite:positions.every(Number.isFinite),alphaRange:[Math.min(...colors.filter((_,i)=>i%4===3)),Math.max(...colors.filter((_,i)=>i%4===3))]};
  });
  assert.equal(result.before.meshes,3);assert.equal(result.before.activeMeshes,3);
  assert.ok(result.before.triangles>0 && result.before.triangles<=result.before.budget.totalTriangles);
  assert.ok(result.before.bufferBytes>0 && result.before.bufferBytes<=result.before.budget.bufferBytes);
  assert.equal(result.low.activeMeshes,1);assert.equal(result.high.activeMeshes,3);
  assert.equal(result.off.activeMeshes,0);
  assert.ok(result.stable,'BASE mesh/material survive quality and residency changes');
  assert.ok(result.sharedMaterialStable,'contacts do not grow the shared surface cache');
  assert.ok(result.finite);
  assert.deepEqual(result.material,{blend:true,depthWrite:false,alphaVertex:true,channel:'a',lighting:false,cast:false,receive:false,collision:false});
  assert.equal(result.alphaRange[0],0);assert.ok(result.alphaRange[1]>0 && result.alphaRange[1]<=.161);
  assert.ok(result.snapshots.every(s=>s.unloaded===1 && s.reloaded===3));

  // Actual weather accumulation suppresses contacts before snow overlays obscure
  // their original receiver. A policy-only assertion would miss a missing wire.
  await page.evaluate(()=>{
    window.__INHAGAME_ENVIRONMENT__.setWeather('SNOW',{immediate:true});
    const d=window.__INHAGAME_P0__;for(let i=0;i<12;i++)d.app.fire('update',.1);
  });
  await page.waitForFunction(()=>window.__INHAGAME_CONTACT_SHADING__.status().snow>=.14,null,{timeout:TIMEOUT_MS});
  assert.equal(await page.evaluate(()=>window.__INHAGAME_CONTACT_SHADING__.status().activeMeshes),0);
  await page.evaluate(()=>{
    window.__INHAGAME_ENVIRONMENT__.setWeather('RAIN',{immediate:true});
    window.__INHAGAME_ENVIRONMENT__.setTimeOfDay('NIGHT',{immediate:true});
    const d=window.__INHAGAME_P0__;for(let i=0;i<150;i++)d.app.fire('update',.1);
  });
  await page.waitForFunction(()=>window.__INHAGAME_CONTACT_SHADING__.status().snow===0,null,{timeout:TIMEOUT_MS});
  assert.ok(await page.evaluate(()=>window.__INHAGAME_CONTACT_SHADING__.status().activeMeshes>0));

  if(process.env.WORLD_SMOKE_CONTACT_SCREENSHOTS){
    const directory=process.env.WORLD_SMOKE_CONTACT_SCREENSHOTS;await mkdir(directory,{recursive:true});
    await page.evaluate(()=>{
      const e=window.__INHAGAME_ENVIRONMENT__;e.setWeather('CLEAR',{immediate:true});e.setTimeOfDay('DAY',{immediate:true});
      const d=window.__INHAGAME_P0__;d.graphics.setPreference('medium');d.app.autoRender=true;
      for(let i=0;i<10;i++)d.app.fire('update',.1);
    });
    const {GARDEN_BENCHES}=await import('../../src/library-garden-layout.js');
    const {BUILDINGS}=await import('../../src/basic-campus.js');
    const ring=BUILDINGS.find(b=>b.id==='bldg_01').vertices,a=ring[0],b=ring[1];
    const area=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0);
    const len=Math.hypot(b.x-a.x,b.z-a.z),nx=(area>0?b.z-a.z:a.z-b.z)/len,nz=(area>0?a.x-b.x:b.x-a.x)/len;
    const views=[{name:'garden',p:GARDEN_BENCHES[0].center,y:-.6,nx:1,nz:1},
      {name:'hall',p:{x:(a.x+b.x)/2+nx*.15,z:(a.z+b.z)/2+nz*.15},y:0,nx,nz}];
    for(const view of views){
      await page.evaluate(async v=>{
        const pc=await import('playcanvas'),d=window.__INHAGAME_P0__;
        d.player.setLocalPosition(v.p.x,1.1,v.p.z);
        d.player.enabled=false;
        d.app.root.findByName('Camera').camera.enabled=false;
        let camera=d.app.root.findByName('P7C_QA_Camera');
        if(!camera){camera=new pc.Entity('P7C_QA_Camera');camera.addComponent('camera',{
          nearClip:.05,farClip:400,fov:45,clearColor:new pc.Color(.52,.71,.84)});
          camera.camera.toneMapping=pc.TONEMAP_NEUTRAL;d.app.root.addChild(camera);}
        camera.setPosition(v.p.x+v.nx*3,v.y+3,-v.p.z-v.nz*3);
        camera.lookAt(new pc.Vec3(v.p.x,v.y,-v.p.z));
      },view);
      await page.waitForTimeout(500);
      for(const enabled of [true,false]){
        await page.evaluate(v=>window.__INHAGAME_CONTACT_SHADING__.setEnabled(v),enabled);
        await page.waitForTimeout(150);
        await page.screenshot({path:`${directory}/${view.name}-${enabled?'on':'off'}.png`});
      }
    }
  }
  assert.deepEqual(smoke.problems,[]);
  console.log(`P7C contact shading: PASS (three static batches, ${result.before.triangles} triangles, quality/snow/fade/disposal verified)`);
} finally { await smoke.close(); }
