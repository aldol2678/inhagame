import test from 'node:test';
import assert from 'node:assert/strict';
import {FACILITIES} from '../src/campus-facilities.js';
import {BUILDINGS,LIBRARY_ROOF_PARTS} from '../src/basic-campus.js';
import {photoLandmarkView} from './browser/photo-landmarks-views.js';

const aspects=[390/720,844/300,1280/620]; // Rendering area excludes the non-overlay caption.
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
function projected(point,{position,target},aspect){
 const offset=position.map((x,i)=>x-target[i]),distance=Math.hypot(...offset),back=offset.map(x=>x/distance);
 const side=[back[2],0,-back[0]],sideLength=Math.hypot(...side),right=side.map(x=>x/sideLength);
 const up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
 const delta=point.map((x,i)=>x-target[i]),depth=distance-dot(delta,back),tan=Math.tan(48*Math.PI/360);
 return [dot(delta,right)/(depth*tan*aspect),dot(delta,up)/(depth*tan),depth];
}
function pointsFor(id){
 const b=id==='bldg_07'?FACILITIES.find(f=>f.id===id):BUILDINGS.find(b=>b.id===id);
 const points=(b.rings?b.rings.flat():b.vertices).flatMap(p=>[0,b.height].map(y=>[p.x,y,p.z]));
 if(id==='bldg_jungseok')for(const part of LIBRARY_ROOF_PARTS)for(const p of part.vertices)for(const y of [part.y-part.height/2,part.y+part.height/2])points.push([p.x,y,p.z]);
 return points;
}
for(const id of ['bldg_07','bldg_01','bldg_jungseok'])test(`${id}: complete source silhouette fits every QA aspect with padding`,()=>{
 for(const aspect of aspects)for(const point of pointsFor(id)){
  const [x,y,depth]=projected(point,photoLandmarkView(id,aspect),aspect);
  assert.ok(depth>0&&Math.abs(x)<=.85&&Math.abs(y)<=.85,`${id} ${aspect}: projected ${x},${y}`);
 }
});
test('camera fit uses actual supplied mesh bounds rather than a fixed distance heuristic',()=>{
 const points=pointsFor('bldg_07').map(([x,y,z])=>[143+(x-143)*1.6,y,z]);
 for(const aspect of aspects)for(const point of points){
  const [x,y,depth]=projected(point,photoLandmarkView('bldg_07',aspect,{points}),aspect);
  assert.ok(depth>0&&Math.abs(x)<=.85&&Math.abs(y)<=.85);
 }
});
test('library canopy close-up looks upward from below the existing soffit and fits the canopy',()=>{
 const part=LIBRARY_ROOF_PARTS.find(p=>p.id==='library_entry_canopy');
 for(const aspect of aspects){
  const view=photoLandmarkView('bldg_jungseok',aspect,{mode:'canopy'});
  assert.ok(view.position[1]<part.y-part.height/2,'camera below soffit');
  assert.ok(view.target[1]>view.position[1],'upward gaze');
  for(const p of part.vertices)for(const y of [part.y-part.height/2,part.y+part.height/2]){
   const [x,v,depth]=projected([p.x,y,p.z],view,aspect);
   assert.ok(depth>0&&Math.abs(x)<=.85&&Math.abs(v)<=.85);
  }
 }
});
