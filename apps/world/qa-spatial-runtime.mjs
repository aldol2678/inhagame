// DevTools QA for a disposable browser tab. This uses the real controller and GPU scene.
import {MAIN_ENTRANCE} from './src/basic-campus.js';
import {FACILITIES} from './src/campus-facilities.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function run(){
  const d=window.__INHAGAME_P0__,events=[],off=d.onPlaceZoneChanged((a,b)=>events.push([a?.id??null,b?.id??null]));
  const samples=[];
  const pose=(x,z,y=1.15)=>{d.player.setLocalPosition(x,y,z);d.places.update(d.player.getLocalPosition());d.streaming.update(1,d.player.getLocalPosition());};
  const record=(name,expected)=>{
    check(d.getCurrentPlaceZone()?.id===expected,`${name} place label`);
    check(document.getElementById('zone').textContent===d.getCurrentPlaceZone().displayName,`${name} HUD`);
    check(d.app.root.findByName('campus_terrain')?.render.enabled,`${name} persistent terrain`);
    samples.push({name,place:d.getCurrentPlaceZone().id,metrics:d.streaming.getMetrics()});
  };
  const walk=(x,z)=>{
    d.orbit.yaw=0;let arrived=false;
    try{for(let i=0;i<5000;i++){
      const p=d.player.getLocalPosition(),dx=x-p.x,dz=z-p.z,len=Math.hypot(dx,dz);
      if(len<.04){arrived=true;break;}
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(.04,len/d.controller.walkSpeed));
    }}finally{d.controller.touchVector={x:0,y:0};}
    check(arrived,`walk ${x},${z} blocked`);
  };
  try{
    pose(0,-98);d.controller.mounted=false;d.controller.velocityY=0;
    document.querySelector('#tour-restart').click();record('gate','AREA_MAIN_GATE');
    for(const p of [[0,-76],[14,-46],[36,-12],[MAIN_ENTRANCE.x,MAIN_ENTRANCE.z]])walk(...p);
    record('main hall','AREA_MAIN_HALL');check(d.getStatus().tourStage===2,'two-stop tour completes');
    // Approach around the south of the Main Hall facade, then enter the pond area.
    for(const p of [[60,-18],[90,-18],[130,-2],[126,35]])walk(...p);
    record('pond','AREA_INKYUNG_STUDENT_CENTER');
    const agora=FACILITIES.find(f=>f.id==='fac_agora_courtyard').center;
    pose(agora.x-8,agora.z);walk(agora.x,agora.z);record('Agora','AREA_AGORA_6_9');
    for(const [id,expected] of [['fac_stadium','AREA_SPORTS'],['bldg_05','AREA_BUILDING_5_WEST']]){
      const f=FACILITIES.find(f=>f.id===id);pose(f.center.x,f.center.z,24);record(id,expected);
    }
    // Warm both sides, then replay 20 crossings of the old Gate/Main boundary.
    pose(0,-49.9);pose(0,-50.1);pose(0,-49.9);
    const start=d.streaming.getMetrics(),baseGuid=d.app.root.findByName('CampusBase').getGuid();
    for(let i=0;i<20;i++)pose(0,i%2?-49.9:-50.1);
    const end=d.streaming.getMetrics();
    const churn=Object.fromEntries(['chunkBuilds','chunkDestroys','entitiesCreated','entitiesDestroyed','transitions'].map(k=>[k,end[k]-start[k]]));
    check(churn.chunkBuilds===0&&churn.chunkDestroys===0&&churn.entitiesDestroyed===0&&churn.entitiesCreated===0,'old boundary crossing must reuse entities');
    check(d.app.root.findByName('CampusBase').getGuid()===baseGuid,'no base rebuild');
    // Exercise real ACTIVE/NEAR layers of the isolated eastern residence chunk.
    const chunk=d.registry.get('RC_4_-2'),b=chunk.bounds;
    pose(b.minX-34,(b.minZ+b.maxZ)/2,24);
    let h=d.streaming.runtime.get(chunk.id).handle;
    const identities=[h.root.getGuid(),h.near.getGuid(),h.detail.getGuid()];
    for(let i=0;i<12;i++){
      pose(b.minX-51,(b.minZ+b.maxZ)/2,24);check(!h.detail.enabled&&h.near.enabled,'NEAR layer visibility');
      pose(b.minX-34,(b.minZ+b.maxZ)/2,24);check(h.detail.enabled&&h.near.enabled,'ACTIVE layer visibility');
      check(JSON.stringify(identities)===JSON.stringify([h.root.getGuid(),h.near.getGuid(),h.detail.getGuid()]),'ACTIVE NEAR entity reuse');
    }
    pose(-160,-170);check(d.streaming.snapshot()[chunk.id]==='UNLOADED','far detail unload');
    check(d.app.root.findByName('bldg_dorm2'),'far collision has visible silhouette');
    pose(b.minX-34,(b.minZ+b.maxZ)/2,24);h=d.streaming.runtime.get(chunk.id).handle;
    check(h.root.getGuid()!==identities[0],'restored detail handle');
    return {renderer:d.getStatus().renderer,samples,events,churn,activeNearReuse:'PASS',farRestore:'PASS',tour:'PASS'};
  }finally{off();d.controller.mounted=false;d.controller.velocityY=0;pose(0,-98);d.orbit.yaw=0;d.orbit.pitch=.38;d.orbit.distance=20;}
}
