// Run from this checkout. Source coordinates and construction assumptions stay separate.
import {writeFile,readFile} from 'node:fs/promises';
import {MeshBatch} from './mesh-batch.mjs';
import {spatialSource} from './spatial-source.mjs';
const port = await spatialSource(process.env.MOA_CAMPUS_DATA);
import {BUILDINGS, LIBRARY_ROOF_PARTS} from '../../../apps/world/src/basic-campus.js';
import {buildCampusTerrainGeometry,buildCampusTerrainSidesGeometry} from '../../../apps/world/src/campus-terrain-geometry.js';
import {triangulatePolygon} from '../../../apps/world/src/reality-adapter.js';
import {polygonOverlap} from '../../../apps/world/src/polygon-collision.js';
import {CAMPUS_ROADS,CAMPUS_PATH_WIDTHS,roadFrame,roadTreeClear} from '../../../apps/world/src/campus-road-layout.js';
import {fillCampusRoadBatch} from '../../../apps/world/src/campus-road-geometry.js';
import {fillMainGateRoads} from '../../../apps/world/src/main-gate-road-geometry.js';
import {fillLegacyGateGround} from '../../../apps/world/src/main-gate-surface-ownership.js';
import {gateCentralPoolRimFaces} from '../../../apps/world/src/main-gate-terrain-layout.js';
import {MAIN_GATE_EDITOR_WORLD,mainGateProductionStructure} from '../../../apps/world/src/editor/main-gate-production.js';
import {MAIN_HALL_WALKWAYS} from '../../../apps/world/src/main-hall-walkway-layout.js';
import {fillMainHallCandidate} from '../../../apps/world/src/main-hall-candidate-geometry.js';
import {fillPhotoLibraryFront,fillPhotoLibraryWest,fillPhotoLibraryRoof} from '../../../apps/world/src/photo-hall-library-geometry.js';
import {fillJeongseokEntry,fillLibraryApproaches,JEONGSEOK_ENTRY_LAYOUT} from '../../../apps/world/src/jeongseok-entry-geometry.js';
import {MAIN_HALL_APPROACH,LIBRARY_APPROACHES} from '../../../apps/world/src/roadview-layout.js';
import {LIBRARY_BANK_CELLS,LIBRARY_ROUTE_CELLS,LIBRARY_ROUTE_GUARDS} from '../../../apps/world/src/library-route-layout.js';
import {LIBRARY_GREENS,GARDEN_FLOOR} from '../../../apps/world/src/library-garden-layout.js';
import {SPORTS_CUT_RING,SPORTS_FLOOR} from '../../../apps/world/src/stadium-stands-layout.js';
import {FACILITY_BOUNDS} from '../../../apps/world/src/campus-facilities.js';
import {MAIN_GATE_SPAWN} from '../../../apps/world/src/campus-spawn.js';
import {LIBRARY_FRONT} from '../../../apps/world/src/basic-campus.js';

