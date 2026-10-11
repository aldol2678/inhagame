// Diagnostic only: actual private geometry is rendered in memory. Only aggregate
// pixel/occlusion metrics are retained; no private image or geometry is exported.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke } from './harness.mjs';
const output=process.env.ANNYONGI_OUTPUT||'test-results/annyongi';
const profile=process.env.ANNYONGI_FACE_PROFILE||'full';
assert.ok(['full','triage'].includes(profile));
const results=[]; let activeCase=null, failure=null;
const save=async(status)=>{await mkdir(output,{recursive:true});await writeFile(`${output}/face-diagnostic.json`,JSON.stringify({headSha:process.env.CHARACTER_SMOKE_HEAD_SHA||null,profile,status,activeCase,failure,results,limits:['Pixel-derived diagnostic, not direct human image review.','Perspective .3/700; mobile shadow-off baseline. Controlled face scene.','No runtime correction or geometry change is inferred solely from these metrics.']},null,2));};
try {
for(const [device,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]) {
 const smoke=await startSmoke({viewport,contextOptions:device==='mobile'?{isMobile:true,hasTouch:true,deviceScaleFactor:1}:{}});
 try {
  const page=await smoke.context.newPage();smoke.watch(page);
  for(const optimized of (profile==='triage'?[false]:[false,true]))for(const night of [false,true]) {
   const query=new URLSearchParams();if(optimized)query.set('optimized','1');if(night)query.set('night','1');
   await page.goto(`${smoke.origin}/tests/browser/annyongi-review-harness.html?${query}`);
   await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
   const setup=await page.evaluate(async ({mobile,night})=>{
    const pc=await import('playcanvas'),d=window.__ANNYONGI_REVIEW__;d.state('ground');d.view('front');d.rider.enabled=false;
    const groups={forelock:['Forelock curled contour'],mouth:['Nose lobe contour -1','Nose lobe contour 1','Open smile outer contour','Smile upper lip -1','Smile upper lip 1']};
    const names=new Map(Object.entries(groups).flatMap(([group,names])=>names.map(name=>[name,group])));
    const all=d.carrier.findComponents('render').flatMap(c=>c.meshInstances);
    const items=all.map(mi=>({mi,material:mi.material,visible:mi.visible,group:names.get(mi.node.name)||null}));
    for(const name of names.keys())assertNode(name);
    function assertNode(name){if(!items.some(i=>i.mi.node.name===name))throw Error(`Missing diagnostic face node: ${name}`);}
    const head=items.find(i=>i.mi.node.name==='Head');if(!head)throw Error('Missing Head');
    const materials=new Map();
    const clone=(source,key,configure)=>{let m=materials.get(key);if(!m){m=source.clone();configure(m);m.update();materials.set(key,m);}return m;};
    const flat=(source,key,color)=>clone(source,key,m=>{m.diffuse.set(0,0,0);m.emissive.set(...color);m.emissiveIntensity=1;m.emissiveMap=null;m.diffuseMap=null;m.diffuseVertexColor=false;m.emissiveVertexColor=false;m.useLighting=false;});
    const key=d.app.root.findByName('Key').light;key.castShadows=!mobile;
    key.shadowBias=.3;key.normalOffsetBias=.2;key.shadowResolution=1024;key.shadowDistance=75;key.shadowIntensity=.48;
    const clearColor=d.camera.camera.clearColor.clone();
    const lightState={castShadows:key.castShadows,shadowBias:key.shadowBias,normalOffsetBias:key.normalOffsetBias,shadowResolution:key.shadowResolution,shadowType:key.shadowType,shadowDistance:key.shadowDistance,shadowIntensity:key.shadowIntensity};
    d.camera.camera.projection=pc.PROJECTION_PERSPECTIVE;d.camera.camera.fov=35;d.camera.camera.nearClip=.3;d.camera.camera.farClip=700;
    const center=head.mi.aabb.center.clone(),half=head.mi.aabb.halfExtents.clone();
    const distance=Math.max(half.y,half.x/(innerWidth/innerHeight))/Math.tan(35*Math.PI/360)*1.35;
    window.__FACE_DIAGNOSTIC__={d,pc,items,head,center,distance,key,lightState,images:{},materials,
     view(yaw){d.camera.setPosition(center.x+Math.sin(yaw)*distance,center.y,center.z+Math.cos(yaw)*distance);d.camera.lookAt(center);},
     mode(mode){
      d.camera.camera.clearColor.copy(clearColor);
      for(const i of items){i.mi.visible=i.visible;i.mi.material=i.material;}
      key.castShadows=lightState.castShadows;d.camera.camera.nearClip=.3;d.camera.camera.farClip=700;
      if(mode.startsWith('white'))for(const i of items)i.mi.material=clone(i.material,`white:${i.material.id}`,m=>{const light=d.app.scene.ambientLight;const n=Math.max(0,Math.min(1,(.43-(light.r+light.g+light.b)/3)/.32));m.diffuse.set(1-n*.15,1-n*.15,1-n*.15);m.emissive.set(1,1,1);m.emissiveMapVertexColor=true;m.emissiveIntensity=.045+n*.025;});
      if(['skinOnly','whiteSkinOnly','shadowOffSkinOnly'].includes(mode))for(const i of items)if(i.group)i.mi.visible=false;
      if(mode.startsWith('shadowOff'))key.castShadows=false;
      if(mode.startsWith('mask')){
       d.camera.camera.clearColor.set(0,0,0,1);
       for(const i of items){i.mi.visible=mode==='maskVisible'?i.visible:(!!i.group||(mode!=='maskSolo'&&i===head));if(i.mi.visible){i.mi.material=flat(i.material,`mask:${i.group||'head'}:${i.material.id}`,i.group==='forelock'?[1,0,1]:i.group==='mouth'?[0,1,1]:[0,0,0]);i.mi.material.cull=mode==='maskNoCull'&&i.group?pc.CULLFACE_NONE:i.material.cull;}}
       key.castShadows=false;
      }
      if(mode==='maskTightDepth')d.camera.camera.farClip=50;
      if(mode==='maskNearLow')d.camera.camera.nearClip=.05;
     }};
    return {renderer:d.app.graphicsDevice.deviceType,projection:'perspective',near:.3,far:700,lightState,
     faceNodes:items.filter(i=>i.group).map(i=>({name:i.mi.node.name,group:i.group,cull:i.material.cull,opacity:i.material.opacity,depthWrite:i.material.depthWrite,depthTest:i.material.depthTest}))};
   },{mobile:device==='mobile',night});
   for(const [view,yaw] of (profile==='triage'?(device==='mobile'?[['front',0]]:[['right',.8]]):[['front',0],['left',-.8],['right',.8]])) {
    activeCase={device,variant:optimized?'optimized':'source',night,view};await save('IN_PROGRESS');
    await page.evaluate(yaw=>{const x=window.__FACE_DIAGNOSTIC__;x.view(yaw);x.images={};},yaw);
    for(const mode of ['fixed','white','skinOnly','whiteSkinOnly','shadowOff','shadowOffSkinOnly','maskSolo','maskHead','maskNoCull','maskTightDepth','maskNearLow','maskVisible']) {
     await page.evaluate(mode=>window.__FACE_DIAGNOSTIC__.mode(mode),mode);
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const png=await page.screenshot();
     await page.evaluate(async ({mode,encoded})=>{const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([raw],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);window.__FACE_DIAGNOSTIC__.images[mode]={w:c.width,h:c.height,pixels:ctx.getImageData(0,0,c.width,c.height).data};bitmap.close();c.width=c.height=0;},{mode,encoded:png.toString('base64')});
    }
    const metrics=await page.evaluate(()=>{
     const {images}=window.__FACE_DIAGNOSTIC__,{w,h}=images.fixed,n=w*h;
     const luminance=(p,i)=>(.2126*p[i*4]+.7152*p[i*4+1]+.0722*p[i*4+2]);
     const median=a=>a.length?a.sort((a,b)=>a-b)[Math.floor(a.length/2)]:null;
     const mask=(mode,group)=>{const p=images[mode].pixels;return Uint8Array.from({length:n},(_,i)=>group==='forelock'?(p[i*4]>100&&p[i*4+1]<70&&p[i*4+2]>100):(p[i*4]<70&&p[i*4+1]>100&&p[i*4+2]>100));};
     const components=m=>{const visited=new Uint8Array(n),sizes=[];for(let i=0;i<n;i++)if(m[i]&&!visited[i]){const q=[i];visited[i]=1;let size=0;while(q.length){const a=q.pop();size++;const x=a%w,y=Math.floor(a/w);for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){const nx=x+dx,ny=y+dy,b=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&m[b]&&!visited[b]){visited[b]=1;q.push(b);}}}if(size>=3)sizes.push(size);}return {count:sizes.length,largest:sizes.length?Math.max(...sizes):0};};
     const output={};
     for(const group of ['forelock','mouth']){
      const masks=Object.fromEntries(['maskSolo','maskHead','maskNoCull','maskTightDepth','maskNearLow','maskVisible'].map(mode=>[mode,mask(mode,group)]));
      const counts=Object.fromEntries(Object.entries(masks).map(([mode,m])=>[mode,m.reduce((a,b)=>a+b,0)]));
      const signatures=Object.fromEntries(Object.entries(masks).map(([name,m])=>{let hash=2166136261;for(const value of m)hash=Math.imul(hash^value,16777619);return [name,(hash>>>0).toString(16)];}));
      const stats={};
      for(const mode of ['fixed','white','shadowOff']){
       const ratios=[];let dark=0,samples=0;
       for(let i=0;i<n;i++)if(masks.maskVisible[i]){const skin=luminance(images[mode==='white'?'whiteSkinOnly':mode==='shadowOff'?'shadowOffSkinOnly':'skinOnly'].pixels,i),ink=luminance(images[mode].pixels,i);if(skin<20)continue;const r=ink/skin;ratios.push(r);samples++;if(r<.65)dark++;}
       stats[mode]={samples,darkPixels:dark,darkFraction:samples?dark/samples:null,medianInkToSkin:median(ratios)};
      }
      let lost=0,depthChanged=0,nearChanged=0,cullChanged=0;for(let i=0;i<n;i++){if(masks.maskSolo[i]&&!masks.maskHead[i])lost++;if(masks.maskHead[i]!==masks.maskTightDepth[i])depthChanged++;if(masks.maskHead[i]!==masks.maskNearLow[i])nearChanged++;if(masks.maskHead[i]!==masks.maskNoCull[i])cullChanged++;}
      output[group]={signatures,visibleMeasurement:counts.maskVisible?'MEASURED':'UNMEASURABLE',measurement:!counts.maskSolo?'UNMEASURABLE':!counts.maskHead?'FULLY_OCCLUDED':'MEASURED',pixels:counts,lostToHead:lost,lostFraction:counts.maskSolo?lost/counts.maskSolo:null,depthChangedPixels:depthChanged,nearChangedPixels:nearChanged,cullChangedPixels:cullChanged,components:Object.fromEntries(Object.entries(masks).map(([k,m])=>[k,components(m)])),contrast:stats};
     }
     window.__FACE_DIAGNOSTIC__.mode('fixed');window.__FACE_DIAGNOSTIC__.images={};return output;
    });
    const prior=results.find(r=>r.device===device&&r.variant===activeCase.variant&&r.view===view&&r.night!==night);
    results.push({...activeCase,setup,metrics});
    if(prior)for(const group of ['forelock','mouth'])assert.deepEqual(metrics[group].signatures,prior.metrics[group].signatures,`Mask must be independent of day/night: ${device}/${view}/${group}`);
    await save('IN_PROGRESS');console.log(`Face diagnostic checkpoint: ${device}/${activeCase.variant}/${night?'night':'day'}/${view}`);
   }
  }
  assert.deepEqual(smoke.problems,[]);
 }finally{await smoke.close();}
}
}catch(error){failure={case:activeCase,message:String(error.message).split('\n')[0]};throw error;}
finally{await save(failure?'ERROR':'DIAGNOSTIC_ONLY');}
console.log(`Annyongi face diagnostic collected (${results.length} ${profile} cases)`);
