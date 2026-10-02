// Disposable local/PR-preview QA only: changes that origin's view preference.
import { VIEW_DISTANCE_PRESETS } from './src/view-distance.js';
import { MAIN_ENTRANCE } from './src/basic-campus.js';
import { FACILITIES } from './src/campus-facilities.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const facility=id=>FACILITIES.find(f=>f.id===id).center;
export const LOCATIONS=[
  {name:'gate',x:0,z:-98,place:'AREA_MAIN_GATE'},
  {name:'hall',...MAIN_ENTRANCE,place:'AREA_MAIN_HALL'},
  {name:'pond',x:126,z:35,place:'AREA_INKYUNG_STUDENT_CENTER'},
  {name:'agora',...facility('fac_agora_courtyard'),place:'AREA_AGORA_6_9'},
  {name:'sports',...facility('fac_stadium'),place:'AREA_SPORTS'},
  {name:'west',...facility('bldg_05'),place:'AREA_BUILDING_5_WEST'}
];
const frames=async count=>{for(let i=0;i<count;i++)await new Promise(requestAnimationFrame);};
export async function selectPreset(id) {
  const select=document.getElementById('view-distance');
  select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));
  const d=window.__INHAGAME_P0__;
  for(let i=0;i<180;i++){
    await frames(1);
    if(!d.streaming.policyDirty&&!d.streaming.pending.length){await frames(24);return;}
  }
  throw Error('view policy failed to settle');
}
export function pose(index) {
  const d=window.__INHAGAME_P0__,p=LOCATIONS[index];
  d.controller.keys.clear();d.controller.touchVector={x:0,y:0};
  d.controller.mounted=true;d.controller.landing=false;
  d.controller.ascendHeld=false;d.controller.descendHeld=false;
  d.player.setLocalPosition(p.x,24,p.z);d.places.update(d.player.getLocalPosition());
  d.orbit.yaw=0;d.orbit.pitch=.5;d.orbit.distance=36;
  return p;
}
function memoryAndGeometry(d) {
  const buffers=new Set();let enabledMeshInstances=0;
  for(const c of d.app.root.findComponents('render'))for(const mi of c.meshInstances){
    if(c.entity.enabled&&c.enabled&&mi.visible)enabledMeshInstances++;
    if(mi.mesh.vertexBuffer)buffers.add(mi.mesh.vertexBuffer);
    for(const b of mi.mesh.indexBuffer||[])if(b)buffers.add(b);
  }
  return {enabledMeshInstances,meshBufferBytes:[...buffers].reduce((sum,b)=>sum+b.numBytes,0),
    engineTrackedGpuBytes:{...d.app.graphicsDevice._vram},
    jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null};
}
export async function measureLocation(index) {
  const d=window.__INHAGAME_P0__,p=pose(index),rows=[];
  const base=d.app.root.findByName('CampusBase'),baseGuid=base.getGuid();
  const nearest=d.registry.chunks.reduce((a,b)=>d.registry.distance(p,a)<d.registry.distance(p,b)?a:b);
  let nearestGuid;
  for(const preset of Object.values(VIEW_DISTANCE_PRESETS)){
    const before=d.streaming.getMetrics(),started=performance.now();
    await selectPreset(preset.id);
    const settleMs=performance.now()-started;
    check(base.enabled&&base.getGuid()===baseGuid,'campus vista survives setting changes');
    for(const name of ['campus_terrain','bldg_01','bldg_jungseok','lmk_inkyung_pond','fac_stadium','fac_agora_courtyard'])
      check(d.app.root.findByName(name)?.enabled,`${name} silhouette/ground retained`);
    const nearestHandle=d.streaming.runtime.get(nearest.id).handle;
    if(nearestGuid)check(nearestHandle.root.getGuid()===nearestGuid,'near chunk survives preset change');
    nearestGuid=nearestHandle.root.getGuid();
    check(d.getStatus().viewDistance===preset.id,'current preference');
    check(d.getCurrentPlaceZone().id===p.place,'place independent of view setting');
    check(document.getElementById('zone').textContent===d.getCurrentPlaceZone().displayName,'HUD place');
    const drawCalls=[],frameMs=[];
    for(let i=0;i<45;i++){await frames(1);drawCalls.push(d.app.stats.drawCalls.total);frameMs.push(d.app.stats.frame.ms);}
    const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
    const after=d.streaming.getMetrics();
    const churn=Object.fromEntries(['entitiesCreated','entitiesDestroyed','chunkBuilds','chunkDestroys','transitions'].map(k=>[k,after[k]-before[k]]));
    const distant=[...d.streaming.runtime.values()].filter(r=>r.state==='VISTA');
    check(distant.every(r=>!r.handle.detail?.enabled&&!r.handle.near?.enabled),'vista excludes expensive detail');
    rows.push({location:p.name,preset:preset.id,place:p.place,counts:after.counts,churn,cumulative:after,
      drawCallsMedian:quantile(drawCalls,.5),frameIntervalMedianMs:quantile(frameMs,.5),frameIntervalP95Ms:quantile(frameMs,.95),
      settleMs,...memoryAndGeometry(d)});
  }
  // Downgrade from MAX too, not only incremental expansion.
  await selectPreset('SHORT');
  check(d.streaming.runtime.get(nearest.id).handle.root.getGuid()===nearestGuid,'MAX to SHORT near root retained');
  check(base.enabled&&base.getGuid()===baseGuid,'MAX to SHORT base retained');
  return rows;
}

export async function walkTour(id) {
  const d=window.__INHAGAME_P0__;
  await selectPreset(id);
  d.player.setLocalPosition(0,1.15,-98);d.controller.mounted=false;d.controller.landing=false;
  d.controller.velocityY=0;d.controller.touchSprint=false;d.controller.keys.clear();d.orbit.yaw=0;
  document.getElementById('tour-restart').click();
  for(const [x,z] of [[0,-76],[14,-46],[36,-12],[MAIN_ENTRANCE.x,MAIN_ENTRANCE.z],[60,-18],[90,-18],[130,-2],[126,35]]){
    let arrived=false;
    try{for(let i=0;i<5000;i++){
      const p=d.player.getLocalPosition(),dx=x-p.x,dz=z-p.z,len=Math.hypot(dx,dz);
      if(len<.04){arrived=true;break;}
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(.04,len/d.controller.walkSpeed));
    }}finally{d.controller.touchVector={x:0,y:0};}
    check(arrived,`${id} walk blocked ${x},${z}`);
  }
  check(d.getStatus().tourStage===2,`${id} tour completion`);
  check(d.getCurrentPlaceZone().id==='AREA_INKYUNG_STUDENT_CENTER',`${id} pond approach`);
  const p=d.player.getLocalPosition();check(p.y>=1.15,`${id} ground collision`);
  return {preset:id,tour:2,walk:'PASS',ground:'PASS',metrics:d.streaming.getMetrics()};
}