const base=new MeshBatch(), hall=new MeshBatch(), library=new MeshBatch();
const groups={base,hall,library};
const bounds={...FACILITY_BOUNDS};
const depressions=[{id:'garden',ring:LIBRARY_GREENS[0].polygon,y:GARDEN_FLOOR},{id:'sports',ring:SPORTS_CUT_RING,y:SPORTS_FLOOR}];
const water=[port.LANDMARKS.find(p=>p.id==='lmk_inkyung_pond'),port.SITE_FEATURES.find(p=>p.kind==='reflecting_pool')];
const obstacles=[];
function solid(id,polygon,minY=-5,maxY=40) { obstacles.push({id,polygon,minY,maxY}); }
function face(batch,color,ring,y) {
  const indices=triangulatePolygon(ring);
  for(let i=0;i<indices.length;i+=3){
    const corners=indices.slice(i,i+3).map(j=>[ring[j].x,y,ring[j].z]);
    batch.triangle(color,...corners);
  }
}
function terrainMesh(color,mesh){
  for(let i=0;i<mesh.indices.length;i+=3){
    base.triangle(color,...mesh.indices.slice(i,i+3).map(j=>mesh.positions.slice(j*3,j*3+3)));
  }
}
const cutouts=water.map(f=>port.projectPolygon(f.polygon));
terrainMesh('#93aa77',buildCampusTerrainGeometry(bounds,[...cutouts,...depressions.map(d=>d.ring)]));
for (const d of depressions){
  face(base,'#829770',d.ring,d.y);
  terrainMesh('#928777',buildCampusTerrainSidesGeometry(d.ring,d.y));
}
for (const [i,feature] of water.entries()){
  const ring=cutouts[i]; face(base,'#5597a3',ring,.025); solid(feature.id,ring);
  if(feature.kind==='reflecting_pool')for(const quad of gateCentralPoolRimFaces(ring))base.quad('#c7c3b4',...quad);
}
const routes=[];
for (const f of port.SITE_FEATURES) {
  if(f.kind==='lawn')face(base,'#80a46b',port.projectPolygon(f.polygon),.018);
  if(f.kind!=='path')continue;
  const line=f.line.map(ll=>port.geoToWorld(...ll)),width=CAMPUS_PATH_WIDTHS[f.id]??3.5;
  routes.push({id:f.id,sourceId:f.sourceId,line,width,accuracy:'source-centerline / estimated width'});
  for(let i=1;i<line.length;i++){
    const frame=roadFrame(line[i-1],line[i]);
    for(const [w,y,color] of [[width+2.1,.032,'#bbb7a9'],[width,.04,'#8a908b']]){
      const ring=[[0,-1],[frame.length,-1],[frame.length,1],[0,1]].map(([u,side])=>frame.at(u,side*w/2));
      fillLegacyGateGround(base,color,ring,y);
    }
  }
}
fillCampusRoadBatch(base);
fillMainGateRoads(base);
const crossing=routes.find(r=>r.id==='site_481241692');
for(const w of MAIN_HALL_WALKWAYS){
  const donor=routes.find(r=>r.id===w.sourceId).line;
  const [a,b]=donor.slice(-2),dx=b.x-a.x,dz=b.z-a.z;
  const start=w.frame.at(0),next=w.frame.at(1);
  const meet=v=>{const q=w.frame.at(0,v);return w.frame.at(-((q.x-b.x)*dx+(q.z-b.z)*dz)/((next.x-start.x)*dx+(next.z-start.z)*dz),v);};
  const end=w.frame.length-(crossing.width+2.1)/2,h=w.width/2;
  face(base,'#bbb7a9',[meet(-h),meet(h),w.frame.at(end,h),w.frame.at(end,-h)],.033);
}
const gateIds=[];
for(const e of MAIN_GATE_EDITOR_WORLD.entities){
  const id=e.metadata.production.id;gateIds.push(id);
  if(!e.components['world.structure'])continue;
  const b=mainGateProductionStructure(id);
  base.box(b.color,b.position,b.size,b.yaw);
  if(e.metadata.production.collisionHeightMeters!=null)solid(id,b.footprint,0,b.collisionMaxY);
}
for(const b of BUILDINGS){
  const ring=b.vertices;
  solid(b.id,ring,0,b.height);
  face(base,'#848989',ring,b.height);
  for(let i=0;i<ring.length;i++){
    const a=ring[i],v=ring[(i+1)%ring.length];
    base.quad('#d8d4c8',[a.x,0,a.z],[v.x,0,v.z],[v.x,b.height,v.z],[a.x,b.height,a.z]);
  }
}
const hallFrame=MAIN_HALL_APPROACH.frame;
for(let i=0;i<9;i++){
  const u=.5+i*(hallFrame.length-1)/8;
  solid('hall-pier-'+i,[[u-.325,-.12],[u+.325,-.12],[u+.325,.48],[u-.325,.48]].map(([t,v])=>hallFrame.at(t,v)),0,10);
}
for(const tier of ['BASE','DETAIL']){
  fillMainHallCandidate(hall,tier);fillPhotoLibraryFront(library,tier);fillPhotoLibraryWest(library,tier);
  fillJeongseokEntry(library,tier);
}
for(const part of LIBRARY_ROOF_PARTS)fillPhotoLibraryRoof(library,part);
fillLibraryApproaches(base);
const stairs=[];
for(const [idx,a] of [MAIN_HALL_APPROACH,...LIBRARY_APPROACHES].entries()){
  const {frame:f,height,run,steps,landing}=a,w=f.length-2*(a.inset??0),id=a.id??'hall_front';
  const step=(near,far,y)=>{
    const ring=[[0,near],[w,near],[w,far],[0,far]].map(([u,v])=>f.at(u+(a.inset??0),v));
    stairs.push({id,ring,y});
    if(idx===0){
      const center=f.at(f.length/2,(near+far)/2);
      base.box('#cbc5b7',[center.x,y/2,center.z],[w,y,far-near],f.yaw);
    }
  };
  step(0,landing,height);
  for(let n=0;n<steps;n++)step(landing+n*run/steps,landing+(n+1)*run/steps,height*(1-n/steps));
}
const cells=[];
for(const [list,color] of [[LIBRARY_ROUTE_CELLS,'#b9b5a6'],[LIBRARY_BANK_CELLS,'#849c72']]){
  for(const cell of list){
    const q=cell.polygon;
    cells.push(q);
    if(cell.line==='main_gate_walk_link'){fillLegacyGateGround(base,color,q,.045);continue;}
    for(const tri of [[0,1,2],[0,2,3]])base.triangle(color,...tri.map(i=>[q[i].x,q[i].y+.045,q[i].z]));
  }
}
for(const g of LIBRARY_ROUTE_GUARDS){
  solid(g.id,g.polygon,g.minY,g.maxY);
  base.tube('#b9c1bd',[g.a.x,g.a.y+.45,g.a.z],[g.b.x,g.b.y+.45,g.b.z],.025,6);
}
for(const u of JEONGSEOK_ENTRY_LAYOUT.pierCenters){
  const p=LIBRARY_FRONT.at(u,JEONGSEOK_ENTRY_LAYOUT.pierV);
  const hw=JEONGSEOK_ENTRY_LAYOUT.pierWidth/2;
  solid('library-pier-'+u,[[-hw,-.26],[hw,-.26],[hw,.26],[-hw,.26]].map(([x,z])=>({x:p.x+x,z:p.z+z})),0,5);
}
const trees=[];
for(const f of routes.filter(r=>['site_481241658','site_481241696','site_481241657','site_258995842'].includes(r.id))){
  for(let i=1;i<f.line.length;i++){
    const frame=roadFrame(f.line[i-1],f.line[i]);
    for(let u=4;u<frame.length;u+=8)for(const side of [-1,1]){
      const p=frame.at(u,side*(f.width/2+3));
      if(!roadTreeClear(p,1)||obstacles.some(o=>polygonOverlap(p.x,p.z,o.polygon,1.5))||
        trees.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<4))continue;
      trees.push(p);
    }
  }
}
for (const [index,tree] of trees.entries()) {
  const ring = Array.from({length:8}, (_,i) => {
    const angle = i*Math.PI/4;
    return {x:tree.x+.34*Math.cos(angle), z:tree.z+.34*Math.sin(angle)};
  });
  solid('tree-'+index,ring,0,2.5);
}
const gate=port.TOUR_STOPS.find(stop=>stop.id==='gate');
const entrance=port.MAIN_ENTRANCE;
const lib=LIBRARY_FRONT.at(0,1.8), libWall=LIBRARY_FRONT.at(0,0);
const rooms={
  'main-gate': {spatialId:'lmk_main_gate',x:gate.x,z:gate.z,viewYaw:Math.PI},
  'main-building': {spatialId:'bldg_01',x:entrance.x,z:entrance.z,viewYaw:Math.atan2(-entrance.inward.x,-entrance.inward.z)},
  library: {spatialId:'bldg_jungseok',...lib,viewYaw:Math.atan2(lib.x-libWall.x,lib.z-libWall.z)}
};
const buffers=[],ranges={};let offset=0;
for(const [name,batch] of Object.entries(groups)){
  const bytes=batch.bytes();ranges[name]={offset,count:batch.vertices.length};buffers.push(bytes);offset+=bytes.length;
}
const metadata={bounds,spawn:{x:MAIN_GATE_SPAWN.x,z:MAIN_GATE_SPAWN.z},ranges,obstacles,stairs,cells,depressions,trees,routes,
  roadIds:CAMPUS_ROADS.map(r=>r.id),gateIds,rooms,
  walkwaySurvey:Object.fromEntries(['corridor_width_m','corridor_length_m','tree_spacing_m','lamp_spacing_m','plaza_dimensions_m','branch_angles_at_south_node'].map(k=>[k,null]))};
for(const [file,content] of [['layout.json',Buffer.from(JSON.stringify(metadata)+'\n')],['layout.bin',Buffer.concat(buffers)]]){
  const url=new URL('../data/'+file,import.meta.url);
  if(process.argv.includes('--check')){
    if(!(await readFile(url)).equals(content))throw Error('Stale baked map: '+file);
  }else await writeFile(url,content);
}
console.log({ranges,trees:trees.length,obstacles:obstacles.length});
