// Hosted/offline actual-campus screenshots. The exact same cameras are used
// against the pinned historical tree and candidate; no Production requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startSmoke,TIMEOUT_MS} from './harness.mjs';
// Parsed by the actual-engine null fixture to project every stair/rail corner.
export const NORTH_ENTRY_CAMERA = {"wide":{"out":16,"y":12},"portrait":{"out":30,"y":20}};
const out=process.env.NORTH_LANDMARK_OUTPUT||'test-results/north-landmarks/candidate';
const mode=process.env.NORTH_LANDMARK_MODE||'candidate';
await mkdir(out,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_NORTH_HEAD)assert.equal(head,process.env.EXPECTED_NORTH_HEAD);
const report={head,mode,scope:'Actual offline campus; fixed diagnostic cameras, no measured architectural or physical-device claim',views:[]};
const views=[
 {id:'five-south',owner:'bldg_05',center:[-5,12,108],half:[54,13,49],back:[-.47,.50,-.88]},
 {id:'sixty-east',owner:'bldg_60th',center:[51,18,87],half:[25,19,33],back:[.88,.36,-.48]},
 {id:'agora-open',owner:'fac_agora_courtyard',center:[106,6,-80],half:[28,7,33],back:[-.88,.50,.47]},
 {id:'five-clock-close',owner:'bldg_05',center:[-28,17,89],half:[7,8,5],back:[-.47,.16,-.88],close:true},
 {id:'sixty-ribbon-close',owner:'bldg_60th',center:[56,8,81],half:[19,8,17],back:[.88,.24,-.48],close:true},
 {id:'sixty-end-close',owner:'bldg_60th',center:[42.3,24,69.5],half:[5,13,5],back:[-.496,.15,-.868],close:true},
 {id:'agora-entry-close',owner:'fac_agora_courtyard',center:[96.8,1.2,-73.8],half:[8,3,7],back:[-.88,.25,.47],close:true,entry:true}
];
async function frame(page,compare=false){return page.evaluate(({compare,timeout})=>new Promise((resolve,reject)=>{
 const app=window.__INHAGAME_P0__.app,t=setTimeout(()=>reject(Error('render timeout')),timeout);
 app.once('postrender',()=>{try{
  const gl=app.graphicsDevice.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4),binding=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.finish();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,binding);}
  const previous=window.__northPixels;let changed=0;for(let i=0;compare&&previous&&i<p.length;i+=4)if(Math.abs(p[i]-previous[i])+Math.abs(p[i+1]-previous[i+1])+Math.abs(p[i+2]-previous[i+2])>12)changed++;
  window.__northPixels=p;resolve({width:w,height:h,changed,glError:gl.getError()});
 }catch(e){reject(e);}finally{clearTimeout(t);}});app.renderNextFrame=true;
}),{compare,timeout:TIMEOUT_MS});}
try{
 for(const [name,viewport]of [['desktop',{width:1280,height:720}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
  const smoke=await startSmoke({viewport,contextOptions:{deviceScaleFactor:1,isMobile:name!=='desktop',hasTouch:name!=='desktop'}});
  try{
   const page=await smoke.context.newPage(),fatal=smoke.watch(page);
   await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>{const s=window.__INHAGAME_P0__?.getStatus?.();return s?.renderer==='UNAVAILABLE'||s?.loading?.finished;},null,{timeout:TIMEOUT_MS}),fatal]);
   assert.equal((await page.evaluate(()=>window.__INHAGAME_P0__.getStatus())).renderer,'WebGL2');
   await page.waitForFunction(()=>window.__INHAGAME_ENVIRONMENT__?.status?.().settled&&window.__INHAGAME_ENVIRONMENT__?.status?.().weatherSettled,null,{timeout:TIMEOUT_MS});
   await page.addStyleTag({content:'body > :not(#application):not(script):not(style){visibility:hidden!important}'});
   await page.evaluate(()=>{const d=window.__INHAGAME_P0__;d.app.off('update');d.app.autoRender=false;});
   for(const view of views.filter(v=>!v.close||name!=='landscape'))for(const sign of name==='desktop'&&!view.close?[-1,1]:[-1]){
    const receipt=await page.evaluate(async({view,sign,mode,entryCameras})=>{
     const d=window.__INHAGAME_P0__,{viewDistancePreset}=await import('/src/view-distance.js');
     const base=d.app.root.findByName('CampusBase'),camera=d.app.root.findByName('Camera');
     d.streaming.setPolicy(viewDistancePreset('MAX'));
     for(let i=0;i<d.registry.chunks.length+12;i++)d.streaming.update(.05,{x:view.center[0],y:0,z:view.center[2]});
     base.parent.setLocalScale(1,1,sign);base.parent.syncHierarchy();
     const target=base.children.filter(e=>e.name===view.owner);if(target.length!==1)throw Error('target BASE ownership');
     const all=[...base.parent.findComponents('render')];
     const name=view.owner+'_NEAR';let near=0;const groups=[];const visit=e=>{if(e.name===name&&e.enabled&&e.parent?.enabled)near++;if([view.owner,view.owner+'_NEAR',view.owner+'_DETAIL'].includes(e.name))groups.push(e);for(const c of e.children)visit(c);};visit(base.parent);
     window.__northTargetGroups=groups.map(e=>({e,enabled:e.enabled}));
     if(near!==1)throw Error(`missing streamed target ${name}: ${near}`);
     const clock=!!base.findByName('bldg_05_clock_core'),tower=!!base.findByName('bldg_60th_tower');
     if(mode==='candidate'&&(!clock||!tower))throw Error('restored skyline missing');
     if(mode==='baseline'&&(clock||tower))throw Error('historical baseline contaminated');
     const normalize=v=>v.map(x=>x/Math.hypot(...v)),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
     const center=[view.center[0],view.center[1],view.center[2]*sign],back=normalize([view.back[0],view.back[1],view.back[2]*sign]);
     const right=normalize([back[2],0,-back[0]]),up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
     const aspect=d.app.graphicsDevice.width/d.app.graphicsDevice.height,tan=Math.tan(48*Math.PI/360);let distance=1;
     const half=aspect<.8&&view.id==='sixty-ribbon-close'?[6,7,6]:view.half;
     if(aspect<.8&&view.id==='sixty-ribbon-close')center.splice(0,3,55.7,8.8,79.4*sign);
     for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const p=[half[0]*x,half[1]*y,half[2]*z];distance=Math.max(distance,dot(p,back)+Math.abs(dot(p,right))/(tan*aspect*.83),dot(p,back)+Math.abs(dot(p,up))/(tan*.83));}
     // These diagnostic views can be hundreds of units away. A 0.1 near plane
     // loses depth precision between the thin paving/facade layers in portrait.
     camera.camera.fov=48;camera.camera.nearClip=2;camera.camera.farClip=1400;
     camera.setPosition(...center.map((v,i)=>v+back[i]*distance));camera.lookAt(...center);
     if(view.entry){
      const {AGORA}=await import('/src/roadview-layout.js'),u=(AGORA.stairStart+AGORA.stairEnd)/2;
      // A narrow portrait frustum needs a wider, raised stair view. Keep it
      // above the foreground crowns instead of cropping away the side guards.
      const profile=entryCameras[aspect<.8?'portrait':'wide'];
      const from=AGORA.frame.at(u,profile.out),to=AGORA.frame.at(u,0);
      camera.setPosition(from.x,profile.y,from.z*sign);camera.lookAt(to.x,1.2,to.z*sign);
      center.splice(0,3,to.x,1.2,to.z*sign);distance=camera.getPosition().distance({x:center[0],y:center[1],z:center[2]});
      const pc=await import('playcanvas');
      for(const side of [AGORA.stairStart,AGORA.stairEnd])for(const out of [0,AGORA.run])for(const rail of [0,.84]){
       const p=AGORA.frame.at(side,out),y=AGORA.height*(1-out/AGORA.run)+rail;
       const screen=camera.camera.worldToScreen(new pc.Vec3(p.x,y,p.z*sign));
       if(screen.x<0||screen.x>d.app.graphicsDevice.width||screen.y<0||screen.y>d.app.graphicsDevice.height)throw Error(`Stair or guard clipped: ${JSON.stringify({side,out,rail,screen:screen.toArray(),width:d.app.graphicsDevice.width,height:d.app.graphicsDevice.height})}`);
      }
     }
     return {clock,tower,baseOwners:target.length,nearOwners:near,reflection:sign,camera:camera.getPosition().toArray(),target:center,distance,renderComponents:all.length};
    },{view,sign,mode,entryCameras:NORTH_ENTRY_CAMERA});
    const a=await frame(page),stable=await frame(page,true);assert.equal(a.glError,0);assert.equal(stable.glError,0);assert.equal(stable.changed,0,'stationary frame instability');
    await page.evaluate(()=>window.__northTargetGroups.forEach(({e})=>{e.enabled=false;}));
    const hidden=await frame(page,true);assert.equal(hidden.glError,0);assert.ok(hidden.changed>30,`${view.id}: target is blank or fully occluded`);
    await page.evaluate(()=>window.__northTargetGroups.forEach(({e,enabled})=>{e.enabled=enabled;}));
    const restored=await frame(page,true);assert.equal(restored.glError,0);assert.equal(restored.changed,hidden.changed,'target visibility round-trip');
    const label=`${name}-${view.id}-${sign<0?'production':'control'}`;
    await page.locator('#application').screenshot({path:`${out}/${label}.png`,animations:'disabled',timeout:TIMEOUT_MS});
    report.views.push({name,view:view.id,...receipt,frame:a,stable,visibleTargetPixels:hidden.changed});
   }
   assert.deepEqual(smoke.problems,[]);
  }finally{await smoke.close();}
 }
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){report.error=String(e?.stack||e);await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');throw e;}
