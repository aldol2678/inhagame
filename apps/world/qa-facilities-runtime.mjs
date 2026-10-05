// Browser DevTools entry point: await (await import('/qa-facilities-runtime.mjs')).run()
// Run in a disposable QA tab: it walks the tour and changes the camera/player for mesh audits.
import {FACILITIES} from './src/campus-facilities.js';
const check=(condition,message)=>{if(!condition)throw Error(message);};
function assertNoOldAgora(d) {
  check(d.app.root.find(e=>/agora|seam_guide/i.test(e.name)&&!e.name.startsWith('fac_agora_courtyard')).length===0, "Old pond-side Agora structures and connector remain removed");
}
function audit(d) {
  assertNoOldAgora(d);
  const track=d.app.root.findByName('fac_stadium_details_b46e5d');
  check(track?.render,'flat red track exists');
  for(const mi of track.render.meshInstances){
    const positions=[];mi.mesh.getPositions(positions);
    check(positions.filter((_,i)=>i%3===1).every(y=>Math.abs(y-.05)<1e-6),'red track has no raised walls');
  }
  const plane=d.app.root.findByName('lmk_woonam_aircraft');
  const bounds=plane.findComponents('render').flatMap(c=>c.meshInstances).map(mi=>mi.aabb);
  const envelope={minX:Math.min(...bounds.map(b=>b.center.x-b.halfExtents.x)),maxX:Math.max(...bounds.map(b=>b.center.x+b.halfExtents.x)),
    minZ:Math.min(...bounds.map(b=>b.center.z-b.halfExtents.z)),maxZ:Math.max(...bounds.map(b=>b.center.z+b.halfExtents.z))};
  for(const tree of d.app.root.find(e=>e.name.endsWith('_crown')))for(const mi of tree.render.meshInstances){
    const b=mi.aabb;
    check(b.center.x+b.halfExtents.x<envelope.minX-1||b.center.x-b.halfExtents.x>envelope.maxX+1||
      b.center.z+b.halfExtents.z<envelope.minZ-1||b.center.z-b.halfExtents.z>envelope.maxZ+1,'tree crown clears aircraft display');
  }
  return FACILITIES.map(f=>{
    const entities=d.app.root.find(e=>e.name===f.id);check(entities.length===1,`${f.id} must exist once`);
    const root=entities[0],meshes=root.findComponents('render').flatMap(c=>c.meshInstances);
    check(meshes.length>0,`${f.id} has actual rendered geometry`);
    if(f.rings.length){
      const bodies=f.kind==='building'?root.find(e=>e.name.startsWith(f.id+'_body_')).flatMap(e=>e.render.meshInstances):[root.findByName(f.id+'_surface').render.meshInstances[0]];
      check(bodies.length>0,`${f.id} render component`);
      const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
      let triangles=0;
      for(const mi of bodies){const positions=[],indices=[];mi.mesh.getPositions(positions);mi.mesh.getIndices(indices);
        check(positions.length>0&&positions.every(Number.isFinite)&&indices.length>0,`${f.id} finite GPU mesh`);
        check(mi.visible,`${f.id} mesh enabled`);triangles+=indices.length/3;
        const a=mi.aabb;bounds.minX=Math.min(bounds.minX,a.center.x-a.halfExtents.x);bounds.maxX=Math.max(bounds.maxX,a.center.x+a.halfExtents.x);
        bounds.minZ=Math.min(bounds.minZ,a.center.z-a.halfExtents.z);bounds.maxZ=Math.max(bounds.maxZ,a.center.z+a.halfExtents.z);
      }
      const p=f.rings[0],expected={minX:Math.min(...p.map(p=>p.x)),maxX:Math.max(...p.map(p=>p.x)),minZ:-Math.max(...p.map(p=>p.z)),maxZ:-Math.min(...p.map(p=>p.z))};
      for(const key of Object.keys(expected))check(Math.abs(bounds[key]-expected[key])<.002,`${f.id} ${key}`);
      return {id:f.id,guid:root.getGuid(),triangles,bounds};
    }
    let triangles=0;
    for(const mi of meshes){const positions=[],indices=[];mi.mesh.getPositions(positions);mi.mesh.getIndices(indices);check(mi.visible&&positions.length>0&&positions.every(Number.isFinite)&&indices.length>0,`${f.id} landmark GPU mesh`);triangles+=indices.length/3;}
    return {id:f.id,guid:root.getGuid(),triangles,batched:true};
  });
}
export function run() {
  const d=window.__INHAGAME_P0__;check(d?.app,'world initialized');
  const walk=(x,z)=>{
    d.orbit.yaw=0;let arrived=false;
    try{for(let i=0;i<5000;i++){
      const p=d.player.getLocalPosition(),dx=x-p.x,dz=z-p.z,len=Math.hypot(dx,dz);
      if(len<.04){arrived=true;break;}
      d.controller.touchVector={x:dx/len,y:-dz/len};d.app.fire('update',Math.min(.04,len/d.controller.walkSpeed));
    }}finally{d.controller.touchVector={x:0,y:0};}
    check(arrived,`walk blocked ${x},${z}`);d.streaming.update(1,d.player.getLocalPosition());
  };
  document.querySelector('#tour-restart')?.click();
  d.controller.mounted=false;d.controller.velocityY=0;
  for(const [x,z] of [[0,-76],[14,-46],[36,-12],[49.481,-4.715],[60,-18],[90,-18],[130.3574,-2.1004]])walk(x,z);
  check(d.getStatus().tourStage===2,'Gate-Hall functional tour');
  assertNoOldAgora(d);
  const pose=(x,z)=>{d.player.setLocalPosition(x,1.15,z);d.places.update(d.player.getLocalPosition());d.streaming.update(1,d.player.getLocalPosition());};
  pose(50,20);const first=audit(d);
  const studentChunk=d.registry.chunks.find(c=>c.facilities.includes('bldg_07'));
  const firstChunk=d.streaming.runtime.get(studentChunk.id).handle.root.getGuid();
  pose(-160,-170);check(d.streaming.snapshot()[studentChunk.id]==='UNLOADED','far student detail chunk unloads');
  check(d.app.root.findByName('bldg_07'),'student silhouette remains resident');
  pose(50,20);const rebuilt=audit(d);
  check(d.streaming.runtime.get(studentChunk.id).handle.root.getGuid()!==firstChunk,'detail chunk recreated on return');
  check(rebuilt.find(f=>f.id==='bldg_07').guid===first.find(f=>f.id==='bldg_07').guid,'student base entity is retained');
  const pond=d.app.root.findByName('lmk_inkyung_pond');check(pond?.render?.enabled,'pond retained after reload');
  pose(0,-98);d.orbit.yaw=0;d.orbit.pitch=.38;d.orbit.distance=20;
  return {renderer:d.getStatus().renderer,features:rebuilt.length,tour:2,streaming:'PASS',gpuBounds:'PASS',flatTrack:'PASS',aircraftClearance:'PASS',facilities:rebuilt};
}
